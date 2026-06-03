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

/**
 * 通用调试日志条目
 */
export type DebugLogEntry = {
  timestamp: string;
  location: string;
  sessionId?: string;
  message: string;
  data?: unknown;
};

/**
 * 通用调试日志（受 codingmaid.debugLogEnabled 控制）
 *
 * 用法：
 * ```ts
 * import { logDebug } from "./common/debug-logger";
 * logDebug("handleRestoreSession", "消息已找到", { sessionId, messageId });
 * ```
 *
 * 输出的 JSONL 在 ~/.codingmaid/logs/debug.log，每行一条。
 */
export function logDebug(location: string, message: string, data?: Record<string, unknown>): void {
  const entry: DebugLogEntry = {
    timestamp: new Date().toISOString(),
    location,
    sessionId: data?.sessionId as string | undefined,
    message,
    data,
  };
  logOpenAIChatCompletionDebug({
    timestamp: entry.timestamp,
    location: entry.location,
    sessionId: entry.sessionId,
    request: { message: entry.message, ...(entry.data ?? {}) },
  });
}

export function getDebugLogPath(): string {
  return path.join(os.homedir(), ".codingmaid", "logs", DEBUG_LOG_FILE);
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
