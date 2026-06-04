/**
 * 会话管理器 — 编排层
 *
 * 负责会话生命周期的协调，将具体操作委托给子模块。
 *
 * 子模块：
 * - SessionStorage          → 持久化
 * - SessionFileHistory      → 文件变更可撤回
 * - SessionProcessManager   → 进程追踪
 * - SessionMessageBuilder   → 消息构建 + OpenAI 装配
 * - LlmStreamManager        → LLM 流式调用
 * - SessionActivator        → LLM 主循环 + 上下文压缩
 * - SessionNotifier         → 提示上报 + 任务完成通知
 */

import * as crypto from "crypto";
import { getExtensionRoot } from "./prompt";
import type { ToolDefinition } from "./prompt";
import { ToolExecutor } from "./tools/executor";
import type { CreateOpenAIClient } from "./tools/types";
import { McpManager } from "./mcp/mcp-manager";
import type { McpServerConfig } from "./settings";
import { getActivePreset } from "./common/global-settings";
import { killProcessTree } from "./common/process-tree";

import { SessionStorage } from "./session-storage";
import { SessionFileHistory } from "./session-file-history";
import { SessionProcessManager } from "./session-process";
import { SessionMessageBuilder } from "./session-message-builder";
import { LlmStreamManager } from "./llm-stream";
import { SessionActivator } from "./session-activator";
import { SessionNotifier } from "./session-notify";
import { PresetManager } from "./preset-manager";
import type {
  SessionMessage,
  SessionEntry,
  LlmStreamProgress,
  UserPromptContent,
  MessageMeta,
  SessionManagerOptions,
  BashTimeoutAdjustment,
  UndoTarget,
} from "./session-types";

// ─── 类型 re-export ──────────────────────────────────────

export type {
  SessionStatus,
  ModelUsage,
  SessionProcessEntry,
  BashTimeoutAdjustment,
  SessionEntry,
  SessionsIndex,
  SessionMessageRole,
  MessageMeta,
  SessionMessage,
  UndoTarget,
  UserPromptContent,
  SessionManagerOptions,
  LlmStreamProgress,
} from "./session-types";

// ─── SessionManager ──────────────────────────────────────

export class SessionManager {
  /* 依赖注入 */
  private readonly projectRoot: string;
  private readonly createOpenAIClient: CreateOpenAIClient;
  private readonly getResolvedSettings: () => {
    model: string;
    webSearchTool?: string;
    mcpServers?: Record<string, McpServerConfig>;
    debugEnabled: boolean;
  };
  private readonly onAssistantMessage: (
    message: SessionMessage,
    shouldConnect: boolean
  ) => void;
  private readonly onSessionEntryUpdated?: (entry: SessionEntry) => void;
  private readonly onLlmStreamProgress?: (progress: LlmStreamProgress) => void;
  private readonly onStreamChunk?: (chunk: { sessionId?: string; content?: string; reasoningContent?: string }) => void;
  private readonly onNotify?: (level: "success" | "error" | "warning" | "info", text: string, duration?: number) => void;
  private readonly onMcpStatusChanged?: () => void;
  private readonly onProcessStdout?: (pid: number, chunk: string) => void;

  /* 子模块 */
  private readonly storage: SessionStorage;
  private readonly fileHistory: SessionFileHistory;
  private readonly processMgr: SessionProcessManager;
  private readonly messageBuilder: SessionMessageBuilder;
  private readonly llm: LlmStreamManager;
  private readonly activator: SessionActivator;
  private readonly notifier: SessionNotifier;
  private readonly toolExecutor: ToolExecutor;
  readonly presetMgr: PresetManager;

  /* MCP */
  private readonly mcpManager = new McpManager();
  private mcpToolDefinitions: ToolDefinition[] = [];

  /* 运行时状态 */
  private activeSessionId: string | null = null;
  private activePromptController: AbortController | null = null;
  /** 由 runActivate 创建，供 interruptSession 中止 LLM 请求 */
  private readonly activationControllers = new Map<string, AbortController>();

