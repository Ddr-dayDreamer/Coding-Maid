/**
 * Session 系统共享类型定义
 *
 * 从 session.ts 拆分出的纯类型层，无运行时依赖。
 */

import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import type { CreateOpenAIClient, ProcessTimeoutControl, ProcessTimeoutInfo } from "../tools/types";
import type { McpServerConfig } from "../settings";
import type { LlmErrorInfo } from "../llm/errors";

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

// ─── 待审批工具调用 ─────────────────────────────────────

export type PendingApprovalItem = {
  toolCallId: string;
  toolName: string;
  /** 解析后的参数 */
  params: Record<string, unknown>;
  /** 人类可读的摘要 */
  summary: string;
  /** 如果是预检器自动拒绝，记录原因 */
  autoRejected?: boolean;
  rejectReason?: string;
};

// ─── 修改的文件条目 ─────────────────────────────────────

export type ModifiedFileEntry = {
  /** 被修改文件的绝对路径 */
  filePath: string;
  /** 最近一次修改的时间戳 */
  lastModifiedAt: string;
};

// ─── 上下文压缩 ─────────────────────────────────────────

/**
 * 一次手动压缩的记录。
 *
 * 压缩是非破坏性的：完整历史仍保留在 JSONL 中，
 * 只通过 upToMessageId 决定哪些消息不再发送给 LLM。
 */
export type CompactionRecord = {
  /** 压缩边界：此 id 及之前的消息不再发送给 LLM */
  upToMessageId: string;
  /** 摘要消息 id（UI 定位 / 撤销用） */
  summaryMessageId: string;
  /** 摘要正文 */
  summary: string;
  createdAt: string;
  /** 压缩前的消息条数 */
  messagesBefore: number;
  /** 压缩前估算 token */
  tokensBefore: number;
  /** 压缩后估算 token */
  tokensAfter: number;
  /** 生成摘要所用的模型 */
  model: string;
};

/** 压缩进度事件（推送给前端） */
export type CompactionEvent = {
  sessionId: string;
  phase: "start" | "done" | "error";
  tokensBefore?: number;
  tokensAfter?: number;
  messagesBefore?: number;
  error?: string;
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
  /** 最近一次 API 请求失败的结构化信息（成功/中断后清空） */
  lastError?: LlmErrorInfo | null;
  usage: ModelUsage | null;
  /** 最后一次 LLM 响应的原始 usage（含 prompt_cache_hit/miss） */
  lastUsage: ModelUsage | null;
  createTime: string;
  updateTime: string;
  processes: Map<string, SessionProcessEntry> | null;
  /** 待审批的工具调用列表（用户审批后才执行） */
  pendingApprovals?: PendingApprovalItem[] | null;
  /** 本会话中 edit/write 工具修改过的文件列表 */
  modifiedFiles?: ModifiedFileEntry[] | null;
  /** 当前生效的上下文压缩记录（null / 缺省 = 未压缩） */
  compaction?: CompactionRecord | null;
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
  /** 该消息因用户中断而只保留了部分内容 */
  interrupted?: boolean;
  /** 摘要消息的压缩统计（供前端卡片展示） */
  compaction?: {
    tokensBefore: number;
    tokensAfter: number;
    messagesBefore: number;
  };
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

export type UserPromptFilePart =
  | { type: "text"; path: string; content: string }
  | { type: "image"; path: string; dataUrl: string };

export type UserPromptContent = {
  text?: string;
  imageUrls?: string[];
  /** 附加文件 parts（文本 → text part，图片 → image_url part） */
  fileParts?: UserPromptFilePart[];
};

// ─── SessionManager 构造选项 ────────────────────────────

export type SessionManagerOptions = {
  projectRoot: string;
  createOpenAIClient: CreateOpenAIClient;
  getResolvedSettings: () => {
    model: string;
    webSearchTool?: string;
    mcpServers?: Record<string, McpServerConfig>;
    debugEnabled: boolean;
  };
  renderMarkdown: (text: string) => string;
  onAssistantMessage: (message: SessionMessage, shouldConnect: boolean) => void;
  onSessionEntryUpdated?: (entry: SessionEntry) => void;
  onLlmStreamProgress?: (progress: LlmStreamProgress) => void;
  onStreamChunk?: (chunk: { sessionId?: string; content?: string; reasoningContent?: string }) => void;
  onNotify?: (level: "success" | "error" | "warning" | "info", text: string, duration?: number) => void;
  onMcpStatusChanged?: () => void;
  onProcessStdout?: (pid: number, chunk: string) => void;
  /** 单个审批项处理完成后的回调（用于前端同步审批状态） */
  onApprovalProcessed?: (sessionId: string, toolCallId: string, action: "approve" | "reject") => void;
  /** 上下文压缩进度回调 */
  onCompaction?: (event: CompactionEvent) => void;
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

/** 快速回复条目（可选 quickReply.json，跟随预设） */
export type QuickReply = {
  /** 可选，缺省时使用 label 作为 id */
  id?: string;
  /** 下拉列表中的显示名称 */
  label: string;
  /** 填入输入框的回复内容 */
  content: string;
};

/** 宏解析上下文 */
/** {{editor_selection}} 宏所需 — 编辑器选中内容的定位信息 */
export type EditorSelectionInfo = {
  /** 文件绝对路径 */
  filePath: string;
  /** 选中起始行（1-based） */
  startLine: number;
  /** 选中结束行（1-based，含） */
  endLine: number;
};

export type MacroContext = {
  projectRoot: string;
  model: string;
  extensionRoot: string;
  /** {{char}} 默认值（优先级：setvar > 此字段 > "助手"） */
  charName?: string;
  /** {{user}} 默认值（优先级：setvar > 此字段 > "用户"） */
  userName?: string;
  /** {{editor_selection}} — 当前 VS Code 编辑器中选中的位置 */
  editorSelection?: EditorSelectionInfo;
  /** {{active_file}} — 当前活动编辑器的文件路径 */
  activeFile?: string;
  /** {{lastUserMessage}} — 当前会话中最后一条用户消息原文 */
  lastUserMessage?: string;
  /** {{plan}} — 最近一次 UpdatePlan 工具调用提交的计划内容（markdown） */
  plan?: string;
};
