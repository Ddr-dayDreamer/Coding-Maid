import { execFileSync } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as pathWin32 from "path/win32";

const WINDOWS_GIT_LOCATIONS = ["C:\\Program Files\\Git\\cmd\\git.exe", "C:\\Program Files (x86)\\Git\\cmd\\git.exe"];
const WINDOWS_BASH_LOCATIONS = ["C:\\Program Files\\Git\\bin\\bash.exe", "C:\\Program Files (x86)\\Git\\bin\\bash.exe"];

const NUL_REDIRECT_REGEX = /(\d?&?>+\s*)[Nn][Uu][Ll](?=\s|$|[|&;)\n])/g;
let cachedGitBashPath: string | null = null;

// 非 Windows 平台常用 shell 路径探测候选（按优先级排列）
const LINUX_SHELL_CANDIDATES = [
  "/bin/bash",
  "/usr/bin/bash",
  "/bin/zsh",
  "/usr/bin/zsh",
  "/bin/dash",
  "/bin/sh",
  "/usr/bin/sh",
];

export type ShellKind = "bash" | "zsh" | "sh" | "unknown";

type WindowsGitBashLookup = {
  findExecutableCandidates: (executable: string) => string[];
  findGitExecPath: () => string | null;
  existsSync: (candidate: string) => boolean;
};

export function setShellIfWindows(): void {
  if (process.platform !== "win32") {
    return;
  }
  process.env.SHELL = findGitBashPath();
}

export function findGitBashPath(): string {
  if (cachedGitBashPath) {
    return cachedGitBashPath;
  }

  const bashPath = resolveWindowsGitBashPath({
    findExecutableCandidates: findAllWindowsExecutableCandidates,
    findGitExecPath,
    existsSync: fs.existsSync,
  });
  if (bashPath) {
    cachedGitBashPath = bashPath;
    return bashPath;
  }

  throw new Error(
    "Deep Code on Windows requires Git Bash. Install Git for Windows, or ensure Git's bash.exe is available in PATH."
  );
}

export function resolveWindowsGitBashPath(lookup: WindowsGitBashLookup): string | null {
  return firstExistingWindowsPath(
    [
      ...lookup.findExecutableCandidates("bash"),
      ...WINDOWS_BASH_LOCATIONS,
      ...gitExecPathToBashCandidates(lookup.findGitExecPath()),
      ...lookup.findExecutableCandidates("git").flatMap(gitExecutableToBashCandidates),
    ],
    lookup.existsSync
  );
}

export function resolveShellPath(): string {
  if (process.platform === "win32") {
    return findGitBashPath();
  }

  // 优先使用 SHELL 环境变量（仅当它是可执行的 bash/zsh/sh）
  const envShell = process.env.SHELL;
  if (envShell && getShellKind(envShell) !== "unknown" && isExecutableFile(envShell)) {
    return envShell;
  }

  // 其次：常用路径探测
  for (const candidate of LINUX_SHELL_CANDIDATES) {
    if (isExecutableFile(candidate)) {
      return candidate;
    }
  }

  // 再次：从 PATH 中查找
  const shellFromPath = findShellInPath();
  if (shellFromPath) {
    return shellFromPath;
  }

  throw new Error(
    "Coding-Maid could not find a usable POSIX shell (bash/zsh/sh). " +
      "Install one or set the SHELL environment variable to a valid shell path."
  );
}

export function getShellKind(shellPath: string): ShellKind {
  const executable = shellPath.replace(/\\/g, "/").split("/").pop()?.toLowerCase() ?? "";
  if (executable === "bash" || executable === "bash.exe") {
    return "bash";
  }
  if (executable === "zsh" || executable === "zsh.exe") {
    return "zsh";
  }
  if (
    executable === "sh" ||
    executable === "sh.exe" ||
    executable === "dash" ||
    executable === "dash.exe" ||
    executable === "ash" ||
    executable === "ash.exe"
  ) {
    return "sh";
  }
  return "unknown";
}