  constructor(options: SessionManagerOptions) {
    this.projectRoot = options.projectRoot;
    this.createOpenAIClient = options.createOpenAIClient;
    this.getResolvedSettings = options.getResolvedSettings;
    this.onAssistantMessage = options.onAssistantMessage;
    this.onSessionEntryUpdated = options.onSessionEntryUpdated;
    this.onLlmStreamProgress = options.onLlmStreamProgress;
    this.onStreamChunk = options.onStreamChunk;
    this.onNotify = options.onNotify;
    this.onMcpStatusChanged = options.onMcpStatusChanged;
    this.onProcessStdout = options.onProcessStdout;

    this.storage = new SessionStorage(this.projectRoot);
    this.fileHistory = new SessionFileHistory(this.projectRoot, this.storage);
    this.processMgr = new SessionProcessManager();
    this.messageBuilder = new SessionMessageBuilder(this.projectRoot, this.storage, this.fileHistory);
    this.llm = new LlmStreamManager(this.createOpenAIClient);
    this.toolExecutor = new ToolExecutor(this.projectRoot, this.createOpenAIClient, this.mcpManager);
    this.presetMgr = new PresetManager(getExtensionRoot());
    this.notifier = new SessionNotifier(this.storage, this.createOpenAIClient, (sid) => this.getSession(sid));
    this.activator = new SessionActivator(
      this.storage,
      this.messageBuilder,
      this.llm,
      this.notifier,
      this.createOpenAIClient,
      this.projectRoot,
      (sid) => this.getSession(sid)
    );

    this.llm.onProgress = (progress) => this.onLlmStreamProgress?.(progress);
    this.llm.onChunk = (chunk) => this.onStreamChunk?.(chunk);
    this.mcpManager.prepare(this.getResolvedSettings().mcpServers);
  }

  // ═══════════════════════════════════════════════════════
  //  MCP
  // ═══════════════════════════════════════════════════════

  async initMcpServers(servers?: Record<string, McpServerConfig>): Promise<void> {
    this.mcpManager.setOnToolsListChanged(() => {
      this.mcpToolDefinitions = this.mcpManager.getMcpToolDefinitions();
    });
    this.mcpManager.setOnStatusChanged(() => this.onMcpStatusChanged?.());
    await this.mcpManager.initialize(servers);
    this.mcpToolDefinitions = this.mcpManager.getMcpToolDefinitions();
  }

  getMcpStatus() {
    return this.mcpManager.getStatus();
  }

  async reconnectMcpServer(name: string, config?: McpServerConfig): Promise<void> {
    await this.mcpManager.reconnect(name, config);
    this.mcpToolDefinitions = this.mcpManager.getMcpToolDefinitions();
  }

  dispose(): void {
    this.mcpManager.disconnect();
  }

  // ═══════════════════════════════════════════════════════
  //  会话状态
  // ═══════════════════════════════════════════════════════

  getActiveSessionId(): string | null {
    return this.activeSessionId;
  }

  setActiveSessionId(sessionId: string | null): void {
    this.activeSessionId = sessionId;
  }

  addSessionSystemMessage(
    sessionId: string,
    content: string,
    visible?: boolean,
    meta?: MessageMeta
  ): void {
    const message = this.messageBuilder.buildSystemMessage(sessionId, content, null, visible, meta);
    if (sessionId) this.storage.appendSessionMessage(sessionId, message);
    this.onAssistantMessage(message, false);
  }

  // ═══════════════════════════════════════════════════════
  //  用户提示词处理
  // ═══════════════════════════════════════════════════════

  async handleUserPrompt(userPrompt: UserPromptContent): Promise<void> {
    console.log("[DEBUG] handleUserPrompt enter", JSON.stringify({ text: userPrompt.text?.slice(0, 50) }));
    const controller = new AbortController();
    this.activePromptController = controller;

    try {
      if (!this.activeSessionId || !this.getSession(this.activeSessionId)) {
        console.log("[DEBUG] handleUserPrompt: no active session, creating new");
        this.createSession(userPrompt);
      }
      console.log("[DEBUG] handleUserPrompt: activeSessionId =", this.activeSessionId);
      await this.sendMessage(this.activeSessionId!, userPrompt, controller);
    } catch (error) {
      if (!this.isAbortLikeError(error) && !controller.signal.aborted) {
        throw error;
      }
    } finally {
      if (this.activePromptController === controller) {
        this.activePromptController = null;
      }
    }
  }

  // ═══════════════════════════════════════════════════════
  //  创建会话
  // ═══════════════════════════════════════════════════════

