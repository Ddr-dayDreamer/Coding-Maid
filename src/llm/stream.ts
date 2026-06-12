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

export class LlmStreamManager {
  private readonly createClient: CreateOpenAIClient;
  public onProgress?: (progress: LlmStreamProgress) => void;
  public onChunk?: (chunk: StreamChunk) => void;

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

  async createStream(
    request: Record<string, unknown>,
    options?: Record<string, unknown>,
    sessionId?: string,
    debug?: { enabled?: boolean; location: string; baseURL?: string; params?: Record<string, unknown> }
  ): Promise<StreamResult> {
    const { client, baseURL } = this.createClient();
    if (!client) {
      throw new Error("OpenAI client not available");
    }

    const requestId = crypto.randomUUID();
    const startedAt = new Date().toISOString();
    const startedAtMs = Date.now();
    let estimatedTokens = 0;
    this.emitLlmStreamProgress(requestId, startedAt, estimatedTokens, "start", sessionId);

    const streamRequest = {
      ...request,
      stream: true,
      stream_options: {
        ...(isUsageRecord(request.stream_options) ? request.stream_options : {}),
        include_usage: true,
      },
    };

    let response: unknown;
    try {
      response = await (
        client.chat.completions.create as unknown as (
          body: Record<string, unknown>,
          options?: Record<string, unknown>
        ) => Promise<unknown>
      )(streamRequest, options);
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
            trackText(contentDelta);
          }

          const reasoningDelta = delta.reasoning_content ?? delta.reasoning;
          if (typeof reasoningDelta === "string") {
            reasoningContent += reasoningDelta;
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

  async createSimpleCompletion(
    request: Record<string, unknown>,
    options?: Record<string, unknown>
  ): Promise<{ choices?: Array<{ message?: { content?: unknown } }> }> {
    const { client } = this.createClient();
    if (!client) {
      throw new Error("OpenAI client not available");
    }

    return (
      client.chat.completions.create as unknown as (
        body: Record<string, unknown>,
        options?: Record<string, unknown>
      ) => Promise<unknown>
    )(request, options) as Promise<{
      choices?: Array<{ message?: { content?: unknown } }>;
    }>;
  }

}