/** 判断文件是否存在且可执行（非 Windows 平台使用 X_OK 权限位） */
function isExecutableFile(filePath: string): boolean {
  try {
    fs.accessSync(filePath, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/** 在 PATH 中查找可用的 bash/zsh/sh（仅非 Windows 平台使用） */
function findShellInPath(): string | null {
  const pathEnv = process.env.PATH ?? "";
  const names = ["bash", "zsh", "sh", "dash", "ash"];
  for (const dir of pathEnv.split(":")) {
    if (!dir) {
      continue;
    }
    for (const name of names) {
      const candidate = path.join(dir, name);
      if (isExecutableFile(candidate) && getShellKind(candidate) !== "unknown") {
        return candidate;
      }
    }
  }
  return null;
}

export function buildShellInitCommand(shellPath: string): string | null {
  switch (getShellKind(shellPath)) {
    case "zsh":
      return ['ZSHRC="${ZDOTDIR:-$HOME}/.zshrc"', 'if [ -f "$ZSHRC" ]; then . "$ZSHRC"; fi'].join("; ");
    case "bash":
      return ['BASHRC="${BASH_ENV:-$HOME/.bashrc}"', 'if [ -f "$BASHRC" ]; then . "$BASHRC"; fi'].join("; ");
    case "sh":
      // POSIX sh 不读取 rc 文件，避免非交互输出污染 stdout
      return null;
    default:
      return null;
  }
}

export function buildDisableExtglobCommand(shellPath: string): string | null {
  switch (getShellKind(shellPath)) {
    case "bash":
      return "shopt -u extglob 2>/dev/null || true";
    case "zsh":
      return "setopt NO_EXTENDED_GLOB 2>/dev/null || true";
    case "sh":
      // POSIX sh 不支持 extglob，无需禁用
      return null;
    default:
      return null;
  }
}

export function rewriteWindowsNullRedirect(command: string): string {
  return command.replace(NUL_REDIRECT_REGEX, "$1/dev/null");
}

export function windowsPathToPosixPath(windowsPath: string): string {
  if (windowsPath.startsWith("\\\\")) {
    return windowsPath.replace(/\\/g, "/");
  }

  const driveMatch = windowsPath.match(/^([A-Za-z]):[/\\]/);
  if (driveMatch) {
    const driveLetter = driveMatch[1].toLowerCase();
    return `/${driveLetter}${windowsPath.slice(2).replace(/\\/g, "/")}`;
  }

  return windowsPath.replace(/\\/g, "/");
}

export function posixPathToWindowsPath(posixPath: string): string {
  if (posixPath.startsWith("//")) {
    return posixPath.replace(/\//g, "\\");
  }

  const cygdriveMatch = posixPath.match(/^\/cygdrive\/([A-Za-z])(\/|$)/);
  if (cygdriveMatch) {
    const driveLetter = cygdriveMatch[1].toUpperCase();
    const rest = posixPath.slice(`/cygdrive/${cygdriveMatch[1]}`.length);
    return `${driveLetter}:${(rest || "\\").replace(/\//g, "\\")}`;
  }

  const driveMatch = posixPath.match(/^\/([A-Za-z])(\/|$)/);
  if (driveMatch) {
    const driveLetter = driveMatch[1].toUpperCase();
    const rest = posixPath.slice(2);
    return `${driveLetter}:${(rest || "\\").replace(/\//g, "\\")}`;
  }

  return posixPath.replace(/\//g, "\\");
}

export function toNativeCwd(shellCwd: string): string {
  if (process.platform !== "win32") {
    return shellCwd;
  }
  return posixPathToWindowsPath(shellCwd);
}

export function buildShellEnv(shellPath: string, extraEnv: Record<string, string> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    ...extraEnv,
    SHELL: shellPath,
    GIT_EDITOR: "true",
  };

  if (process.platform === "win32") {
    const tmpdir = windowsPathToPosixPath(os.tmpdir());
    env.TMPDIR = tmpdir;
    env.TMPPREFIX = path.posix.join(tmpdir, "zsh");
  }

  return env;
}

function findAllWindowsExecutableCandidates(executable: string): string[] {
  const extraCandidates =
    executable === "git" ? WINDOWS_GIT_LOCATIONS : executable === "bash" ? WINDOWS_BASH_LOCATIONS : [];

  try {
    const output = execFileSync("where.exe", [executable], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      windowsHide: true,
    });
    let whereResults = output
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    if (executable === "bash") {
      // Skip WSL's deprecated bash.exe launcher (C:\Windows\System32\bash.exe).
      // It would start commands inside the Linux distro instead of the Windows host,
      // breaking all path translations and tool invocations.
      whereResults = whereResults.filter((candidate) => !/system32[\\/]bash\.exe$/i.test(candidate));
    }
    return filterWindowsExecutableCandidates([...whereResults, ...extraCandidates]);
  } catch {
    return filterWindowsExecutableCandidates(extraCandidates);
  }
}

function findGitExecPath(): string | null {
  try {
    const output = execFileSync("git", ["--exec-path"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      windowsHide: true,
    }).trim();
    return output || null;
  } catch {
    return null;
  }
}

function gitExecPathToBashCandidates(execPath: string | null): string[] {
  if (!execPath) {
    return [];
  }

  const normalized = execPath.replace(/\//g, "\\");
  return [
    pathWin32.join(normalized, "..", "..", "..", "bin", "bash.exe"),
    pathWin32.join(normalized, "..", "..", "bin", "bash.exe"),
  ];
}

function gitExecutableToBashCandidates(gitPath: string): string[] {
  return [pathWin32.join(gitPath, "..", "..", "bin", "bash.exe"), pathWin32.join(gitPath, "..", "bin", "bash.exe")];
}

function firstExistingWindowsPath(candidates: string[], existsSync: (candidate: string) => boolean): string | null {
  const seen = new Set<string>();
  for (const candidate of candidates) {
    const normalized = pathWin32.resolve(candidate);
    const key = normalized.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    if (getShellKind(normalized) === "bash" && existsSync(normalized)) {
      return normalized;
    }
  }
  return null;
}

function filterWindowsExecutableCandidates(candidates: string[]): string[] {
  const cwd = process.cwd().toLowerCase();
  const seen = new Set<string>();
  const results: string[] = [];

  for (const candidate of candidates) {
    const normalized = path.resolve(candidate).toLowerCase();
    const candidateDir = path.dirname(normalized).toLowerCase();
    if (candidateDir === cwd || normalized.startsWith(`${cwd}${path.sep}`)) {
      continue;
    }
    if (!seen.has(normalized) && fs.existsSync(candidate)) {
      seen.add(normalized);
      results.push(candidate);
    }
  }

  return results;
}
