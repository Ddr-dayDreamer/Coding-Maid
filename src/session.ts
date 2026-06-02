/**
 * 会话管理器 — 编排层
 *
 * 负责会话生命周期的协调，将具体操作委托给子模块。
 *
 * 子模块：
 * - SessionStorage          → 持久化
 * - SessionFileHistory      → 文件变更可撤回
 * - SessionProcessManager   → 进程追踪
 * - SessionSkills           → 技能发现
 * - SessionMessageBuilder   → 消息构建 + OpenAI 装配
 * - LlmStreamManager        → LLM 流式调用
 * - SessionActivator        → LLM 主循环 + 上下文压缩
 * - SessionNotifier         → 提示上报 + 任务完成通知
 */

import * as fs from "fs";
import * as crypto from "crypto";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import { getDefaultSkillPrompt, getRuntimeContext, getSystemPrompt, getTools, type ToolDefinition } from "./prompt";
import { ToolExecutor, type CreateOpenAIClient } from "./tools/executor";
import { McpManager } from "./mcp/mcp-manager";
import type { McpServerConfig } from "./settings";
import { killProcessTree } from "./common/process-tree";

import { SessionStorage } from "./session-storage";
import { SessionFileHistory } from "./session-file-history";
import { SessionProcessManager } from "./session-process";
import { SessionSkills } from "./session-skills";
import { SessionMessageBuilder } from "./session-message-builder";
import { LlmStreamManager, getCompactPromptTokenThreshold } from "./llm-stream";
import { SessionActivator } from "./session-activator";
import { SessionNotifier } from "./session-notify";

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
  SkillInfo,
  SessionManagerOptions,
  LlmStreamProgress,
} from "./session-types";

export { getCompactPromptTokenThreshold } from "./llm-stream";

// ─── SessionManager ──────────────────────────────────────

export class SessionManager {
  /* 依赖注入 */
  private readonly projectRoot: string;
  private readonly createOpenAIClient: CreateOpenAIClient;
  private readonly getResolvedSettings: () => {
    model: string;
    webSearchTool?: string;
    mcpServers?: Record<string, McpServerConfig>;
  };
  private readonly onAssistantMessage: (
    message: import("./session-types").SessionMessage,
    shouldConnect: boolean
  ) => void;
  private readonly onSessionEntryUpdated?: (entry: import("./session-types").SessionEntry) => void;
  private readonly onLlmStreamProgress?: (progress: import("./session-types").LlmStreamProgress) => void;
  private readonly onMcpStatusChanged?: () => void;
  private readonly onProcessStdout?: (pid: number, chunk: string) => void;
  private readonly onDebugPrompt?: (messages: ChatCompletionMessageParam[], iteration: number) => void;

  /* 子模块 */
  private readonly storage: SessionStorage;
  private readonly fileHistory: SessionFileHistory;
  private readonly processMgr: SessionProcessManager;
  private readonly skills: SessionSkills;
  private readonly messageBuilder: SessionMessageBuilder;
  private readonly llm: LlmStreamManager;
  private readonly activator: SessionActivator;
  private readonly notifier: SessionNotifier;
  private readonly toolExecutor: ToolExecutor;

  /* MCP */
  private readonly mcpManager = new McpManager();
  private mcpToolDefinitions: ToolDefinition[] = [];

  /* 运行时状态 */
  private activeSessionId: string | null = null;
  private activePromptController: AbortController | null = null;
  /** 由 runActivate 创建，供 interruptSession 中止 LLM 请求 */
  private readonly activationControllers = new Map<string, AbortController>();

  constructor(options: import("./session-types").SessionManagerOptions) {
    this.projectRoot = options.projectRoot;
    this.createOpenAIClient = options.createOpenAIClient;
    this.getResolvedSettings = options.getResolvedSettings;
    this.onAssistantMessage = options.onAssistantMessage;
    this.onSessionEntryUpdated = options.onSessionEntryUpdated;
    this.onLlmStreamProgress = options.onLlmStreamProgress;
    this.onMcpStatusChanged = options.onMcpStatusChanged;
    this.onProcessStdout = options.onProcessStdout;
    this.onDebugPrompt = options.onDebugPrompt;

    this.storage = new SessionStorage(this.projectRoot);
    this.fileHistory = new SessionFileHistory(this.projectRoot, this.storage);
    this.processMgr = new SessionProcessManager();
    this.skills = new SessionSkills(this.projectRoot, this.storage, this.createOpenAIClient);
    this.messageBuilder = new SessionMessageBuilder(this.projectRoot, this.storage, this.fileHistory);
    this.llm = new LlmStreamManager(this.createOpenAIClient);
    this.toolExecutor = new ToolExecutor(this.projectRoot, this.createOpenAIClient, this.mcpManager);
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
    this.llm.onDebugPrompt = (messages, iteration) => this.onDebugPrompt?.(messages, iteration);
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
    meta?: import("./session-types").MessageMeta
  ): void {
    const message = this.messageBuilder.buildSystemMessage(sessionId, content, null, visible, meta);
    if (sessionId) this.storage.appendSessionMessage(sessionId, message);
    this.onAssistantMessage(message, false);
  }

