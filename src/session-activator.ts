/**
 * 会话激活器
 *
 * 负责 LLM 主循环（activate）和上下文压缩（compact）。
 * 从 session.ts 拆分。
 */

import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import { buildThinkingRequestOptions } from "./common/openai-thinking";
import { getCompactPrompt, getTools, type ToolDefinition } from "./prompt";
import type { CreateOpenAIClient } from "./tools/executor";
import type { SessionStorage } from "./session-storage";
import type { SessionMessageBuilder } from "./session-message-builder";
import type { SessionNotifier } from "./session-notify";
import type { SessionEntry, SessionMessage } from "./session-types";
import type {
  LlmStreamManager} from "./llm-stream";
import {
  getCompactPromptTokenThreshold,
  accumulateUsage,
  accumulateUsagePerModel,
  getTotalTokens,
} from "./llm-stream";

// ─── Activate 选项 ───────────────────────────────────────

export type ActivateOptions = {
  controller?: AbortController;
  mcpToolDefinitions: ToolDefinition[];
  getPromptToolOptions: () => { model: string; webSearchEnabled: boolean };
  appendToolMessages: (sessionId: string, toolCalls: unknown[]) => Promise<{ waitingForUser: boolean }>;
  onAssistantMessage: (message: SessionMessage, shouldConnect: boolean) => void;
  onSessionEntryUpdated?: (entry: SessionEntry) => void;
  onDebugPrompt?: (messages: ChatCompletionMessageParam[], iteration: number) => void;
};

// ─── SessionActivator ────────────────────────────────────

export class SessionActivator {
  private readonly sessionControllers: Map<string, AbortController>;

  constructor(
    private readonly storage: SessionStorage,
    private readonly messageBuilder: SessionMessageBuilder,
    private readonly llm: LlmStreamManager,
    private readonly notifier: SessionNotifier,
    private readonly createOpenAIClient: CreateOpenAIClient,
    private readonly projectRoot: string,
    private readonly getSession: (sessionId: string) => SessionEntry | null
  ) {
    this.sessionControllers = new Map();
  }

  /** 外部可通过此方法注册 AbortController（来自 SessionManager） */
  setController(sessionId: string, controller: AbortController): void {
    this.sessionControllers.set(sessionId, controller);
  }

  removeController(sessionId: string): void {
    this.sessionControllers.delete(sessionId);
  }

  hasController(sessionId: string): boolean {
    return this.sessionControllers.has(sessionId);
  }

  // ═══════════════════════════════════════════════════════
  //  主循环
  // ═══════════════════════════════════════════════════════

