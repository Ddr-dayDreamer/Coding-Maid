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
  usagePerModel: Record<string, ModelUsage> | null;
  activeTokens: number;
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
  isModelChange?: boolean;
  skill?: SkillInfo;
};

export type SessionMessage = {
  id: string;
  sessionId: string;
  role: SessionMessageRole;
  content: string | null;
  contentParams: unknown | null;
  messageParams: unknown | null;
  compacted: boolean;
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
  skills?: SkillInfo[];
};

// ─── Skill 信息 ─────────────────────────────────────────

export type SkillInfo = {
  name: string;
  path: string;
  description: string;
  isLoaded?: boolean;
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
  onMcpStatusChanged?: () => void;
  onProcessStdout?: (pid: number, chunk: string) => void;
  onDebugPrompt?: (messages: ChatCompletionMessageParam[], iteration: number) => void;
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
