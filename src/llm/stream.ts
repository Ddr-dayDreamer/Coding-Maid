/**
 * LLM 流式通信
 *
 * 封装 chat.completions.create 的流式调用，处理 Token 估算、进度通知。
 * 从 session.ts 拆分。
 */

import * as crypto from "crypto";
import { logLlmCompletion } from "../utils/debug-logger";
import type { CreateOpenAIClient } from "../tools/types";
import type { ModelUsage, LlmStreamProgress } from "../session/types";
import {
  classifyLlmError,
  isAbortLikeError,
  LlmStreamFailure,
  normalizeRetryCount,
  type LlmErrorInfo,
} from "./errors";

// ─── 工具函数 ────────────────────────────────────────────

function isUsageRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function accumulateUsage(current: ModelUsage | null, next: unknown | null | undefined): ModelUsage | null {
  if (next == null) {
    return current ?? null;
  }
  const nextObj = { ...(next as Record<string, unknown>) } as ModelUsage;
  // 每次调用计为一次请求
  nextObj.total_reqs = 1;
  return addUsageValue(current, nextObj) as ModelUsage;
}

function addUsageValue(current: unknown, next: unknown): unknown {
  if (typeof next === "number") {
    return (typeof current === "number" ? current : 0) + next;
  }

  if (isUsageRecord(next)) {
    const currentRecord = isUsageRecord(current) ? current : {};
    const result: Record<string, unknown> = { ...currentRecord };
    for (const [key, value] of Object.entries(next)) {
      result[key] = addUsageValue(currentRecord[key], value);
    }
    return result;
  }

  return next;
}



// ─── 流结果 ──────────────────────────────────────────────

export type StreamResult = {
  choices?: Array<{ message?: Record<string, unknown> }>;
  usage?: ModelUsage | null;
};

// ─── LlmStreamManager ────────────────────────────────────

export type StreamChunk = {
  /** 本次回复的 sessionId */
  sessionId?: string;
  /** 增量文本内容 */
  content?: string;
  /** 增量推理内容 */
  reasoningContent?: string;
};

export type LlmRetryEvent = {
  sessionId?: string;
  attempt: number;
  maxRetries: number;
  delayMs: number;
  info: LlmErrorInfo;
};

type OpenAIClient = NonNullable<ReturnType<CreateOpenAIClient>["client"]>;

type StreamAttemptState = {
  /** 是否已经产生过任何输出（文本/推理/工具调用） */
  emitted: boolean;
  content: string;
  reasoning: string;
};

export class LlmStreamManager {
  private readonly createClient: CreateOpenAIClient;
  public onProgress?: (progress: LlmStreamProgress) => void;
  public onChunk?: (chunk: StreamChunk) => void;
  /** 自动重试前的回调（用于向前端提示“正在重试”） */
  public onRetry?: (event: LlmRetryEvent) => void;

  constructor(createClient: CreateOpenAIClient) {
    this.createClient = createClient;
  }

  // ─── Token 估算 ────────────────────────────────────────

  private estimateStreamTokens(text: string): number {
    let tokens = 0;
    for (const char of text) {
      tokens += /[\u3400-\u9fff\uf900-\ufaff]/u.test(char) ? 0.6 : 0.3;
    }
    return tokens;
  }

  private formatEstimatedTokens(tokens: number): string {
    if (tokens <= 0) {
      return "0";
    }

    const roundedTokens = Math.round(tokens);
    if (roundedTokens <= 0) {
      return "0";
    }

    if (roundedTokens < 100) {
      return String(roundedTokens);
    }

    if (roundedTokens < 10000) {
      return `${Number((roundedTokens / 1000).toFixed(1))}k`;
    }

    return `${Math.round(roundedTokens / 1000)}k`;
  }

  private emitLlmStreamProgress(
    requestId: string,
    startedAt: string,
    estimatedTokens: number,
    phase: LlmStreamProgress["phase"],
    sessionId?: string
  ): void {
    this.onProgress?.({
      requestId,
      sessionId,
      startedAt,
      estimatedTokens: Math.round(estimatedTokens),
      formattedTokens: this.formatEstimatedTokens(estimatedTokens),
      phase,
    });
  }

