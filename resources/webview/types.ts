// ─── 前后端消息协议类型 ─────────────────────────────────

// 后端 → 前端
export type BackendMessage =
  | {
      type: "initializeEmpty";
      sessions: SessionSummary[];
      status: string | null;
      tokenTelemetry?: TokenTelemetry;
      activePreset?: string;
      activeProfile?: string;
    }
  | {
      type: "loadSession";
      sessionId: string;
      summary: string;
      status: string;
      messages: SessionMessageData[];
      tokenTelemetry?: TokenTelemetry;
      processes?: ProcessInfo[];
      activePreset?: string;
      activeProfile?: string;
    }
  | { type: "showSessionsList"; sessions: SessionSummary[] }
  | {
      type: "sessionStatus";
      sessionId: string;
      status: string;
      processes?: ProcessInfo[];
      tokenTelemetry?: TokenTelemetry;
    }
  | { type: "userMessage"; content: string }
  | { type: "assistant"; html: string }
  | { type: "appendMessage"; message: SessionMessageData; shouldConnect: boolean }
  | { type: "loading"; value: boolean }
  | { type: "llmStreamProgress"; progress: LlmStreamProgressData }
  | { type: "streamChunk"; sessionId?: string; content?: string; reasoningContent?: string }
  | { type: "notify"; level: "success" | "error" | "warning" | "info"; text: string; duration?: number };

// 前端 → 后端
export type FrontendMessage =
  | { type: "ready" }
  | { type: "userPrompt"; prompt: string }
  | { type: "interrupt" }
  | { type: "createNewSession" }
  | { type: "selectSession"; sessionId: string }
  | { type: "backToList" }
  | { type: "openFile"; filePath: string; line: number }
  | { type: "deleteSession"; sessionId: string }
  | { type: "restoreSession"; sessionId: string; messageId: string };

// ─── 数据类型 ────────────────────────────────────────────

export interface SessionSummary {
  id: string;
  summary: string;
  createTime: string;
  updateTime: string;
  status: string;
}

export interface SessionMessageData {
  id: string;
  sessionId: string;
  role: "user" | "assistant" | "system" | "tool";
  content: string | null;
  /** 后端预渲染的 HTML（markdown-it 转换后的结果） */
  html?: string;
  contentParams?: unknown | null;
  messageParams?: Record<string, unknown> | null;
  visible?: boolean;
  createTime?: string;
  updateTime?: string;
  /** 文件历史 checkpoint hash，有此值表示可回退 */
  checkpointHash?: string;
  meta?: {
    asThinking?: boolean;
    skill?: string;
    function?: unknown;
    paramsMd?: string;
    resultMd?: string;
    isPreset?: boolean;
    isSummary?: boolean;
  };
}

export interface TokenTelemetry {
  model: string;
  thinkingEnabled: boolean;
  /** 模型的上下文窗口上限（tokens），默认 1,000,000 */
  contextLimit: number;
  /** 整个对话的累计用量 */
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
    prompt_cache_hit_tokens?: number;
    prompt_cache_miss_tokens?: number;
  };
  /** 最后一次 LLM 响应的原始用量（含缓存数据） */
  lastUsage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
    prompt_cache_hit_tokens?: number;
    prompt_cache_miss_tokens?: number;
  };
}

export interface ProcessInfo {
  pid: number;
  command: string;
  startTime: string;
  timeoutMs?: number;
  deadlineAt?: string;
  timedOut?: boolean;
}

export interface LlmStreamProgressData {
  phase: string;
  startedAt: string;
  formattedTokens?: string;
  requestId?: string;
  sessionId: string;
}

// ─── 预设类型 ────────────────────────────────────────────

export type PresetEntryRole = "system" | "user" | "assistant" | "chat_history";

export interface PresetEntry {
  name: string;
  role: PresetEntryRole;
  content: string;
  enabled: boolean;
}

export interface PresetDefinition {
  name: string;
  description: string;
  char?: string;
  user?: string;
  availableTools: string[];
  entries: PresetEntry[];
}

export interface PresetMeta {
  name: string;
  displayName: string;
  description: string;
}

// ─── 连接配置类型 ───────────────────────────

export interface ProfileMeta {
  name: string;
  filePath: string;
}
