/**
 * 全局状态管理 (Svelte 5 runes)
 *
 * 使用 $state rune 实现响应式状态。
 * 注意：此文件必须使用 .svelte.ts 后缀才能使用 $state。
 */

import type { SessionSummary, TokenTelemetry, LlmStreamProgressData, SessionMessageData, AttachedFile, ModifiedFileEntry } from "../types";

// ─── Tab 页面 ────────────────────────────────────────────

export type TabId = "chat" | "presets" | "profiles" | "approvals";

// ─── 全局状态 (class-based runes) ────────────────────────

class AppState {
  /** 当前 Tab */
  currentTab = $state<TabId>("chat");

  /** 当前会话 ID */
  currentSessionId = $state<string | null>(null);

  /** 当前会话状态 */
  currentSessionStatus = $state<string | null>(null);

  /** 所有会话列表 */
  sessions = $state<SessionSummary[]>([]);

  /** 当前会话的消息列表 */
  messages = $state<SessionMessageData[]>([]);

  /** Token 用量 */
  tokenTelemetry = $state<TokenTelemetry | null>(null);

  /** 流式进度 */
  llmStreamProgress = $state<LlmStreamProgressData | null>(null);

  /** 加载状态 */
  isLoading = $state(false);

  /** 运行中的进程 */
  runningProcesses = $state<Record<string, { startTime: string; command: string }> | null>(null);

  /** 提示词输入历史 */
  inputHistory = $state<string[]>([]);

  /** 最后一个用户提示词 */
  lastPrompt = $state("");

  /** 回退时暂存的消息内容，供 ChatPage 填入输入框 */
  pendingPrompt = $state("");

  /** 标记是否正在等待回退完成（用于 loadSession 时弹出提示） */
  pendingRollback = $state(false);

  /** 当前使用的预设名称 */
  activePreset = $state("default");

  /** 当前使用的连接配置名称 */
  activeProfile = $state("default");

  /** 审批配置（工具名 → 审批模式） */
  approvalConfig = $state<Record<string, string>>({});

  /** 拖入的附加文件列表（前端展示用） */
  attachedFiles = $state<AttachedFile[]>([]);

  /** 是否有文件正被拖入界面（用于显示全页叠加层） */
  isDragOver = $state(false);

  /** 当前会话被 edit/write 修改过的文件列表 */
  modifiedFiles = $state<ModifiedFileEntry[]>([]);

  /** 流式输出暂存内容（打字机效果） */
  streamingContent = $state("");

  /** 流式思维链暂存内容 */
  streamingReasoning = $state("");

  /** 是否正在流式输出 */
  get isStreaming(): boolean {
    return this.streamingContent !== "" || this.streamingReasoning !== "";
  }

  /** 当前 Tab 为聊天页 */
  get isChatTab(): boolean {
    return this.currentTab === "chat";
  }

  /** 是否正在处理 */
  get isProcessing(): boolean {
    return this.currentSessionStatus === "processing" || this.currentSessionStatus === "pending";
  }
}

export const appState = new AppState();
