/**
 * 工具系统共享类型
 *
 * 从 executor.ts 拆出，避免 registry.ts ↔ executor.ts 循环依赖。
 */

import type OpenAI from "openai";
import type { ReasoningEffort } from "../settings";

// ─── 工具上下文 ─────────────────────────────────────────

export type ToolExecutionContext = {
  sessionId: string;
  projectRoot: string;
  toolCall: ToolCall;
  createOpenAIClient?: CreateOpenAIClient;
  onProcessStart?: (processId: string | number, command: string) => void;
  onProcessExit?: (processId: string | number) => void;
  onProcessStdout?: (processId: string | number, chunk: string) => void;
  onProcessTimeoutControl?: (processId: string | number, control: ProcessTimeoutControl | null) => void;
  onBeforeFileMutation?: (filePath: string) => void;
  onAfterFileMutation?: (filePath: string) => void;
  /** 编辑工具成功替换后回调，传递文件路径和 unified diff 预览文本 */
  onEditApplied?: (filePath: string, diffPreview: string) => void;
  bashTimeoutMs?: number;
  bashMinTimeoutMs?: number;
};

// ─── 工具级审批预检结果 ─────────────────────────────

/**
 * 工具级审批预检器返回的结果。
 * - allow: 直接放行，覆盖 settings 模式
 * - reject: 自动拦截，不执行，给 LLM 返回错误
 * - require: 走正常审批流程
 */
export type ToolApprovalCheckResult =
  | { action: "allow" }
  | { action: "reject"; reason: string }
  | { action: "require" }
  | { action: "force_require" };

/**
 * 工具级审批预检器签名。
 * 返回 ToolApprovalCheckResult 来决定此调用如何处理。
 */
export type ToolApprovalContext = {
  projectRoot?: string;
};

export type ToolApprovalChecker = (
  args: Record<string, unknown>,
  context?: ToolApprovalContext
) => ToolApprovalCheckResult;

// ─── 待审批信息 ────────────────────────────────────────

/**
 * 待审批的工具调用详情
 * 当工具需要用户审批时，用此结构描述待审批的内容。
 */
export type PendingApprovalInfo = {
  toolCallId: string;
  toolName: string;
  /** 解析后的参数 */
  params: Record<string, unknown>;
  /** 人类可读的摘要（如 bash 命令全文） */
  summary: string;
};

// ─── 工具结果 ───────────────────────────────────────────

export type ToolExecutionResult = {
  ok: boolean;
  name: string;
  output?: string;
  error?: string;
  metadata?: Record<string, unknown>;
  awaitUserResponse?: boolean;
  followUpMessages?: ToolExecutionFollowUpMessage[];
  /** 标记此结果为"待审批"，此时工具尚未执行 */
  pendingApproval?: PendingApprovalInfo;
  /** 标记此结果为"自动拒绝"（工具级预检器拦截），工具未执行 */
  autoReject?: boolean;
  autoRejectReason?: string;
};

export type ToolExecutionFollowUpMessage = {
  role: "system";
  content: string;
  contentParams?: unknown | null;
};

// ─── 超时控制 ───────────────────────────────────────────

export type ProcessTimeoutInfo = {
  timeoutMs: number;
  startedAtMs: number;
  deadlineAtMs: number;
  timedOut: boolean;
};

export type ProcessTimeoutControl = {
  getInfo: () => ProcessTimeoutInfo;
  setTimeoutMs: (timeoutMs: number) => ProcessTimeoutInfo;
};

// ─── ToolCall ────────────────────────────────────────────

export type ToolCall = {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
};

// ─── 创建 OpenAI 客户端 ────────────────────────────────

export type CreateOpenAIClient = () => {
  client: OpenAI | null;
  model: string;
  baseURL?: string;
  thinkingEnabled?: boolean;
  reasoningEffort?: ReasoningEffort;
  params?: Record<string, unknown>;
  notify?: string;
  webSearchTool?: string;
  env?: Record<string, string>;
  machineId?: string;
};

// ─── Handler 签名 ──────────────────────────────────────

export type ToolHandler = (
  args: Record<string, unknown>,
  context: ToolExecutionContext
) => Promise<ToolExecutionResult>;
