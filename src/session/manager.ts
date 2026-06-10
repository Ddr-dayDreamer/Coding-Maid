/**
 * 会话管理
 *
 * 负责会话生命周期的协调，将具体操作委托给子模块处理。
 *
 * 子模块：
 * - SessionStorage          负责持久化
 * - SessionFileHistory      负责文件变更可撤销
 * - SessionProcessManager   负责进程追踪
 * - SessionMessageBuilder   负责消息构建 + OpenAI 装配
 * - LlmStreamManager        负责LLM 流式调用
 * - SessionActivator        负责LLM 主循环 + 上下文压缩
 * - SessionNotifier         负责提示上报 + 任务完成通知
 */

import * as crypto from "crypto";
import { getExtensionRoot } from "../prompt";
import type { ToolDefinition } from "../prompt";
import { ToolExecutor } from "../tools/executor";
import { registry } from "../tools/index";
import type { CreateOpenAIClient } from "../tools/types";
import { McpManager } from "../mcp/mcp-manager";
import type { McpServerConfig } from "../settings";
import { getActivePreset } from "../utils/global-settings";
import { killProcessTree } from "../utils/process-tree";

import { SessionStorage } from "./storage";
import { SessionFileHistory } from "./file-history";
import { SessionProcessManager } from "./process";
import { SessionMessageBuilder } from "./message-builder";
import { LlmStreamManager } from "../llm/stream";
import { SessionActivator } from "./activator";
import { SessionNotifier } from "./notifier";
import { PresetManager } from "../preset/manager";
import { EditorDecorationManager } from "./editor-decorations";
import type {
  SessionMessage,
  SessionEntry,
  LlmStreamProgress,
  UserPromptContent,
  MessageMeta,
  SessionManagerOptions,
  BashTimeoutAdjustment,
  UndoTarget,
  PendingApprovalItem,
} from "./types";

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
} from "./types";

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
  private readonly editorDecorations: EditorDecorationManager;
  readonly presetMgr: PresetManager;

  /* MCP */
  private readonly mcpManager = new McpManager();
  private mcpToolDefinitions: ToolDefinition[] = [];

  /** {{editor_selection}} 宏所需 — 由 extension.ts 在每次 prompt 前更新 */
  private editorSelection: { filePath: string; startLine: number; endLine: number } | undefined;
  /** {{active_file}} 宏所需 */
  private activeFile: string | undefined;
  /** {{attached_files}} 宏所需 */
  private attachedFiles: string[] | undefined;
  /** 代码段虚拟路径→内容映射（不写磁盘） */
  private attachedSnippetContents: Record<string, string> = {};

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
    this.editorDecorations = new EditorDecorationManager();
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

  /** 设置当前编辑器选中位置（由 extension.ts 在每次 prompt 前调用） */
  setEditorSelection(selection: { filePath: string; startLine: number; endLine: number } | undefined): void {
    this.editorSelection = selection;
  }

  /** 设置当前活动文件路径（{{active_file}} 宏所需） */
  setActiveFile(filePath: string | undefined): void {
    this.activeFile = filePath;
  }

  /** 设置附加文件路径列表（{{attached_files}} 宏所需） */
  setAttachedFiles(filePaths: string[] | undefined): void {
    this.attachedFiles = filePaths;
  }

  /** 获取附加文件路径列表 */
  getAttachedFiles(): string[] {
    return this.attachedFiles ?? [];
  }

  /** 获取代码段内容映射 */
  getAttachedSnippetContents(): Record<string, string> {
    return this.attachedSnippetContents;
  }

  /** 存储代码段内容（不写磁盘） */
  setAttachedSnippet(key: string, content: string): void {
    this.attachedSnippetContents[key] = content;
  }

  /** 移除单个附加文件（同时清理内存中的代码段） */
  removeAttachedFile(filePath: string): void {
    if (this.attachedFiles) {
      this.attachedFiles = this.attachedFiles.filter((f) => f !== filePath);
    }
    delete this.attachedSnippetContents[filePath];
  }

  /** 清空所有附加文件及代码段内容 */
  clearAllAttachments(): void {
    this.attachedFiles = [];
    this.attachedSnippetContents = {};
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
   * 创建会话索引（同步，不触发LLM）。
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

    // /continue 直接继续 LLM 主循环，不加新消息
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
    // 将真实消息（带 checkpointHash）发回前端，替换本地创建的假气泡
    this.onAssistantMessage(newUserMsg, false);
    console.log("[DEBUG] sendMessage: user msg appended, calling runActivate");

    this.activeSessionId = sessionId;
    // 新用户消息 → 清空快速路径缓存 + 清除编辑器高亮装饰
    this.activator.clearFastPathCache();
    this.editorDecorations.clearAll();
    await this.runActivate(sessionId, controller);
    console.log("[DEBUG] sendMessage: runActivate returned");
  }

  /**
   * 回复会话（公开接口，委托给 sendMessage）。
   * 若 session 不存在则自动创建。
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
   * 激活会话主循环（公开供测试/mock用）
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
        editorSelection: this.editorSelection,
        activeFile: this.activeFile,
        attachedFiles: this.attachedFiles,
        attachedSnippetContents: this.attachedSnippetContents,
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

  rollbackToMessage(
    sessionId: string,
    messageId: string
  ): { messages: SessionMessage[]; restoreError?: string } {
    const { keptMessages, checkpointHash, restoreError } = this.fileHistory.rollbackToMessage(sessionId, messageId);
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
    return { messages: keptMessages, restoreError };
  }

  // ═══════════════════════════════════════════════════════
  //  工具消息追加
  // ═══════════════════════════════════════════════════════

  private async appendToolMessages(sessionId: string, toolCalls: unknown[]): Promise<{ waitingForUser: boolean }> {
    // ── 审批检查：先看是否有工具需要审批 ──
    const pendingApprovals: PendingApprovalItem[] = [];
    for (const tc of toolCalls) {
      const parsed = this.toolExecutor.parseToolCallForApproval(tc);
      if (parsed) {
        const check = registry.checkApproval(parsed.name, parsed.rawArguments, this.projectRoot);
        if (check.requiresApproval) {
          pendingApprovals.push({
            toolCallId: parsed.id,
            toolName: parsed.name,
            params: check.parsedArgs,
            summary: check.summary,
          });
        }
      }
    }

    if (pendingApprovals.length > 0) {
      // 存到会话索引中（不存消息），等待用户审批
      this.storage.updateSessionEntry(sessionId, (entry) => ({
        ...entry,
        pendingApprovals,
        status: "waiting_for_user",
        updateTime: new Date().toISOString(),
      }));
      this.onSessionEntryUpdated?.(this.getSession(sessionId)!);

      // 仅推送给前端展示，不落盘（避免恢复会话时出现过期审批卡片）
      const approvalMessage = this.messageBuilder.buildToolApprovalMessage(sessionId, pendingApprovals);
      this.onAssistantMessage(approvalMessage, true);

      return { waitingForUser: true };
    }

    // ── 无需审批，直接执行 ──
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
      onEditApplied: (filePath, diffPreview) => {
        console.log("[DEBUG] manager: onEditApplied received", filePath);
        this.editorDecorations.applyEditDecoration(filePath, diffPreview);
      },
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

  /**
   * 处理用户对工具调用的审批决定。
   * @param sessionId 会话 ID
   * @param toolCallId 工具调用 ID
   * @param action "approve" | "reject"
   * @param modifiedArgs 用户修改后的参数（可选）
   */
  async handleToolApproval(
    sessionId: string,
    toolCallId: string,
    action: "approve" | "reject",
    modifiedArgs?: Record<string, unknown>
  ): Promise<void> {
    const session = this.getSession(sessionId);
    if (!session?.pendingApprovals || session.pendingApprovals.length === 0) return;

    // 查找对应的待审批项
    const approvalItem = session.pendingApprovals.find((p) => p.toolCallId === toolCallId);
    if (!approvalItem) return;

    // 从会话中移除已处理的待审批项
    const remaining = session.pendingApprovals.filter((p) => p.toolCallId !== toolCallId);
    this.storage.updateSessionEntry(sessionId, (entry) => ({
      ...entry,
      pendingApprovals: remaining.length > 0 ? remaining : null,
    }));

    if (action === "reject") {
      // 用户拒绝：注入一条 tool 结果消息，告诉 LLM 用户拒绝了此调用
      const toolMessage = this.messageBuilder.buildToolMessage(
        sessionId,
        toolCallId,
        JSON.stringify(
          {
            ok: false,
            name: approvalItem.toolName,
            error: "User rejected this tool call.",
            metadata: { userRejected: true },
          },
          null,
          2
        ),
        { name: approvalItem.toolName, arguments: JSON.stringify(approvalItem.params) }
      );
      this.storage.appendSessionMessage(sessionId, toolMessage);
      this.onAssistantMessage(toolMessage, true);
    } else {
      // 用户批准：用原参数（或修改后的参数）构造 tool call 并执行
      const rawArgs = modifiedArgs
        ? JSON.stringify(modifiedArgs)
        : JSON.stringify(approvalItem.params);
      const toolCall = { id: toolCallId, type: "function" as const, function: { name: approvalItem.toolName, arguments: rawArgs } };
      const result = await this.toolExecutor.executeToolCallRaw(sessionId, toolCall, {
        onBeforeFileMutation: (filePath) => this.fileHistory.prepareMutation(sessionId, filePath),
        onAfterFileMutation: (filePath) => this.fileHistory.recordMutation(sessionId, filePath),
      });
      const toolMessage = this.messageBuilder.buildToolMessage(
        sessionId,
        toolCallId,
        this.toolExecutor.formatToolResult(result),
        { name: approvalItem.toolName, arguments: rawArgs }
      );
      this.storage.appendSessionMessage(sessionId, toolMessage);
      this.onAssistantMessage(toolMessage, true);
    }

    // 如果所有待审批项都已处理，恢复 LLM 循环
    if (remaining.length === 0) {
      this.storage.updateSessionEntry(sessionId, (entry) => ({
        ...entry,
        status: "processing",
        updateTime: new Date().toISOString(),
      }));
      this.onSessionEntryUpdated?.(this.getSession(sessionId)!);

      // 继续 LLM 循环
      await this.runActivate(sessionId);
    }
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
