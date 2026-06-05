/**
 * 会话通知
 *
 * 提示上报和任务完成通知。
 * 从 session.ts 拆分。
 */

import { spawn } from "child_process";
import type { SpawnOptions } from "child_process";
import type { SessionEntry } from "./session-types";
import type { SessionStorage } from "./session-storage";
import type { CreateOpenAIClient } from "./tools/types";

// ─── 桌面通知 ────────────────────────────────────────────

type NotifyChildProcess = {
  once(event: "error", listener: (error: NodeJS.ErrnoException) => void): NotifyChildProcess;
  unref(): void;
};

type NotifySpawn = (
  command: string,
  args: string[],
  options: Pick<SpawnOptions, "cwd" | "detached" | "env" | "stdio">
) => NotifyChildProcess;

function formatDurationSeconds(durationMs: number): string {
  const safeMs = Number.isFinite(durationMs) ? Math.max(0, durationMs) : 0;
  return String(Math.floor(safeMs / 1000));
}

type NotifyContext = {
  status?: string;
  failReason?: string;
  body?: string;
  title?: string;
};

function buildNotifyEnv(
  durationMs: number,
  baseEnv: NodeJS.ProcessEnv = process.env,
  context: NotifyContext = {}
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...baseEnv,
    DURATION: formatDurationSeconds(durationMs),
  };
  delete env.STATUS;
  delete env.FAIL_REASON;
  delete env.BODY;
  delete env.TITLE;

  if (context.status) {
    env.STATUS = context.status;
  }
  if (context.failReason) {
    env.FAIL_REASON = context.failReason;
  }
  if (context.body) {
    env.BODY = context.body;
  }
  if (context.title) {
    env.TITLE = context.title;
  }
  return env;
}

function launchNotifyScript(
  notifyPath: string | undefined,
  durationMs: number,
  workingDirectory?: string,
  spawnProcess: NotifySpawn = spawn as unknown as NotifySpawn,
  configuredEnv: Record<string, string> = {},
  context: NotifyContext = {}
): void {
  const commandPath = notifyPath?.trim();
  if (!commandPath) {
    return;
  }

  const options = {
    cwd: workingDirectory,
    detached: process.platform !== "win32",
    env: buildNotifyEnv(durationMs, { ...process.env, ...configuredEnv }, context),
    stdio: "ignore" as const,
  };

  try {
    const child = spawnProcess(commandPath, [], options);
    child.once("error", (error) => {
      if (process.platform === "win32") {
        return;
      }
      console.error(`Notify script failed: ${error.message}`);
    });
    child.unref();
  } catch {
    // Silently ignore notification failures
  }
}

const DEFAULT_NEW_PROMPT_API_URL = "https://codingmaid.vegamo.cn/api/plugin/new";
const NEW_PROMPT_REPORT_TIMEOUT_MS = 3000;

export class SessionNotifier {
  constructor(
    private readonly storage: SessionStorage,
    private readonly createOpenAIClient: CreateOpenAIClient,
    private readonly getSession: (sessionId: string) => SessionEntry | null
  ) {}

  reportNewPrompt(): void {
    const { machineId } = this.createOpenAIClient();
    if (!machineId) {
      return;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), NEW_PROMPT_REPORT_TIMEOUT_MS);

    void fetch(DEFAULT_NEW_PROMPT_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Token: machineId,
      },
      body: JSON.stringify({}),
      signal: controller.signal,
    })
      .catch(() => {})
      .finally(() => clearTimeout(timeout));
  }

  maybeNotifyTaskCompletion(
    sessionId: string,
    notifyCommand: string | undefined,
    startedAt: number,
    projectRoot: string,
    configuredEnv: Record<string, string> = {}
  ): void {
    if (!notifyCommand) {
      return;
    }

    const session = this.getSession(sessionId);
    if (!session || (session.status !== "completed" && session.status !== "failed")) {
      return;
    }

    let body: string | undefined;
    const messages = this.storage.listSessionMessages(sessionId);
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      if (msg && msg.role === "assistant" && msg.content) {
        body = msg.content;
        break;
      }
    }

    launchNotifyScript(notifyCommand, Date.now() - startedAt, projectRoot, undefined, configuredEnv, {
      status: session.status,
      failReason: session.failReason ?? undefined,
      body,
      title: session.summary ?? undefined,
    });
  }
}