  /**
   * 创建会话索引（同步，不触发 LLM）。
   * 消息发送统一由 sendMessage 处理。
   */
  createSession(userPrompt: UserPromptContent): string {
    this.notifier.reportNewPrompt();

    const sessionId = crypto.randomUUID();
    console.log("[DEBUG] createSession: new sessionId =", sessionId);
    this.fileHistory.ensureSession(sessionId);
    const now = new Date().toISOString();
    const index = this.storage.loadSessionsIndex();
    const entry: SessionEntry = {
      id: sessionId,
      summary: userPrompt.text ? userPrompt.text.slice(0, 100) : "[Image Prompt]",
      assistantReply: null,
      assistantThinking: null,
      assistantRefusal: null,
      toolCalls: null,
      status: "pending",
      failReason: null,
      usage: null,
      lastUsage: null,
      createTime: now,
      updateTime: now,
      processes: null,
    };
    index.entries.push(entry);

    const { kept, dropped } = this.storage.trimSessionsIndex(index);
    this.storage.saveSessionsIndex(kept);
    this.storage.removeSessionMessages(dropped);
    // 清理被丢弃会话的 file-history git 分支
    for (const droppedId of dropped) {
      this.fileHistory.deleteSession(droppedId);
    }

    this.activeSessionId = sessionId;
    return sessionId;
  }

  // ═══════════════════════════════════════════════════════
  //  回复会话
  // ═══════════════════════════════════════════════════════

  /**
   * 统一发送消息（首次和后续对话共用）。
   * 不负责创建会话索引，由调用方保证 session 已存在。
   */
  async sendMessage(
    sessionId: string,
    userPrompt: UserPromptContent,
    controller?: AbortController
  ): Promise<void> {
    const signal = controller?.signal;
    this.throwIfAborted(signal);
    const now = new Date().toISOString();

    // 更新会话状态
    this.storage.updateSessionEntry(sessionId, (entry) => ({
      ...entry,
      status: "pending",
      failReason: null,
      updateTime: now,
    }));

    // /continue → 直接继续 LLM 主循环，不加新消息
    if (this.isContinuePrompt(userPrompt)) {
      await this.runActivate(sessionId, controller);
      return;
    }

    this.notifier.reportNewPrompt();
    this.fileHistory.ensureSession(sessionId);

    console.log("[DEBUG] sendMessage: appending user msg, sessionId =", sessionId);
    // 增量保存：只追加用户消息，预设由 SessionActivator 运行时注入
    const newUserMsg = this.messageBuilder.buildUserMessage(sessionId, userPrompt);
    this.storage.appendSessionMessage(sessionId, newUserMsg);
    // 将真实消息（含 checkpointHash）发回前端，替换本地创建的假气泡
    this.onAssistantMessage(newUserMsg, false);
    console.log("[DEBUG] sendMessage: user msg appended, calling runActivate");

    this.activeSessionId = sessionId;
    await this.runActivate(sessionId, controller);
    console.log("[DEBUG] sendMessage: runActivate returned");
  }

  /**
   * 回复会话（公开接口，委托给 sendMessage）。
   * 如 session 不存在则自动创建。
   */
  async replySession(
    sessionId: string,
    userPrompt: UserPromptContent,
    controller?: AbortController
  ): Promise<void> {
    const existing = this.getSession(sessionId);
    if (!existing) {
      this.createSession(userPrompt);
      sessionId = this.activeSessionId!;
    }
    await this.sendMessage(sessionId, userPrompt, controller);
  }

  /**
   * 激活会话主循环（公开供测试 mock）
   * 委托给 SessionActivator.activate()
   */
  async activateSession(sessionId: string, controller?: AbortController): Promise<void> {
    await this.runActivate(sessionId, controller);
  }

  /** 委托给 SessionActivator 执行主循环 */
  private async runActivate(sessionId: string, controller?: AbortController): Promise<void> {
    const ctrl = controller ?? new AbortController();
    this.activationControllers.set(sessionId, ctrl);
    try {
      await this.activator.activate(sessionId, {
        controller: ctrl,
        mcpToolDefinitions: this.mcpToolDefinitions,
        getPromptToolOptions: () => this.getPromptToolOptions(),
        appendToolMessages: (sid, calls) => this.appendToolMessages(sid, calls),
        onAssistantMessage: (msg, connect) => this.onAssistantMessage(msg, connect),
        onSessionEntryUpdated: (entry) => this.onSessionEntryUpdated?.(entry),
        onNotify: this.onNotify,
        debugEnabled: this.getResolvedSettings().debugEnabled,
        presetMgr: this.presetMgr,
        activePreset: getActivePreset(),
      });
    } finally {
      this.activationControllers.delete(sessionId);
    }
  }

  // ═══════════════════════════════════════════════════════
  //  中断
  // ═══════════════════════════════════════════════════════

