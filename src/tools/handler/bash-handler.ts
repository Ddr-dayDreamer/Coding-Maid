import { spawn } from "child_process";
import * as fs from "fs";
import { killProcessTree } from "../../utils/process-tree";
import type { ProcessTimeoutControl, ProcessTimeoutInfo, ToolExecutionContext, ToolExecutionResult } from "../types";
import {
  buildDisableExtglobCommand,
  buildShellEnv,
  buildShellInitCommand,
  resolveShellPath,
  rewriteWindowsNullRedirect,
  toNativeCwd,
} from "../../utils/shell-utils";

const DEFAULT_BASH_TIMEOUT_MS = 10 * 60 * 1000;
const MIN_BASH_TIMEOUT_MS = 60 * 1000;
const BASH_TIMEOUT_INCREMENT_MS = 5 * 60 * 1000;
const BASH_TIMEOUT_DECREMENT_MS = 60 * 1000;

/**
 * shell 进程退出后，等待 stdout/stderr 管道排空的宽限时间。
 *
 * 命令留下的后代进程（helper / watcher / daemon 等）如果继承了输出管道，
 * Node 的 `close` 事件就会一直等管道关闭而不触发，工具便表现为"卡住"。
 * 此时以已捕获的输出收尾，保证调用方一定能拿到结果。
 */
const EXIT_DRAIN_GRACE_MS = 500;
/** 超时 kill 之后管道仍未关闭时，最多再等这么久就强制收尾 */
const KILL_SETTLE_GRACE_MS = 5000;

function clampBashTimeoutMs(timeoutMs: number, minTimeoutMs: number = MIN_BASH_TIMEOUT_MS): number {
  if (!Number.isFinite(timeoutMs)) {
    return DEFAULT_BASH_TIMEOUT_MS;
  }
  const minimum = Number.isFinite(minTimeoutMs) ? Math.max(1, Math.round(minTimeoutMs)) : MIN_BASH_TIMEOUT_MS;
  return Math.max(minimum, Math.round(timeoutMs));
}

const MAX_OUTPUT_CHARS = 30000;
const MAX_CAPTURE_CHARS = 10 * 1024 * 1024;
const sessionWorkingDirs = new Map<string, string>();

type ToolCommandResult = {
  ok: boolean;
  output: string;
  cwd: string | null;
  exitCode: number | null;
  signal: string | null;
  truncated: boolean;
  shellPath?: string;
  startCwd?: string;
  timedOut?: boolean;
  timeoutMs?: number;
  deadlineAt?: string;
  pipesHeldOpen?: boolean;
};

/**
 * 一次 shell 执行的原始结果。
 *
 * `pipesHeldOpen` 为 true 表示 shell 已退出，但有后代进程仍持有输出管道，
 * 因此结果是靠宽限时间兜底收尾的（否则 `close` 可能永远不来）。
 */
type ShellExecution = {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  signal: string | null;
  error?: string;
  timedOut: boolean;
  timeoutMs: number;
  deadlineAtMs: number;
  pipesHeldOpen: boolean;
};

export async function handleBashTool(
  args: Record<string, unknown>,
  context: ToolExecutionContext
): Promise<ToolExecutionResult> {
  const command = typeof args.command === "string" ? args.command : "";
  if (!command.trim()) {
    return {
      ok: false,
      name: "bash",
      error: 'Missing required "command" string.',
    };
  }

  const description = typeof args.description === "string" ? args.description.trim() : "";

  const startCwd = getSessionCwd(context.sessionId, context.projectRoot);
  let shellCommand: { shellPath: string; shellArgs: string[]; marker: string };
  try {
    shellCommand = buildShellCommand(command);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      name: "bash",
      error: message,
    };
  }
  const { shellPath, shellArgs, marker } = shellCommand;

  const execution = await executeShellCommand(shellPath, shellArgs, startCwd, command, description, context);
  const result = buildToolCommandResult(execution, marker, shellPath, startCwd);
  const sessionCwd = updateSessionCwd(context.sessionId, startCwd, result.cwd);
  if (result.cwd !== null && result.cwd !== sessionCwd) {
    // 解析出的目录不可用（例如 MSYS 内部路径），报告实际沿用的目录，避免调用方使用无效路径
    result.cwd = sessionCwd;
  }
  if (execution.error) {
    // shell 进程都没起来（起始目录被删除等），清掉缓存，让下次调用从项目根目录重新开始
    sessionWorkingDirs.delete(context.sessionId);
  }

  if (execution.error || result.exitCode !== 0 || result.signal !== null) {
    const errorMessage = buildErrorMessage(result.exitCode, result.signal, execution.error, execution.timedOut);
    return formatResult({ ...result, ok: false }, "bash", errorMessage);
  }

  return formatResult(result, "bash");
}