  async activate(sessionId: string, opts: ActivateOptions): Promise<void> {
    const startedAt = Date.now();
    const {
      client,
      model,
      baseURL,
      thinkingEnabled,
      reasoningEffort,
      params,
      debugLogEnabled,
      debugPromptEnabled,
      notify,
      env,
    } = this.createOpenAIClient();
    const now = new Date().toISOString();

    if (!client) {
      this.storage.updateSessionEntry(sessionId, (entry) => ({
        ...entry,
        status: "failed",
        failReason: "OpenAI API key not found",
        updateTime: now,
      }));
      opts.onAssistantMessage(
        this.messageBuilder.buildAssistantMessage(
          sessionId,
          "OpenAI API key not found. Please configure ~/.deepcode/settings.json or ./.deepcode/settings.json.",
          null
        ),
        false
      );
      this.notifier.maybeNotifyTaskCompletion(sessionId, notify, startedAt, this.projectRoot, env);
      return;
    }

    const sessionController = opts.controller ?? new AbortController();
    if (sessionController.signal.aborted) {
      this.storage.updateSessionEntry(sessionId, (entry) => ({
        ...entry,
        status: "interrupted",
        failReason: "interrupted",
        updateTime: now,
      }));
      this.notifier.maybeNotifyTaskCompletion(sessionId, notify, startedAt, this.projectRoot, env);
      return;
    }

    this.storage.updateSessionEntry(sessionId, (entry) => ({
      ...entry,
      status: "processing",
      updateTime: now,
    }));

    this.sessionControllers.set(sessionId, sessionController);

    try {
      const maxIterations = 80000;
      let toolCalls: unknown[] | null = null;

      for (let iteration = 0; iteration < maxIterations; iteration++) {
        if (this.isInterruptedLocal(sessionId)) {
          return;
        }

        const session = this.getSession(sessionId);
        if (session == null || session.status === "interrupted" || session.status === "failed") {
          return;
        }

        // 处理待执行的工具调用
        const pendingToolCalls = this.messageBuilder.getTrailingPendingToolCalls(
          this.storage.listSessionMessages(sessionId)
        );
        if (pendingToolCalls.length > 0) {
          const toolAppendResult = await opts.appendToolMessages(sessionId, pendingToolCalls);
          if (this.isInterruptedLocal(sessionId)) {
            return;
          }
          if (toolAppendResult.waitingForUser) {
            this.storage.updateSessionEntry(sessionId, (entry) => ({
              ...entry,
              toolCalls: pendingToolCalls,
              status: "waiting_for_user",
              updateTime: new Date().toISOString(),
            }));
            return;
          }
        }

        // 上下文压缩
        const compactPromptTokenThreshold = getCompactPromptTokenThreshold(model);
        if (session.activeTokens > compactPromptTokenThreshold) {
          const msg = this.messageBuilder.buildAssistantMessage(
            sessionId,
            "The conversation is getting long, compacting...",
            null
          );
          msg.meta = { asThinking: true };
          opts.onAssistantMessage(msg, false);
          await this.compact(sessionId, sessionController.signal, opts.onDebugPrompt);
        }

        // 构建消息 → 调用 LLM
        const messages = this.messageBuilder.buildOpenAIMessages(
          this.storage.listSessionMessages(sessionId),
          thinkingEnabled ?? false,
          model
        );
        if (debugPromptEnabled && opts.onDebugPrompt) {
          opts.onDebugPrompt(messages, iteration);
        }

        const thinkingOptions = thinkingEnabled
          ? buildThinkingRequestOptions(thinkingEnabled, baseURL, reasoningEffort)
          : {};

        const response = await this.llm.createStream(
          {
            model,
            messages,
            tools: getTools(opts.getPromptToolOptions(), opts.mcpToolDefinitions),
            ...thinkingOptions,
            ...params,
          },
          { signal: sessionController.signal },
          sessionId,
          {
            enabled: debugLogEnabled,
            location: "SessionActivator.activate",
            baseURL,
            params: { iteration, thinkingEnabled, reasoningEffort },
          }
        );

        const message = response.choices?.[0]?.message;
        const rawContent = message?.content;
        const content = typeof rawContent === "string" ? rawContent : "";
        const rawToolCalls = (message as { tool_calls?: unknown[] } | undefined)?.tool_calls ?? null;
        toolCalls = this.messageBuilder.normalizeLlmToolCalls(rawToolCalls);
        const rawThinking = (message as { reasoning_content?: unknown } | undefined)?.reasoning_content;
        const thinking = typeof rawThinking === "string" ? rawThinking : null;
        const refusal = (message as { refusal?: string } | undefined)?.refusal ?? null;

        if (this.isInterruptedLocal(sessionId)) {
          return;
        }

        const assistantMessage = this.messageBuilder.buildAssistantMessage(sessionId, content, toolCalls, thinking);
        this.storage.appendSessionMessage(sessionId, assistantMessage);
        opts.onAssistantMessage(assistantMessage, true);

        let waitingForUser = false;
        if (toolCalls) {
          const toolAppendResult = await opts.appendToolMessages(sessionId, toolCalls);
          waitingForUser = toolAppendResult.waitingForUser;
        }

        if (this.isInterruptedLocal(sessionId)) {
          return;
        }

        const responseUsage = response.usage ?? null;
        this.storage.updateSessionEntry(sessionId, (entry) => ({
          ...entry,
          assistantReply: content,
          assistantThinking: thinking,
          assistantRefusal: refusal,
          toolCalls,
          usage: accumulateUsage(entry.usage, responseUsage),
          usagePerModel: accumulateUsagePerModel(entry.usagePerModel, model, responseUsage),
          activeTokens: getTotalTokens(responseUsage),
          status: refusal ? "failed" : waitingForUser ? "waiting_for_user" : toolCalls ? "processing" : "completed",
          failReason: refusal ? refusal : entry.failReason,
          updateTime: new Date().toISOString(),
        }));

        opts.onSessionEntryUpdated?.(this.getSession(sessionId)!);

        if (refusal || waitingForUser || !toolCalls) {
          return;
        }
      }

      // 超过最大迭代次数
      this.storage.updateSessionEntry(sessionId, (entry) => ({
        ...entry,
        status: "completed",
        updateTime: new Date().toISOString(),
      }));
      opts.onAssistantMessage(
        this.messageBuilder.buildAssistantMessage(
          sessionId,
          "The AI agent has taken several steps but hasn't reached a conclusion yet. Do you want to continue?",
          null
        ),
        false
      );
    } catch (error) {
      const errMessage = error instanceof Error ? error.message : String(error);
      const aborted = this.isAbortLikeError(error) || sessionController.signal.aborted;
      this.storage.updateSessionEntry(sessionId, (entry) => ({
        ...entry,
        status: aborted ? "interrupted" : "failed",
        failReason: aborted ? "interrupted" : errMessage,
        updateTime: new Date().toISOString(),
      }));

      if (!aborted) {
        opts.onAssistantMessage(
          this.messageBuilder.buildAssistantMessage(sessionId, `Request failed: ${errMessage}`, null),
          false
        );
      }
    } finally {
      if (this.sessionControllers.get(sessionId) === sessionController) {
        this.sessionControllers.delete(sessionId);
      }
      this.notifier.maybeNotifyTaskCompletion(sessionId, notify, startedAt, this.projectRoot, env);
    }
  }