  // ─── 流式调用 ──────────────────────────────────────────

  /**
   * 创建流式请求（带自动重试）。
   *
   * 仅在“尚未向用户输出任何内容”时才自动重试，避免重复文本。
   * 已经输出过内容后断流，则抛出 LlmStreamFailure，携带部分内容供上层落盘。
   */
  async createStream(
    request: Record<string, unknown>,
    options?: Record<string, unknown>,
    sessionId?: string,
    debug?: { enabled?: boolean; location: string; baseURL?: string; params?: Record<string, unknown> }
  ): Promise<StreamResult> {
    const { client, baseURL, retryCount } = this.createClient();
    if (!client) {
      throw new Error("OpenAI client not available");
    }

    const maxRetries = normalizeRetryCount(retryCount);
    const signal = options?.signal as AbortSignal | undefined;
    let attempt = 0;

    for (;;) {
      const state: StreamAttemptState = { emitted: false, content: "", reasoning: "" };
      try {
        return await this.createStreamOnce(client, baseURL, request, options, sessionId, debug, state);
      } catch (error) {
        if (isAbortLikeError(error) || signal?.aborted) {
          throw error;
        }

        const info = classifyLlmError(error);
        const canRetry = info.retryable && !state.emitted && attempt < maxRetries;
        if (!canRetry) {
          throw new LlmStreamFailure(info, error, state.content, state.reasoning);
        }

        attempt += 1;
        const delayMs = computeRetryDelay(attempt);
        this.onRetry?.({ sessionId, attempt, maxRetries, delayMs, info });
        await delayWithSignal(delayMs, signal);
      }
    }
  }