/**
 * 选出这一次调用真正可用的起始目录。
 *
 * spawn 的 `cwd` 指向不存在的目录时，Node 会直接以 ENOENT 失败（并且报的是
 * shell 可执行文件的 ENOENT），命令根本不会执行；这种情况下调用方连 `cd` 回去
 * 的机会都没有，会话就永久卡死。因此缓存的目录、项目根目录都必须先确认存在，
 * 逐级回退到最后一个兜底目录（进程工作目录）。
 */
function getSessionCwd(sessionId: string, fallback: string): string {
  for (const candidate of [sessionWorkingDirs.get(sessionId), fallback, process.cwd()]) {
    if (isUsableDirectory(candidate)) {
      return candidate;
    }
  }
  return fallback;
}

/** 记录命令结束时的 cwd 供下次调用使用，并返回真正生效的目录（无效则沿用 fallback） */
function updateSessionCwd(sessionId: string, fallback: string, cwd: string | null): string {
  const nextCwd = isUsableDirectory(cwd) ? cwd : fallback;
  sessionWorkingDirs.set(sessionId, nextCwd);
  return nextCwd;
}

/**
 * 目录必须真实存在，否则不能作为 spawn 的 `cwd`。
 *
 * shell 里的 `PWD` 未必是 Windows 可用的路径：Git Bash 的 `cd /tmp` 其实是 MSYS
 * 挂载点，转成 `\tmp` 这种路径在 Windows 上并不存在。
 */
function isUsableDirectory(candidate: string | null | undefined): candidate is string {
  if (!candidate) {
    return false;
  }
  try {
    return fs.statSync(candidate).isDirectory();
  } catch {
    return false;
  }
}

function buildShellCommand(command: string): {
  shellPath: string;
  shellArgs: string[];
  marker: string;
} {
  const shellPath = resolveShellPath();
  const marker = buildMarker();
  const initCommand = buildShellInitCommand(shellPath);
  const disableExtglobCommand = buildDisableExtglobCommand(shellPath);
  const normalizedCommand = rewriteWindowsNullRedirect(command);
  const wrappedParts = [];
  if (initCommand) {
    wrappedParts.push(initCommand);
  }
  if (disableExtglobCommand) {
    wrappedParts.push(disableExtglobCommand);
  }
  wrappedParts.push(
    normalizedCommand,
    "__CODINGMAID_STATUS__=$?",
    // `pwd -W`（Git Bash/MSYS）输出 Windows 原生路径，避免 `/tmp` 这类 MSYS 路径被
    // 当成相对路径记录；不支持 `-W` 的 shell（zsh/sh 等）回退到 `pwd`。
    `printf '%s%s\\n' "${marker}" "$(pwd -W 2>/dev/null || pwd)"`,
    "exit $__CODINGMAID_STATUS__"
  );
  const wrappedCommand = `{ ${wrappedParts.join("; ")}; } < /dev/null`;
  return { shellPath, shellArgs: ["-c", wrappedCommand], marker };
}