  // ═══════════════════════════════════════════════════════
  //  上下文压缩
  // ═══════════════════════════════════════════════════════

  async compact(
    sessionId: string,
    signal?: AbortSignal,
    onDebugPrompt?: (messages: ChatCompletionMessageParam[], iteration: number) => void
  ): Promise<void> {
    this.throwIfAborted(signal);
    const { client, model, baseURL, thinkingEnabled, reasoningEffort, params, debugLogEnabled, debugPromptEnabled } =
      this.createOpenAIClient();
    if (!client) {
      return;
    }

    const sessionMessages = this.storage.listSessionMessages(sessionId).filter((message) => !message.compacted);
    if (sessionMessages.length === 0) {
      return;
    }

    const startIndex = sessionMessages.findIndex((message) => message.role !== "system");
    if (startIndex === -1) {
      return;
    }

    const searchStart = Math.floor(startIndex + ((sessionMessages.length - startIndex) * 2) / 3);
    let endIndex = -1;
    for (let i = Math.max(searchStart, startIndex); i < sessionMessages.length; i += 1) {
      if (sessionMessages[i].role !== "tool") {
        endIndex = i;
        break;
      }
    }
    if (endIndex === -1 || endIndex <= startIndex) {
      return;
    }

    const compactPrompt = getCompactPrompt(sessionMessages.slice(startIndex, endIndex));
    if (debugPromptEnabled && onDebugPrompt) {
      onDebugPrompt([{ role: "system", content: compactPrompt }], -1);
    }

    const thinkingOptions = thinkingEnabled
      ? buildThinkingRequestOptions(thinkingEnabled, baseURL, reasoningEffort)
      : {};

    const response = await this.llm.createStream(
      {
        model,
        messages: [{ role: "user", content: compactPrompt }],
        ...thinkingOptions,
        ...params,
      },
      signal ? { signal } : undefined,
      sessionId,
      {
        enabled: debugLogEnabled,
        location: "SessionActivator.compact",
        baseURL,
        params: { thinkingEnabled, reasoningEffort },
      }
    );
    this.throwIfAborted(signal);

    const rawLlmResponse = response.choices?.[0]?.message?.content;
    const llmResponse = typeof rawLlmResponse === "string" ? rawLlmResponse : "";
    const compactedSummary = llmResponse.replace(/<analysis>[\s\S]*?<\/analysis>/gi, "").trim();

    const now = new Date().toISOString();
    const responseUsage = response.usage ?? null;
    this.storage.updateSessionEntry(sessionId, (entry) => ({
      ...entry,
      usage: accumulateUsage(entry.usage, responseUsage),
      usagePerModel: accumulateUsagePerModel(entry.usagePerModel, model, responseUsage),
      activeTokens: getTotalTokens(responseUsage),
      updateTime: now,
    }));

    for (let i = startIndex; i < endIndex; i += 1) {
      sessionMessages[i] = { ...sessionMessages[i], compacted: true, updateTime: now };
    }

    const summaryMessage = this.messageBuilder.buildSystemMessage(
      sessionId,
      `There are earlier parts of the conversation. Here is a summary: \n\n${compactedSummary}`,
      null,
      false,
      { isSummary: true }
    );
    sessionMessages.splice(endIndex, 0, summaryMessage);
    this.storage.saveSessionMessages(sessionId, sessionMessages);
  }

  // ═══════════════════════════════════════════════════════
  //  内部工具
  // ═══════════════════════════════════════════════════════

  private isInterruptedLocal(sessionId: string): boolean {
    return !this.sessionControllers.has(sessionId);
  }

  private isAbortLikeError(error: unknown): boolean {
    if (!(error instanceof Error)) {
      return false;
    }
    return error.name === "AbortError" || error.constructor.name === "APIUserAbortError";
  }

  private throwIfAborted(signal?: AbortSignal | null): void {
    if (!signal?.aborted) {
      return;
    }
    const error = new Error("Request was aborted.");
    error.name = "AbortError";
    throw error;
  }
}