  // ═══════════════════════════════════════════════════════
  //  用户提示词处理
  // ═══════════════════════════════════════════════════════

  async handleUserPrompt(userPrompt: import("./session-types").UserPromptContent): Promise<void> {
    const controller = new AbortController();
    this.activePromptController = controller;

    try {
      if (!this.activeSessionId || !this.getSession(this.activeSessionId)) {
        await this.createSession(userPrompt, controller);
      } else {
        await this.replySession(this.activeSessionId, userPrompt, controller);
      }
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

  async createSession(
    userPrompt: import("./session-types").UserPromptContent,
    controller?: AbortController
  ): Promise<string> {
    this.notifier.reportNewPrompt();
    const signal = controller?.signal;
    this.throwIfAborted(signal);

    // 技能匹配
    if (userPrompt.text) {
      const skillList = await this.skills.listSkills();
      const skillNames = await this.skills.identifyMatchingSkillNames(skillList, userPrompt.text, { signal });
      this.throwIfAborted(signal);
      const skillSet = new Set(skillNames);
      const matchedSkill = skillList.filter((skill) => skillSet.has(skill.name));
      if (Array.isArray(userPrompt.skills)) {
        userPrompt.skills.push(...matchedSkill);
      } else if (matchedSkill.length > 0) {
        userPrompt.skills = matchedSkill;
      }
    }
    const normalizedSkills = await this.skills.normalizeSkills(userPrompt.skills);
    userPrompt = { ...userPrompt, skills: normalizedSkills };
    this.throwIfAborted(signal);

    // 创建会话索引
    const sessionId = crypto.randomUUID();
    this.fileHistory.ensureSession(sessionId);
    const now = new Date().toISOString();
    const index = this.storage.loadSessionsIndex();
    const entry: import("./session-types").SessionEntry = {
      id: sessionId,
      summary: userPrompt.text ? userPrompt.text.slice(0, 100) : "[Image Prompt]",
      assistantReply: null,
      assistantThinking: null,
      assistantRefusal: null,
      toolCalls: null,
      status: "pending",
      failReason: null,
      usage: null,
      usagePerModel: null,
      activeTokens: 0,
      createTime: now,
      updateTime: now,
      processes: null,
    };
    index.entries.push(entry);

    const { kept, dropped } = this.storage.trimSessionsIndex(index);
    this.storage.saveSessionsIndex(kept);
    this.storage.removeSessionMessages(dropped);

    // ── 提示词管道 ────────────────────────────────────
    const promptToolOptions = this.getPromptToolOptions();

    // 1. 系统 prompt
    const systemPrompt = getSystemPrompt(this.projectRoot, promptToolOptions);
    this.storage.appendSessionMessage(sessionId, this.messageBuilder.buildSystemMessage(sessionId, systemPrompt));

    // 2. 默认 skill
    const defaultSkillPrompt = getDefaultSkillPrompt();
    if (defaultSkillPrompt) {
      this.storage.appendSessionMessage(
        sessionId,
        this.messageBuilder.buildSystemMessage(sessionId, defaultSkillPrompt)
      );
    }

    // 3. 运行时上下文
    this.storage.appendSessionMessage(
      sessionId,
      this.messageBuilder.buildSystemMessage(sessionId, getRuntimeContext(this.projectRoot, promptToolOptions.model))
    );

    // 4. AGENTS.md 指令
    const agentInstructions = this.messageBuilder.loadAgentInstructions();
    if (agentInstructions) {
      this.storage.appendSessionMessage(
        sessionId,
        this.messageBuilder.buildSystemMessage(sessionId, agentInstructions)
      );
    }

    // 5. 用户消息
    this.storage.appendSessionMessage(sessionId, this.messageBuilder.buildUserMessage(sessionId, userPrompt));

    // 6. 技能文档
    if (userPrompt.skills?.length) {
      for (const skill of userPrompt.skills) {
        if (skill.isLoaded) continue;
        const skillMd = fs.readFileSync(this.skills.resolveSkillPath(skill.path), "utf8");
        const text = `<${skill.name}-skill path="${this.skills.resolveSkillPath(skill.path)}">\n${skillMd}\n</${skill.name}-skill>`;
        const msg = this.messageBuilder.buildSkillMessage(
          sessionId,
          `Use the skill document below to assist the user:\n\n${text}`,
          skill
        );
        this.storage.appendSessionMessage(sessionId, msg);
        this.onAssistantMessage(msg, true);
      }
    }

    this.activeSessionId = sessionId;
    await this.runActivate(sessionId, controller);
    return sessionId;
  }

  // ═══════════════════════════════════════════════════════
  //  回复会话
  // ═══════════════════════════════════════════════════════

  async replySession(
    sessionId: string,
    userPrompt: import("./session-types").UserPromptContent,
    controller?: AbortController
  ): Promise<void> {
    const signal = controller?.signal;
    this.throwIfAborted(signal);
    const now = new Date().toISOString();

    const updated = this.storage.updateSessionEntry(sessionId, (entry) => ({
      ...entry,
      status: "pending",
      failReason: null,
      updateTime: now,
    }));

    if (!updated) {
      await this.createSession(userPrompt, controller);
      return;
    }

    if (this.isContinuePrompt(userPrompt)) {
      this.activeSessionId = sessionId;
      await this.runActivate(sessionId, controller);
      return;
    }

    this.notifier.reportNewPrompt();

    // 技能匹配
    if (userPrompt.text) {
      const skillList = await this.skills.listSkills(sessionId);
      const skillNames = await this.skills.identifyMatchingSkillNames(skillList, userPrompt.text, {
        signal,
        sessionId,
      });
      this.throwIfAborted(signal);
      const skillSet = new Set(skillNames);
      const matchedSkill = skillList.filter((skill) => skillSet.has(skill.name));
      if (Array.isArray(userPrompt.skills)) {
        userPrompt.skills.push(...matchedSkill);
      } else if (matchedSkill.length > 0) {
        userPrompt.skills = matchedSkill;
      }
    }
    const normalizedSkills = await this.skills.normalizeSkills(userPrompt.skills, sessionId);
    userPrompt = { ...userPrompt, skills: normalizedSkills };
    this.throwIfAborted(signal);

    this.fileHistory.ensureSession(sessionId);
    this.storage.appendSessionMessage(sessionId, this.messageBuilder.buildUserMessage(sessionId, userPrompt));

    if (userPrompt.skills?.length) {
      for (const skill of userPrompt.skills) {
        if (skill.isLoaded) continue;
        const skillMd = fs.readFileSync(this.skills.resolveSkillPath(skill.path), "utf8");
        const text = `<${skill.name}-skill path="${this.skills.resolveSkillPath(skill.path)}">\n${skillMd}\n</${skill.name}-skill>`;
        const msg = this.messageBuilder.buildSkillMessage(
          sessionId,
          `Use the skill document below to assist the user:\n\n${text}`,
          skill
        );
        this.storage.appendSessionMessage(sessionId, msg);
        this.onAssistantMessage(msg, true);
      }
    }

    this.activeSessionId = sessionId;
    await this.runActivate(sessionId, controller);
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
        onDebugPrompt: (msgs, iter) => this.onDebugPrompt?.(msgs, iter),
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

  adjustActiveBashTimeout(deltaMs: number): import("./session-types").BashTimeoutAdjustment | null {
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

  listSessions(): import("./session-types").SessionEntry[] {
    return this.storage.loadSessionsIndex().entries;
  }

  getSession(sessionId: string): import("./session-types").SessionEntry | null {
    return this.storage.loadSessionsIndex().entries.find((e) => e.id === sessionId) ?? null;
  }

  listSessionMessages(sessionId: string): import("./session-types").SessionMessage[] {
    return this.storage.listSessionMessages(sessionId).map((m) => this.messageBuilder.normalizeSessionMessage(m));
  }

  listUndoTargets(sessionId: string): import("./session-types").UndoTarget[] {
    return this.fileHistory.listUndoTargets(sessionId);
  }

  restoreSessionConversation(sessionId: string, messageId: string): import("./session-types").SessionMessage[] {
    const keptMessages = this.fileHistory.restoreConversation(sessionId, messageId);
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

  restoreSessionCode(sessionId: string, messageId: string): void {
    this.fileHistory.restoreCode(sessionId, messageId);
  }

  // ═══════════════════════════════════════════════════════
  //  技能
  // ═══════════════════════════════════════════════════════

  async listSkills(sessionId?: string): Promise<import("./session-types").SkillInfo[]> {
    return this.skills.listSkills(sessionId);
  }

  async identifyMatchingSkillNames(
    skills: import("./session-types").SkillInfo[],
    userPrompt: string,
    options?: { signal?: AbortSignal; sessionId?: string }
  ): Promise<string[]> {
    return this.skills.identifyMatchingSkillNames(skills, userPrompt, options);
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
    const followUpMessages: import("./session-types").SessionMessage[] = [];
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
  //  内部工具
  // ═══════════════════════════════════════════════════════

  private getPromptToolOptions(): { model: string; webSearchEnabled: boolean } {
    return { model: this.getResolvedSettings().model, webSearchEnabled: true };
  }

  private isContinuePrompt(userPrompt: import("./session-types").UserPromptContent): boolean {
    return (
      typeof userPrompt.text === "string" &&
      userPrompt.text.trim() === "/continue" &&
      (!userPrompt.imageUrls || userPrompt.imageUrls.length === 0) &&
      (!userPrompt.skills || userPrompt.skills.length === 0)
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
