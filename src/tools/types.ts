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
  bashTimeoutMs?: number;
  bashMinTimeoutMs?: number;
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
