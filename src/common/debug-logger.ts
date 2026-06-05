import * as fs from "fs";
import * as os from "os";
import * as path from "path";

const DEBUG_LOG_FILE = "debug.log";

export type OpenAIChatCompletionDebugEntry = {
  timestamp: string;
  location: string;
  requestId?: string;
  sessionId?: string;
  model?: string;
  baseURL?: string;
  durationMs?: number;
  params?: Record<string, unknown>;
  request: Record<string, unknown>;
  response?: unknown;
  responseChunks?: unknown[];
  error?: {
    name: string;
    message: string;
    stack?: string;
  };
};

export function logOpenAIChatCompletionDebug(entry: OpenAIChatCompletionDebugEntry): void {
  try {
    const logPath = getDebugLogPath();
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    fs.appendFileSync(logPath, `${JSON.stringify(toSerializable(entry))}\n`, "utf8");
  } catch {
    // Debug logging must never affect CLI behavior.
  }
}

export function getDebugLogPath(): string {
  return path.join(os.homedir(), ".codingmaid", "logs", DEBUG_LOG_FILE);
}

// ─── Prompt 调试日志 ──────────────────────────────────────

/**
 * 写入 LLM 请求结构到独立的 prompt 文件
 *
 * 每次调用新建一个文件 prompt-{sessionId}-i{iteration}.json，
 * 避免单个文件过大难以浏览。
 * 通过 `codingmaid.debugEnabled: true` 启用。
 */
export function logPromptDebug(
  fullRequest: Record<string, unknown>,
  iteration: number,
  sessionId: string
): void {
  try {
    const logDir = path.join(os.homedir(), ".codingmaid", "logs", "prompts");
    fs.mkdirSync(logDir, { recursive: true });
    const safeId = sessionId.replace(/[<>:"/\\|?*]/g, "_");
    const logPath = path.join(logDir, `prompt-${safeId}-i${iteration}.json`);
    const body = JSON.stringify(toSerializable(fullRequest), null, 2);
    fs.writeFileSync(logPath, body, "utf8");
  } catch {
    // Debug logging must never affect runtime behavior.
  }
}

export function normalizeDebugError(error: unknown): { name: string; message: string; stack?: string } {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
    };
  }
  return {
    name: "UnknownError",
    message: String(error),
  };
}

// ─── LLM 流式完成调试日志 ──────────────────────────────

/**
 * LLM 流式完成调试日志选项（只记录最终结果，不含流式中间 chunk）
 */
export type LlmCompletionDebugOptions = {
  enabled?: boolean;
  location: string;
  requestId?: string;
  sessionId?: string;
  model?: string;
  baseURL?: string;
  durationMs?: number;
  params?: Record<string, unknown>;
  request: Record<string, unknown>;
};

/**
 * 记录 LLM 完成调试日志（受 enabled 控制）
 *
 * 只记录最终回复内容，不含流式中间 chunk，避免日志过于冗长。
 */
export function logLlmCompletion(
  ctx: LlmCompletionDebugOptions & {
    response?: unknown;
    error?: { name: string; message: string; stack?: string };
  }
): void {
  if (!ctx.enabled) return;
  logOpenAIChatCompletionDebug({
    timestamp: new Date().toISOString(),
    location: ctx.location,
    requestId: ctx.requestId,
    sessionId: ctx.sessionId,
    model: ctx.model,
    baseURL: ctx.baseURL,
    durationMs: ctx.durationMs,
    params: ctx.params,
    request: ctx.request,
    response: ctx.response,
    error: ctx.error,
  });
}

function toSerializable(value: unknown): unknown {
  const seen = new WeakSet<object>();

  function walk(current: unknown): unknown {
    if (typeof current === "bigint") {
      return current.toString();
    }
    if (current instanceof Error) {
      return normalizeDebugError(current);
    }
    if (!current || typeof current !== "object") {
      return current;
    }
    if (seen.has(current)) {
      return "[Circular]";
    }
    seen.add(current);
    if (Array.isArray(current)) {
      return current.map(walk);
    }
    const result: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(current)) {
      result[key] = walk(val);
    }
    return result;
  }

  return walk(value);
}