  interruptActiveSession(): void {
    this.activePromptController?.abort();
    const sessionId = this.activeSessionId;
    if (sessionId) this.interruptSession(sessionId);
  }

  interruptSession(sessionId: string): void {
    const session = this.getSession(sessionId);
    const processIds = this.processMgr.getActivePids(session?.processes ?? null);
    const killedPids: number[] = [];
    const failedPids: number[] = [];
    for (const pid of processIds) {
      this.processMgr.clearSessionControls(sessionId);
      if (killProcessTree(pid, "SIGKILL")) {
        killedPids.push(pid);
      } else {
        failedPids.push(pid);
      }
    }

    // 中止 LLM 请求
    this.activationControllers.get(sessionId)?.abort();

    const now = new Date().toISOString();
    this.storage.updateSessionEntry(sessionId, (entry) => ({
      ...entry,
      status: "interrupted",
      failReason: "interrupted",
      processes: null,
      updateTime: now,
    }));

    const contentParts = ["Interrupted."];
    if (killedPids.length > 0) contentParts.push(`Killed processes: ${killedPids.join(", ")}.`);
    if (failedPids.length > 0) contentParts.push(`Failed to kill processes: ${failedPids.join(", ")}.`);

    this.onAssistantMessage(this.messageBuilder.buildUserMessage(sessionId, { text: contentParts.join(" ") }), false);
  }

  // ═══════════════════════════════════════════════════════
  //  Bash 超时调整
  // ═══════════════════════════════════════════════════════

  adjustActiveBashTimeout(deltaMs: number): BashTimeoutAdjustment | null {
    const sessionId = this.activeSessionId;
    if (!sessionId || !Number.isFinite(deltaMs)) return null;
    const session = this.getSession(sessionId);
    if (!session?.processes) return null;

    const controlledPids = this.processMgr.getControlledPids(sessionId, session.processes);
    if (!controlledPids.length) return null;

    const selectedPid = controlledPids[0];
    const adjustment = this.processMgr.adjustTimeout(sessionId, selectedPid, deltaMs);
    if (!adjustment) return null;

    const updatedProcesses = this.processMgr.updateProcessTimeout(
      session.processes,
      sessionId,
      selectedPid,
      adjustment.info
    );
    this.storage.updateSessionEntry(sessionId, (entry) => ({
      ...entry,
      processes: updatedProcesses,
      updateTime: new Date().toISOString(),
    }));

    return this.processMgr.buildAdjustment(selectedPid, adjustment.info);
  }

  // ═══════════════════════════════════════════════════════
  //  查询
  // ═══════════════════════════════════════════════════════

  listSessions(): SessionEntry[] {
    return this.storage.loadSessionsIndex().entries;
  }

  getSession(sessionId: string): SessionEntry | null {
    return this.storage.loadSessionsIndex().entries.find((e) => e.id === sessionId) ?? null;
  }

  listSessionMessages(sessionId: string): SessionMessage[] {
    return this.storage.listSessionMessages(sessionId).map((m) => this.messageBuilder.normalizeSessionMessage(m));
  }

  listUndoTargets(sessionId: string): UndoTarget[] {
    return this.fileHistory.listUndoTargets(sessionId);
  }

  rollbackToMessage(sessionId: string, messageId: string): SessionMessage[] {
    const { keptMessages, checkpointHash } = this.fileHistory.rollbackToMessage(sessionId, messageId);
    const now = new Date().toISOString();
    const latestAssistant = [...keptMessages].reverse().find((m) => m.role === "assistant");
    const latestParams = latestAssistant?.messageParams as
      | { tool_calls?: unknown[]; reasoning_content?: string }
      | null
      | undefined;

    this.storage.updateSessionEntry(sessionId, (entry) => ({
      ...entry,
      assistantReply: latestAssistant?.content ?? null,
      assistantThinking: typeof latestParams?.reasoning_content === "string" ? latestParams.reasoning_content : null,
      assistantRefusal: null,
      toolCalls: null,
      status: "completed",
      failReason: null,
      processes: null,
      updateTime: now,
    }));
    return keptMessages;
  }

  // ═══════════════════════════════════════════════════════
  //  工具消息追加
  // ═══════════════════════════════════════════════════════