async function executeShellCommand(
  shellPath: string,
  shellArgs: string[],
  cwd: string,
  command: string,
  description: string,
  context: ToolExecutionContext
): Promise<ShellExecution> {
  return new Promise((resolve) => {
    const detached = process.platform !== "win32";
    const configuredEnv = context.createOpenAIClient?.().env ?? {};
    const minTimeoutMs = context.bashMinTimeoutMs;
    const initialTimeoutMs = clampBashTimeoutMs(context.bashTimeoutMs ?? DEFAULT_BASH_TIMEOUT_MS, minTimeoutMs);
    const startedAtMs = Date.now();
    let timeoutMs = initialTimeoutMs;
    let deadlineAtMs = startedAtMs + timeoutMs;
    let timedOut = false;
    let settled = false;
    let timeoutTimer: ReturnType<typeof setTimeout> | null = null;
    let drainTimer: ReturnType<typeof setTimeout> | null = null;
    const child = spawn(shellPath, shellArgs, {
      cwd,
      env: buildShellEnv(shellPath, configuredEnv),
      detached,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const pid = child.pid;

    let stdout = "";
    let stderr = "";
    let error: string | undefined;
    let exitCode: number | null = null;
    let exitSignal: string | null = null;
    /** shell 已退出但输出管道仍被后代进程占用 */
    let pipesHeldOpen = false;

    const getTimeoutInfo = (): ProcessTimeoutInfo => ({
      timeoutMs,
      startedAtMs,
      deadlineAtMs,
      timedOut,
    });
    const stopTimeoutTimer = () => {
      if (timeoutTimer) {
        clearTimeout(timeoutTimer);
        timeoutTimer = null;
      }
    };
    const stopDrainTimer = () => {
      if (drainTimer) {
        clearTimeout(drainTimer);
        drainTimer = null;
      }
    };
    /** 以当前已捕获的输出结束这次执行（幂等） */
    const finish = () => {
      if (settled) {
        return;
      }
      settled = true;
      stopTimeoutTimer();
      stopDrainTimer();
      if (typeof pid === "number") {
        context.onProcessTimeoutControl?.(pid, null);
        context.onProcessExit?.(pid);
      }
      resolve({
        stdout,
        stderr,
        exitCode,
        signal: exitSignal,
        error,
        timedOut,
        timeoutMs,
        deadlineAtMs,
        pipesHeldOpen,
      });
    };
    /**
     * 进程退出后的兜底收尾：正常情况下此时 `close` 马上就会到（并取消这个定时器），
     * 只有当输出管道被后代进程攥住、`close` 不来时才会真正生效。
     */
    const scheduleDrain = (delayMs: number) => {
      if (settled || drainTimer) {
        return;
      }
      drainTimer = setTimeout(() => {
        drainTimer = null;
        if (!isStdioClosed()) {
          pipesHeldOpen = true;
        }
        finish();
      }, delayMs);
    };
    const isStdioClosed = (): boolean =>
      (child.stdout?.readableEnded ?? true) && (child.stderr?.readableEnded ?? true);
    const triggerTimeout = () => {
      if (settled || timedOut || typeof pid !== "number") {
        return;
      }
      timedOut = true;
      stopTimeoutTimer();
      killProcessTree(pid, "SIGKILL");
      // kill 之后仍拿不到 close 时（例如 kill 未生效）也要收尾，避免永久挂起
      scheduleDrain(KILL_SETTLE_GRACE_MS);
    };
    const scheduleTimeout = () => {
      stopTimeoutTimer();
      if (settled) {
        return;
      }
      const remainingMs = Math.max(0, deadlineAtMs - Date.now());
      timeoutTimer = setTimeout(triggerTimeout, remainingMs);
    };
    const timeoutControl: ProcessTimeoutControl = {
      getInfo: getTimeoutInfo,
      setTimeoutMs: (nextTimeoutMs) => {
        timeoutMs = clampBashTimeoutMs(nextTimeoutMs, minTimeoutMs);
        deadlineAtMs = startedAtMs + timeoutMs;
        if (deadlineAtMs <= Date.now()) {
          triggerTimeout();
        } else {
          scheduleTimeout();
        }
        return getTimeoutInfo();
      },
    };

    if (typeof pid === "number") {
      context.onProcessStart?.(pid, description || command);
      context.onProcessTimeoutControl?.(pid, timeoutControl);
      scheduleTimeout();
    }

    child.stdout?.on("data", (chunk: string | Buffer) => {
      stdout = appendChunk(stdout, chunk);
      const text = typeof chunk === "string" ? chunk : chunk.toString("utf8");
      context.onProcessStdout?.(pid as number, text);
    });
    child.stderr?.on("data", (chunk: string | Buffer) => {
      stderr = appendChunk(stderr, chunk);
      const text = typeof chunk === "string" ? chunk : chunk.toString("utf8");
      context.onProcessStdout?.(pid as number, text);
    });

    child.on("error", (spawnError) => {
      error = spawnError.message;
      // spawn/exec 失败时不会有正常输出，也不可能等到 close，直接以错误收尾
      finish();
    });

    child.on("exit", (code, handlerSignal) => {
      exitCode = typeof code === "number" ? code : null;
      exitSignal = handlerSignal ?? null;
      // shell 已经退出，命令结果已经确定；给管道留一个短窗口排空剩余输出，
      // 若后代进程仍攥着管道导致 close 不来，就靠这个定时器收尾。
      scheduleDrain(EXIT_DRAIN_GRACE_MS);
    });

    child.on("close", (code, handlerSignal) => {
      exitCode = typeof code === "number" ? code : null;
      exitSignal = handlerSignal ?? null;
      finish();
    });
  });
}

function appendChunk(existing: string, chunk: string | Buffer): string {
  if (existing.length >= MAX_CAPTURE_CHARS) {
    return existing;
  }
  const text = typeof chunk === "string" ? chunk : chunk.toString("utf8");
  const remaining = MAX_CAPTURE_CHARS - existing.length;
  return `${existing}${text.slice(0, remaining)}`;
}

function buildMarker(): string {
  const token = Math.random().toString(36).slice(2);
  return `__CODINGMAID_PWD__${token}__`;
}

function buildToolCommandResult(
  execution: ShellExecution,
  marker: string,
  shellPath: string,
  startCwd: string
): ToolCommandResult {
  const { output: cleanedStdout, cwd } = stripMarker(execution.stdout, marker);
  const combined = joinOutput(cleanedStdout, execution.stderr);
  const { text, truncated } = truncateOutput(combined);
  return {
    ok: execution.exitCode === 0 && execution.signal === null,
    output: text,
    cwd,
    exitCode: execution.exitCode,
    signal: execution.signal,
    truncated,
    shellPath,
    startCwd,
    timedOut: execution.timedOut,
    timeoutMs: execution.timeoutMs,
    deadlineAt: new Date(execution.deadlineAtMs).toISOString(),
    pipesHeldOpen: execution.pipesHeldOpen,
  };
}

function stripMarker(stdout: string, marker: string): { output: string; cwd: string | null } {
  if (!stdout) {
    return { output: "", cwd: null };
  }

  const lines = stdout.split(/\r?\n/);
  let markerIndex = -1;
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    if (lines[i].startsWith(marker)) {
      markerIndex = i;
      break;
    }
  }

  if (markerIndex === -1) {
    return { output: stdout, cwd: null };
  }

  const markerLine = lines[markerIndex];
  const shellCwd = markerLine.slice(marker.length).trim();
  const cwd = shellCwd ? toNativeCwd(shellCwd) : null;
  lines.splice(markerIndex, 1);
  return { output: lines.join("\n"), cwd };
}

function joinOutput(stdout: string, stderr: string): string {
  const trimmedStdout = stdout ?? "";
  const trimmedStderr = stderr ?? "";
  if (trimmedStdout && trimmedStderr) {
    return `${trimmedStdout}\n${trimmedStderr}`;
  }
  return trimmedStdout || trimmedStderr;
}

function truncateOutput(output: string): { text: string; truncated: boolean } {
  if (output.length <= MAX_OUTPUT_CHARS) {
    return { text: output, truncated: false };
  }
  return { text: output.slice(0, MAX_OUTPUT_CHARS), truncated: true };
}

function buildErrorMessage(exitCode: number | null, signal: string | null, error?: string, timedOut = false): string {
  if (error) {
    return error;
  }
  if (timedOut) {
    return "Command timed out.";
  }
  if (signal) {
    return `Command terminated by signal ${signal}.`;
  }
  if (exitCode !== null) {
    return `Command failed with exit code ${exitCode}.`;
  }
  return "Command failed.";
}

function formatResult(result: ToolCommandResult, name: string, errorMessage?: string): ToolExecutionResult {
  const metadata: Record<string, unknown> = {
    exitCode: result.exitCode,
    signal: result.signal,
    cwd: result.cwd,
    truncated: result.truncated,
    shellPath: result.shellPath,
    startCwd: result.startCwd,
  };
  if (typeof result.timedOut === "boolean") {
    metadata.timedOut = result.timedOut;
  }
  if (typeof result.timeoutMs === "number") {
    metadata.timeoutMs = result.timeoutMs;
  }
  if (result.deadlineAt) {
    metadata.deadlineAt = result.deadlineAt;
  }
  if (result.pipesHeldOpen) {
    metadata.pipesHeldOpen = true;
  }

  const outputValue = result.output ? result.output : undefined;

  return {
    ok: result.ok,
    name,
    output: outputValue,
    error: errorMessage,
    metadata,
  };
}