  private async createStreamOnce(
    client: OpenAIClient,
    baseURL: string | undefined,
    request: Record<string, unknown>,
    options: Record<string, unknown> | undefined,
    sessionId: string | undefined,
    debug: { enabled?: boolean; location: string; baseURL?: string; params?: Record<string, unknown> } | undefined,
    state: StreamAttemptState
  ): Promise<StreamResult> {
    const requestId = crypto.randomUUID();
    const startedAt = new Date().toISOString();
    const startedAtMs = Date.now();
    let estimatedTokens = 0;
    this.emitLlmStreamProgress(requestId, startedAt, estimatedTokens, "start", sessionId);

    const streamRequest: Record<string, unknown> = {
      ...request,
      stream: true,
      stream_options: {
        ...(isUsageRecord(request.stream_options) ? request.stream_options : {}),
        include_usage: true,
      },
    };

    // `extra_body` 是 OpenAI SDK 的专用参数，必须放在 create() 的第二个参数中，
    // SDK 会将其内容合并进实际发送的请求体。若留在 body 里会被当作普通字段序列化，
    // 导致 GLM 等严格校验的 API 报 "Extra inputs are not permitted, field: 'extra_body'"。
    const { extra_body, ...rest } = streamRequest;
    const createOptions: Record<string, unknown> = {
      ...(options ?? {}),
      ...(extra_body !== undefined ? { extra_body } : {}),
    };

    let response: unknown;
    try {
      response = await (
        client.chat.completions.create as unknown as (
          body: Record<string, unknown>,
          options?: Record<string, unknown>
        ) => Promise<unknown>
      )(rest, createOptions);
    } catch (error) {
      this.emitLlmStreamProgress(requestId, startedAt, estimatedTokens, "end", sessionId);
      throw error;
    }

    if (!response || typeof (response as { [Symbol.asyncIterator]?: unknown })[Symbol.asyncIterator] !== "function") {
      this.emitLlmStreamProgress(requestId, startedAt, estimatedTokens, "end", sessionId);
      return response as StreamResult;
    }

    let content = "";
    let reasoningContent = "";
    let refusal: string | null = null;
    let usage: ModelUsage | null = null;
    const toolCallsByIndex = new Map<
      number,
      {
        id?: string;
        type?: string;
        function?: { name?: string; arguments?: string };
      }
    >();

    const trackText = (value: unknown) => {
      if (typeof value !== "string" || value.length === 0) {
        return;
      }
      state.emitted = true;
      estimatedTokens += this.estimateStreamTokens(value);
      this.emitLlmStreamProgress(requestId, startedAt, estimatedTokens, "update", sessionId);
    };

    try {
      for await (const chunk of response as AsyncIterable<Record<string, unknown>>) {
        if ("usage" in chunk && chunk.usage != null) {
          usage = chunk.usage as ModelUsage;
        }

        const choices = Array.isArray(chunk.choices) ? chunk.choices : [];
        for (const choice of choices) {
          const delta = isUsageRecord(choice) && isUsageRecord(choice.delta) ? choice.delta : null;
          if (!delta) {
            continue;
          }

          const contentDelta = delta.content;
          if (typeof contentDelta === "string") {
            content += contentDelta;
            state.content = content;
            trackText(contentDelta);
          }

          const reasoningDelta = delta.reasoning_content ?? delta.reasoning;
          if (typeof reasoningDelta === "string") {
            reasoningContent += reasoningDelta;
            state.reasoning = reasoningContent;
            trackText(reasoningDelta);
          }

          if (typeof delta.refusal === "string") {
            refusal = `${refusal ?? ""}${delta.refusal}`;
            trackText(delta.refusal);
          }

          // 向前端推送流式增量
          if (typeof contentDelta === "string" && contentDelta.length > 0) {
            this.onChunk?.({ sessionId, content: contentDelta });
          }
          if (typeof reasoningDelta === "string" && reasoningDelta.length > 0) {
            this.onChunk?.({ sessionId, reasoningContent: reasoningDelta });
          }

          const rawToolCalls = delta.tool_calls;
          if (Array.isArray(rawToolCalls)) {
            for (const rawToolCall of rawToolCalls) {
              if (!isUsageRecord(rawToolCall)) {
                continue;
              }
              const index = typeof rawToolCall.index === "number" ? rawToolCall.index : toolCallsByIndex.size;
              const current = toolCallsByIndex.get(index) ?? {};
              if (typeof rawToolCall.id === "string") {
                current.id = rawToolCall.id;
              }
              if (typeof rawToolCall.type === "string") {
                current.type = rawToolCall.type;
              }
              const rawFunction = isUsageRecord(rawToolCall.function) ? rawToolCall.function : null;
              if (rawFunction) {
                current.function = current.function ?? {};
                if (typeof rawFunction.name === "string") {
                  current.function.name = `${current.function.name ?? ""}${rawFunction.name}`;
                  trackText(rawFunction.name);
                }
                if (typeof rawFunction.arguments === "string") {
                  current.function.arguments = `${current.function.arguments ?? ""}${rawFunction.arguments}`;
                  trackText(rawFunction.arguments);
                }
              }
              toolCallsByIndex.set(index, current);
            }
          }
        }
      }
    } finally {
      this.emitLlmStreamProgress(requestId, startedAt, estimatedTokens, "end", sessionId);
    }

    const toolCalls = Array.from(toolCallsByIndex.entries())
      .sort(([left], [right]) => left - right)
      .map(([, toolCall]) => toolCall);

    state.content = content;
    state.reasoning = reasoningContent;

    // 部分第三方 API 断流时会以“正常结束”的形式返回空内容，显式当作错误处理，
    // 让上层有机会重试，而不是产出一条空气泡。
    if (content.trim() === "" && toolCalls.length === 0 && refusal == null) {
      if (reasoningContent.trim() !== "") {
        throw new Error("Model returned reasoning content without a final answer (possibly truncated by max_tokens).");
      }
      throw new Error("API returned an empty response (no content, tool calls, or refusal).");
    }

    const message: Record<string, unknown> = { content };
    if (toolCalls.length > 0) {
      message.tool_calls = toolCalls;
    }
    if (reasoningContent.length > 0) {
      message.reasoning_content = reasoningContent;
    }
    if (refusal != null) {
      message.refusal = refusal;
    }

    const finalResponse: StreamResult = {
      choices: [{ message }],
      usage,
    };
    // 只记录摘要，不记录完整消息体，避免日志爆炸
    const messages = (Array.isArray(request.messages) ? request.messages : []) as Record<string, unknown>[];
    const tools = (Array.isArray(request.tools) ? request.tools : []) as Record<string, unknown>[];
    const requestSummary: Record<string, unknown> = {
      messageCount: messages.length,
      toolCount: tools.length,
      totalContentChars: messages.reduce((sum, m) => {
        const c = m.content;
        return sum + (typeof c === "string" ? c.length : 0);
      }, 0),
      maxTokens: request.max_tokens,
      temperature: request.temperature,
      reasoningEffort: request.reasoning_effort,
      stream: true,
    };
    const responseSummary: Record<string, unknown> = {
      contentLength: content.length,
      reasoningContentLength: reasoningContent.length,
      toolCallCount: toolCalls.length,
      usage,
    };
    logLlmCompletion({
      enabled: debug?.enabled,
      location: debug?.location ?? "LlmStreamManager.createStream",
      requestId,
      sessionId,
      model: typeof request.model === "string" ? request.model : undefined,
      baseURL,
      durationMs: Date.now() - startedAtMs,
      params: debug?.params,
      request: requestSummary,
      response: responseSummary,
    });
    return finalResponse;
  }