  private async appendToolMessages(sessionId: string, toolCalls: unknown[]): Promise<{ waitingForUser: boolean }> {
    const toolExecutions = await this.toolExecutor.executeToolCalls(sessionId, toolCalls, {
      onProcessStart: (pid, command) => {
        const session = this.getSession(sessionId);
        const updatedProcesses = this.processMgr.addProcess(session?.processes ?? null, pid, command);
        this.storage.updateSessionEntry(sessionId, (e) => ({
          ...e,
          processes: updatedProcesses,
          updateTime: new Date().toISOString(),
        }));
      },
      onProcessExit: (pid) => {
        const session = this.getSession(sessionId);
        const updatedProcesses = this.processMgr.removeProcess(session?.processes ?? null, pid);
        this.storage.updateSessionEntry(sessionId, (e) => ({
          ...e,
          processes: updatedProcesses,
          updateTime: new Date().toISOString(),
        }));
      },
      onProcessStdout: (pid, chunk) => this.onProcessStdout?.(Number(pid), chunk),
      onProcessTimeoutControl: (pid, control) => {
        this.processMgr.setControl(sessionId, pid, control);
        if (control) {
          const session = this.getSession(sessionId);
          if (session?.processes) {
            const updated = this.processMgr.updateProcessTimeout(session.processes, sessionId, pid, control.getInfo());
            this.storage.updateSessionEntry(sessionId, (e) => ({
              ...e,
              processes: updated,
              updateTime: new Date().toISOString(),
            }));
          }
        }
      },
      onBeforeFileMutation: (filePath) => this.fileHistory.prepareMutation(sessionId, filePath),
      onAfterFileMutation: (filePath) => this.fileHistory.recordMutation(sessionId, filePath),
      shouldStop: () => !this.activator.hasController(sessionId),
    });

    if (!this.activator.hasController(sessionId)) return { waitingForUser: false };

    let waitingForUser = false;
    const followUpMessages: SessionMessage[] = [];
    for (const execution of toolExecutions) {
      if (execution.result.awaitUserResponse === true) waitingForUser = true;
      const toolFunction = this.messageBuilder.findToolFunction(toolCalls, execution.toolCallId);
      const toolMessage = this.messageBuilder.buildToolMessage(
        sessionId,
        execution.toolCallId,
        execution.content,
        toolFunction
      );
      this.storage.appendSessionMessage(sessionId, toolMessage);
      this.onAssistantMessage(toolMessage, true);

      for (const fup of execution.result.followUpMessages ?? []) {
        if (fup.role !== "system") continue;
        followUpMessages.push(
          this.messageBuilder.buildSystemMessage(sessionId, fup.content, fup.contentParams ?? null)
        );
      }
    }
    for (const m of followUpMessages) this.storage.appendSessionMessage(sessionId, m);
    return { waitingForUser };
  }

  // ═══════════════════════════════════════════════════════
  //  删除会话
  // ═══════════════════════════════════════════════════════

  /**
   * 删除指定会话：从索引移除 + 删除消息文件
   * @returns 删除后的剩余会话列表
   */
  deleteSession(sessionId: string): SessionEntry[] {
    this.storage.deleteSession(sessionId);
    this.fileHistory.deleteSession(sessionId);
    // 如果删除的是当前活跃会话，清空
    if (this.activeSessionId === sessionId) {
      this.activeSessionId = null;
    }
    return this.listSessions();
  }

  // ═══════════════════════════════════════════════════════
  //  内部工具
  // ═══════════════════════════════════════════════════════

  private getPromptToolOptions(): { model: string; availableTools?: string[] } {
    const base = { model: this.getResolvedSettings().model };

    // 从当前激活的预设获取 availableTools
    try {
      const presetName = getActivePreset();
      const preset = presetName !== "default"
        ? this.presetMgr.loadPreset(presetName)
        : this.presetMgr.ensureDefaultPreset();
      if (preset.availableTools && preset.availableTools.length > 0) {
        return { ...base, availableTools: preset.availableTools };
      }
    } catch {
      // 预设加载失败时只返回 base
    }

    return base;
  }

  private isContinuePrompt(userPrompt: UserPromptContent): boolean {
    return (
      typeof userPrompt.text === "string" &&
      userPrompt.text.trim() === "/continue" &&
      (!userPrompt.imageUrls || userPrompt.imageUrls.length === 0)
    );
  }

  private isAbortLikeError(error: unknown): boolean {
    if (!(error instanceof Error)) return false;
    return error.name === "AbortError" || error.constructor.name === "APIUserAbortError";
  }

  private throwIfAborted(signal?: AbortSignal | null): void {
    if (signal?.aborted) {
      const error = new Error("Request was aborted.");
      error.name = "AbortError";
      throw error;
    }
  }
}
