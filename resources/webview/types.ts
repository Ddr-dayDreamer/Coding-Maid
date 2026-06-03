// ─── 前后端消息协议类型 ─────────────────────────────────

// 后端 → 前端
export type BackendMessage =
  | { type: "initializeEmpty"; sessions: SessionSummary[]; status: string | null; tokenTelemetry?: TokenTelemetry }
  | {
      type: "loadSession";
      sessionId: string;
      summary: string;
      status: string;
      messages: SessionMessageData[];
      tokenTelemetry?: TokenTelemetry;
      processes?: ProcessInfo[];
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
  | { type: "skillsList"; skills: SkillInfo[] };

// 前端 → 后端
export type FrontendMessage =
  | { type: "ready" }
  | { type: "requestSkills" }
  | { type: "userPrompt"; prompt: string; skills?: SkillInfo[]; images?: string[] }
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
  compacted?: boolean;
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
  activeTokens: number;
  model: string;
  thinkingEnabled: boolean;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
    prompt_cache_hit_tokens?: number;
    prompt_cache_miss_tokens?: number;
  };
  usagePerModel?: Record<string, { prompt_tokens: number; completion_tokens: number; total_tokens: number }>;
}

export interface ProcessInfo {
  pid: number;
  command: string;
  startTime: string;
  timeoutMs?: number;
  deadlineAt?: string;
  timedOut?: boolean;
}

export interface SkillInfo {
  id: string;
  name: string;
  description: string;
}

export interface LlmStreamProgressData {
  phase: string;
  startedAt: string;
  formattedTokens?: string;
  requestId?: string;
  sessionId: string;
}