  // ─── 非流式调用（用于技能匹配等简单请求） ────────────

  /**
   * 非流式补全，返回文本内容与 usage。
   * 用于上下文压缩等不需要流式展示的场景。
   */
  async complete(
    request: Record<string, unknown>,
    options?: Record<string, unknown>
  ): Promise<{ content: string; usage: ModelUsage | null }> {
    const response = await this.createSimpleCompletion(request, options);
    const message = response.choices?.[0]?.message as { content?: unknown } | undefined;
    const content = typeof message?.content === "string" ? message.content : "";
    const usage = (response as { usage?: ModelUsage | null }).usage ?? null;
    return { content, usage };
  }

  async createSimpleCompletion(
    request: Record<string, unknown>,
    options?: Record<string, unknown>
  ): Promise<{ choices?: Array<{ message?: { content?: unknown } }>; usage?: ModelUsage | null }> {
    const { client, retryCount } = this.createClient();
    if (!client) {
      throw new Error("OpenAI client not available");
    }

    const maxRetries = normalizeRetryCount(retryCount);
    const signal = options?.signal as AbortSignal | undefined;
    let attempt = 0;

    for (;;) {
      try {
        return (await (
          client.chat.completions.create as unknown as (
            body: Record<string, unknown>,
            options?: Record<string, unknown>
          ) => Promise<unknown>
        )(request, options)) as {
          choices?: Array<{ message?: { content?: unknown } }>;
          usage?: ModelUsage | null;
        };
      } catch (error) {
        if (isAbortLikeError(error) || signal?.aborted) {
          throw error;
        }
        const info = classifyLlmError(error);
        if (!info.retryable || attempt >= maxRetries) {
          throw error;
        }
        attempt += 1;
        const delayMs = computeRetryDelay(attempt);
        this.onRetry?.({ attempt, maxRetries, delayMs, info });
        await delayWithSignal(delayMs, signal);
      }
    }
  }

}

// ─── 重试工具 ────────────────────────────────────────────

function computeRetryDelay(attempt: number): number {
  const base = Math.min(8000, 700 * 2 ** (attempt - 1));
  const jitter = 0.8 + Math.random() * 0.4;
  return Math.round(base * jitter);
}

function createAbortError(): Error {
  const error = new Error("Request was aborted.");
  error.name = "AbortError";
  return error;
}

function delayWithSignal(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(createAbortError());
      return;
    }

    const cleanup = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    };
    const onAbort = () => {
      cleanup();
      reject(createAbortError());
    };
    const timer = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);

    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
