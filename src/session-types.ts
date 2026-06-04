/**
 * Session 系统共享类型定义
 *
 * 从 session.ts 拆分出的纯类型层，无运行时依赖。
 */

import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import type { CreateOpenAIClient, ProcessTimeoutControl, ProcessTimeoutInfo } from "./tools/executor";
import type { McpServerConfig } from "./settings";

// ─── Session 状态 ────────────────────────────────────────

export type SessionStatus = "failed" | "pending" | "processing" | "waiting_for_user" | "completed" | "interrupted";

// ─── Token 用量 ──────────────────────────────────────────

export type ModelUsage = {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  completion_tokens_details?: Record<string, unknown>;
  prompt_tokens_details?: Record<string, unknown>;
  prompt_cache_hit_tokens?: number;
  prompt_cache_miss_tokens?: number;
  total_reqs?: number;
};

// ─── 进程条目 ────────────────────────────────────────────

export type SessionProcessEntry = {
  startTime: string;
  command: string;
  timeoutMs?: number;
  deadlineAt?: string;
  timedOut?: boolean;
};

// ─── Bash 超时调整 ──────────────────────────────────────

export type BashTimeoutAdjustment = {
  processId: string;
  timeoutMs: number;
  deadlineAt: string;
  timedOut: boolean;
};

// ─── 会话索引条目 ────────────────────────────────────────

export type SessionEntry = {
  id: string;
  summary: string | null;
  assistantReply: string | null;
  assistantThinking: string | null;
  assistantRefusal: string | null;
  toolCalls: unknown[] | null;
  status: SessionStatus;
  failReason: string | null;
  usage: ModelUsage | null;
  /** 最后一次 LLM 响应的原始 usage（含 prompt_cache_hit/miss） */
  lastUsage: ModelUsage | null;
  createTime: string;
  updateTime: string;
  processes: Map<string, SessionProcessEntry> | null;
};

// ─── 会话索引 ────────────────────────────────────────────

export type SessionsIndex = {
  version: 1;
  entries: SessionEntry[];
  originalPath: string;
};

// ─── 会话消息 ────────────────────────────────────────────

export type SessionMessageRole = "system" | "user" | "assistant" | "tool";

export type MessageMeta = {
  function?: unknown;
  paramsMd?: string;
  resultMd?: string;
  asThinking?: boolean;
  isSummary?: boolean;
  isPreset?: boolean;
  isModelChange?: boolean;
};

export type SessionMessage = {
  id: string;
  sessionId: string;
  role: SessionMessageRole;
  content: string | null;
  contentParams: unknown | null;
  messageParams: unknown | null;
  visible: boolean;
  createTime: string;
  updateTime: string;
  meta?: MessageMeta;
  html?: string;
  checkpointHash?: string;
};

// ─── Undo 目标 ───────────────────────────────────────────

export type UndoTarget = {
  message: SessionMessage;
  index: number;
  canRestoreCode: boolean;
};

// ─── 用户提示词 ──────────────────────────────────────────

export type UserPromptContent = {
  text?: string;
  imageUrls?: string[];
};

// ─── SessionManager 构造选项 ────────────────────────────

export type SessionManagerOptions = {
  projectRoot: string;
  createOpenAIClient: CreateOpenAIClient;
  getResolvedSettings: () => {
    model: string;
    webSearchTool?: string;
    mcpServers?: Record<string, McpServerConfig>;
  };
  renderMarkdown: (text: string) => string;
  onAssistantMessage: (message: SessionMessage, shouldConnect: boolean) => void;
  onSessionEntryUpdated?: (entry: SessionEntry) => void;
  onLlmStreamProgress?: (progress: LlmStreamProgress) => void;
  onStreamChunk?: (chunk: { sessionId?: string; content?: string; reasoningContent?: string }) => void;
  onMcpStatusChanged?: () => void;
  onProcessStdout?: (pid: number, chunk: string) => void;
  /** 启用调试日志（写入 ~/.codingmaid/logs/） */
  debugEnabled: boolean;
};

// ─── LLM 流进度 ──────────────────────────────────────────

export type LlmStreamProgress = {
  requestId: string;
  sessionId?: string;
  startedAt: string;
  estimatedTokens: number;
  formattedTokens: string;
  phase: "start" | "update" | "end";
};

// ─── 提示词预设 ──────────────────────────────────────────

/** 预设中的单个条目 */
export type PresetEntry = {
  name: string;
  role: "system" | "user" | "assistant" | "chat_history";
  content: string;
  enabled: boolean;
};

/** 预设定义（序列化为 preset.json） */
export type PresetDefinition = {
  name: string;
  description: string;
  /** {{char}} 的默认值（未指定时使用 name） */
  char?: string;
  /** {{user}} 的默认值（未指定时使用 "user"） */
  user?: string;
  /** 仅在此列表中的工具会被注册到 OpenAI API 的 tools 参数 */
  availableTools: string[];
  entries: PresetEntry[];
};

/** 预设元信息（列表展示用） */
export type PresetMeta = {
  /** 目录名，也是预设的唯一标识 */
  name: string;
  /** 来自 preset.json 的 display name */
  displayName: string;
  description: string;
  path: string;
};

/** 宏解析上下文 */
export type MacroContext = {
  projectRoot: string;
  model: string;
  extensionRoot: string;
  /** {{char}} 默认值（优先级：setvar > 此字段 > "助手"） */
  charName?: string;
  /** {{user}} 默认值（优先级：setvar > 此字段 > "用户"） */
  userName?: string;
};
