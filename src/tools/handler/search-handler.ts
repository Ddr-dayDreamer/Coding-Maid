/**
 * search — handler 实现
 *
 * 两种模式：
 *   text — 文件内容搜索（grep-like）
 *   file — 文件路径搜索（glob-like）
 *
 * 使用 Node.js 原生 fs，无需外部依赖。
 * 自动过滤 .gitignore 和二进制文件。
 *
 * 全程异步 I/O：目录顺序递归、文件按批并发读取，
 * 既不会阻塞扩展宿主，也能让大量小文件的读取重叠起来。
 */

import * as fs from "fs";
import * as path from "path";
import ignore from "ignore";
import type { ToolExecutionContext, ToolExecutionResult } from "../types";
import { posixPathToWindowsPath } from "../../utils/shell-utils";

// ─── 常量 ───────────────────────────────────────────────

const DEFAULT_MAX_RESULTS = 50;
const HARD_MAX_RESULTS = 200;
const MAX_FILE_SIZE_BYTES = 1 * 1024 * 1024; // 跳过 >1MB 的文件
/** 单批并发读取的文件数：够快，又不会在超大目录里一次性打开上千个句柄 */
const FILE_READ_CONCURRENCY = 16;
/** 单行结果截断长度 */
const MAX_LINE_CHARS = 200;

const DEFAULT_GITIGNORE_PATTERNS = [
  "node_modules/",
  ".git/",
  "dist/",
  "build/",
  "out/",
  ".next/",
  ".nuxt/",
  ".venv/",
  "venv/",
  "__pycache__/",
  "*.pyc",
  "*.pyo",
  ".pytest_cache/",
  ".mypy_cache/",
  ".ruff_cache/",
  ".gradle/",
  ".idea/",
  ".vscode/",
  "*.class",
  "*.jar",
  "*.war",
  "target/",
  ".gitignore",
];

const BINARY_EXTS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".bmp",
  ".ico",
  ".svg",
  ".webp",
  ".woff",
  ".woff2",
  ".ttf",
  ".eot",
  ".otf",
  ".mp3",
  ".mp4",
  ".avi",
  ".mov",
  ".wav",
  ".ogg",
  ".zip",
  ".tar",
  ".gz",
  ".rar",
  ".7z",
  ".pdf",
  ".doc",
  ".docx",
  ".xls",
  ".xlsx",
  ".ppt",
  ".pptx",
  ".exe",
  ".dll",
  ".so",
  ".dylib",
  ".bin",
  ".o",
  ".a",
  ".obj",
  ".lib",
  ".wasm",
  ".vsix",
  ".crx",
  ".otf",
  ".ttf",
  ".eot",
  ".woff",
  ".woff2",
]);

// ─── Gitignore 加载 ─────────────────────────────────────

function loadGitignoreMatcher(
  rootPath: string,
): ((relPath: string, isDir: boolean) => boolean) | null {
  const gitignorePath = path.join(rootPath, ".gitignore");
  const ig = ignore();
  ig.add(DEFAULT_GITIGNORE_PATTERNS);

  if (fs.existsSync(gitignorePath)) {
    try {
      const content = fs.readFileSync(gitignorePath, "utf8");
      ig.add(content);
    } catch {
      // 忽略读取失败
    }
  }

  return (relPath: string, isDir: boolean) => {
    if (!relPath) return false;
    return ig.ignores(isDir ? `${relPath}/` : relPath);
  };
}

// ─── Glob 匹配 ──────────────────────────────────────────

/**
 * 将 glob 模式转换为 RegExp。
 * 支持：** * ? {a,b}
 */
function globToRegex(pattern: string): RegExp {
  let src = "";
  let i = 0;

  while (i < pattern.length) {
    const ch = pattern[i];

    if (ch === "*" && pattern[i + 1] === "*" && pattern[i + 2] === "/") {
      // **/ 匹配任意深度目录
      src += "(?:.+/)?";
      i += 3;
    } else if (ch === "*" && pattern[i + 1] === "*" && i + 2 >= pattern.length) {
      // 末尾 ** 匹配一切
      src += ".+";
      i += 2;
    } else if (ch === "*") {
      // 单 * 匹配非 /
      src += "[^/]*";
      i += 1;
    } else if (ch === "?") {
      src += "[^/]";
      i += 1;
    } else if (ch === "{") {
      // {...} 展开为 (a|b|c)
      const close = pattern.indexOf("}", i);
      if (close === -1) {
        src += "\\{";
        i += 1;
      } else {
        const inner = pattern.slice(i + 1, close);
        src += `(${inner.split(",").map((s) => globToRegexPart(s.trim())).join("|")})`;
        i = close + 1;
      }
    } else if (ch === "." || ch === "+" || ch === "^" || ch === "$" || ch === "(" || ch === ")" || ch === "[" || ch === "]" || ch === "|" || ch === "\\") {
      src += `\\${ch}`;
      i += 1;
    } else {
      src += ch;
      i += 1;
    }
  }

  return new RegExp(`^${src}$`, "i");
}

/** 辅助：对 glob 片段内的特殊字符转义 */
function globToRegexPart(s: string): string {
  let out = "";
  for (const ch of s) {
    if (/[.+^${}()|[\]\\]/.test(ch)) {
      out += `\\${ch}`;
    } else if (ch === "*") {
      out += "[^/]*";
    } else if (ch === "?") {
      out += "[^/]";
    } else {
      out += ch;
    }
  }
  return out;
}

/** 已编译的 glob 正则缓存（同一个 pattern 会对每个文件都用到） */
const globRegexCache = new Map<string, RegExp>();

function globToRegexCached(pattern: string): RegExp {
  const cached = globRegexCache.get(pattern);
  if (cached) {
    return cached;
  }
  const compiled = globToRegex(pattern);
  if (globRegexCache.size < 200) {
    globRegexCache.set(pattern, compiled);
  }
  return compiled;
}

/** 检查路径是否匹配 glob 模式 */
function matchGlob(filePath: string, pattern: string): boolean {
  // 纯字符串包含查询
  if (!pattern.includes("*") && !pattern.includes("?") && !pattern.includes("{")) {
    return filePath.toLowerCase().includes(pattern.toLowerCase());
  }

  return globToRegexCached(pattern).test(filePath);
}

// ─── 二进制文件检测 ─────────────────────────────────────

function isBinaryExt(filePath: string): boolean {
  return BINARY_EXTS.has(path.extname(filePath).toLowerCase());
}

// ─── 异步遍历 ───────────────────────────────────────────

type DirFile = { fullPath: string; relPath: string };

/**
 * 按目录递归遍历，把每个目录下的文件交给 handleDirFiles 处理。
 *
 * 目录顺序递归、文件按批并发读取，所以结果顺序稳定；
 * 全程异步 I/O，不会阻塞扩展宿主。
 */
async function walkTree(
  rootPath: string,
  isIgnored: (relPath: string, isDir: boolean) => boolean,
  includePattern: string | undefined,
  handleDirFiles: (files: DirFile[]) => Promise<void>,
  shouldStop: () => boolean,
): Promise<void> {
  async function walk(dir: string, relPath: string): Promise<void> {
    if (shouldStop()) return;

    let entries: fs.Dirent[];
    try {
      entries = await fs.promises.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }

    const files: DirFile[] = [];
    const subdirs: { dir: string; relPath: string }[] = [];

    for (const entry of entries) {
      const relEntry = relPath ? `${relPath}/${entry.name}` : entry.name;
      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        if (!isIgnored(relEntry, true)) {
          subdirs.push({ dir: fullPath, relPath: relEntry });
        }
      } else if (entry.isFile()) {
        if (isIgnored(relEntry, false)) continue;
        if (includePattern && !matchGlob(relEntry, includePattern)) continue;
        files.push({ fullPath, relPath: relEntry });
      }
    }

    if (files.length > 0) {
      await handleDirFiles(files);
    }

    for (const sub of subdirs) {
      if (shouldStop()) return;
      await walk(sub.dir, sub.relPath);
    }
  }

  await walk(rootPath, "");
}

/** 读取文本文件内容；超出大小上限或读取失败时返回 null */
async function readTextFile(fullPath: string): Promise<string | null> {
  try {
    const stat = await fs.promises.stat(fullPath);
    if (stat.size > MAX_FILE_SIZE_BYTES) return null;
  } catch {
    return null;
  }
  try {
    return await fs.promises.readFile(fullPath, "utf8");
  } catch {
    return null;
  }
}

// ─── Text 模式 ──────────────────────────────────────────

interface TextMatch {
  file: string;
  line: number;
  content: string;
}

/** 内容匹配器：把文件内容里的命中追加到 out，最多 limit 条 */
type ContentMatcher = (content: string, file: string, limit: number, out: TextMatch[]) => void;

function formatMatchedLine(rawLine: string): string {
  return rawLine.replace(/\t/g, " ").substring(0, MAX_LINE_CHARS).trimEnd();
}

/**
 * 字面量搜索（大小写不敏感）。
 *
 * 优先整文件小写化 + 原生 indexOf 定位命中的行，再回溯换行数算行号：
 * 每个文件只走一遍内容，未命中的文件一次 indexOf 就能整体排除，
 * 比"逐行 slice + toLowerCase + includes"省掉大量分配和 JS 循环。
 */
function collectLiteralMatches(
  content: string,
  needleLower: string,
  file: string,
  limit: number,
  out: TextMatch[],
): void {
  if (limit <= 0) return;

  const lower = content.toLowerCase();
  if (lower.length !== content.length) {
    // 极少数 Unicode 字符（如 İ）小写化后长度会变，此时退回逐行比较
    collectLiteralMatchesByLine(content, needleLower, file, limit, out);
    return;
  }

  let searchFrom = 0;
  let lineStart = 0;
  let lineNo = 1;

  for (; ;) {
    const hit = lower.indexOf(needleLower, searchFrom);
    if (hit === -1) return;

    // 从上一行行首走到命中所在行，累计行号（整次搜索摊下来是 O(n)）
    for (; ;) {
      const newline = content.indexOf("\n", lineStart);
      if (newline === -1 || newline >= hit) break;
      lineStart = newline + 1;
      lineNo += 1;
    }

    const hitNewline = content.indexOf("\n", hit);
    const lineEnd = hitNewline === -1 ? content.length : hitNewline;
    out.push({ file, line: lineNo, content: formatMatchedLine(content.slice(lineStart, lineEnd)) });
    if (out.length >= limit) return;

    lineStart = lineEnd + 1;
    lineNo += 1;
    searchFrom = lineStart;
  }
}

/** 退路：逐行比较（语义与整文件搜索一致，每行最多记一条） */
function collectLiteralMatchesByLine(
  content: string,
  needleLower: string,
  file: string,
  limit: number,
  out: TextMatch[],
): void {
  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (line.toLowerCase().includes(needleLower)) {
      out.push({ file, line: i + 1, content: formatMatchedLine(line) });
      if (out.length >= limit) return;
    }
  }
}

/**
 * 正则搜索（大小写不敏感），按行匹配。
 *
 * 匹配前先用一次整文件 test 快速排除完全不含匹配的文件，多数"扫一遍没结果"的
 * 文件就只花这一次原生扫描。外层用带 `m` 的同一份正则，`^` / `$` 才算在行边界上，
 * 整文件 test 就是逐行匹配的超集，不会漏掉结果。
 */
function collectRegexMatches(
  content: string,
  regexp: RegExp,
  file: string,
  limit: number,
  out: TextMatch[],
): void {
  if (limit <= 0) return;
  if (!regexp.test(content)) return;

  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (regexp.test(line)) {
      out.push({ file, line: i + 1, content: formatMatchedLine(line) });
      if (out.length >= limit) return;
    }
  }
}

function buildContentMatcher(regexp: RegExp | null, needleLower: string): ContentMatcher {
  if (regexp) {
    return (content, file, limit, out) => collectRegexMatches(content, regexp, file, limit, out);
  }
  return (content, file, limit, out) => collectLiteralMatches(content, needleLower, file, limit, out);
}

async function searchText(
  rootPath: string,
  matcher: ContentMatcher,
  includePattern: string | undefined,
  maxResults: number,
  isIgnored: (relPath: string, isDir: boolean) => boolean,
): Promise<TextMatch[]> {
  const results: TextMatch[] = [];
  const shouldStop = () => results.length >= maxResults;

  await walkTree(
    rootPath,
    isIgnored,
    includePattern,
    async (files) => {
      for (let i = 0; i < files.length; i += FILE_READ_CONCURRENCY) {
        if (shouldStop()) return;

        const chunk = files.slice(i, i + FILE_READ_CONCURRENCY);
        const chunkMatches = await Promise.all(
          chunk.map(async (file) => {
            if (isBinaryExt(file.fullPath)) return null;
            const content = await readTextFile(file.fullPath);
            if (content === null) return null;
            const found: TextMatch[] = [];
            matcher(content, file.relPath, maxResults - results.length, found);
            return found;
          }),
        );

        // 按遍历顺序合并，保证输出稳定
        for (const found of chunkMatches) {
          if (!found) continue;
          for (const match of found) {
            results.push(match);
            if (results.length >= maxResults) return;
          }
        }
      }
    },
    shouldStop,
  );

  return results;
}

// ─── File 模式 ──────────────────────────────────────────

async function searchFiles(
  rootPath: string,
  query: string,
  includePattern: string | undefined,
  maxResults: number,
  isIgnored: (relPath: string, isDir: boolean) => boolean,
): Promise<string[]> {
  const results: string[] = [];
  const shouldStop = () => results.length >= maxResults;

  await walkTree(
    rootPath,
    isIgnored,
    includePattern,
    async (files) => {
      for (const file of files) {
        if (results.length >= maxResults) return;
        if (matchGlob(file.relPath, query)) {
          results.push(file.relPath);
        }
      }
    },
    shouldStop,
  );

  return results;
}

// ─── 格式化输出 ─────────────────────────────────────────

function formatTextResults(
  results: TextMatch[],
  query: string,
  rootPath: string,
  isRegexp: boolean,
  includePattern: string | undefined,
): string {
  if (results.length === 0) {
    let msg = `No results found for "${query}"`;
    msg += ` in "${rootPath}"`;
    msg += isRegexp ? " (regex)" : " (text)";
    if (includePattern) msg += ` with includePattern "${includePattern}"`;
    msg += ".";
    return msg;
  }

  const lines: string[] = [];
  let currentFile = "";

  for (const r of results) {
    if (r.file !== currentFile) {
      currentFile = r.file;
      lines.push("");
      lines.push(r.file);
    }
    lines.push(`  ${String(r.line).padStart(5)}: ${r.content}`);
  }

  return lines.join("\n").trimStart() + `\n\n(${results.length} result${results.length > 1 ? "s" : ""})`;
}

function formatFileResults(
  results: string[],
  query: string,
  rootPath: string,
  includePattern: string | undefined,
): string {
  if (results.length === 0) {
    let msg = `No files found matching "${query}"`;
    msg += ` in "${rootPath}"`;
    if (includePattern) msg += ` with includePattern "${includePattern}"`;
    msg += ".";
    return msg;
  }

  return results.join("\n") + `\n\n(${results.length} file${results.length > 1 ? "s" : ""})`;
}

// ─── 查询解析 ───────────────────────────────────────────

/** 命中任一字符时认为这条查询"看起来是正则" */
const REGEX_META_CHARS = /[\\^$.*+?()[\]{}|]/;

/**
 * 决定把查询当成正则还是字面量。
 *
 * 显式传 `isRegexp` 时以传入值为准；没传时自动判断——
 * 含正则元字符的查询按正则处理，这样模型忘记填 `isRegexp`
 * 也能直接命中 `handle.*Tool\(` 这类写法。
 */
function resolveQueryMatcher(
  query: string,
  explicitRegexp: boolean | undefined,
): { regexp: RegExp | null; needleLower: string; isRegexp: boolean } | { error: string } {
  if (explicitRegexp === true || (explicitRegexp === undefined && REGEX_META_CHARS.test(query))) {
    try {
      // `m` 让 `^` / `$` 在整文件预筛时也按行边界工作，与逐行匹配保持一致
      return { regexp: new RegExp(query, "im"), needleLower: "", isRegexp: true };
    } catch (error) {
      if (explicitRegexp === true) {
        const message = error instanceof Error ? error.message : String(error);
        return { error: `Invalid regular expression: ${message}` };
      }
      // 自动判定出的"伪正则"编译失败（如 `foo(`），退回字面量搜索更实用
    }
  }
  return { regexp: null, needleLower: query.toLowerCase(), isRegexp: false };
}

// ─── 入口 ───────────────────────────────────────────────

export async function handleSearchTool(
  args: Record<string, unknown>,
  context: ToolExecutionContext,
): Promise<ToolExecutionResult> {
  const mode = typeof args.mode === "string" ? args.mode.trim().toLowerCase() : "";
  if (mode !== "text" && mode !== "file") {
    return {
      ok: false,
      name: "search",
      error: 'mode must be either "text" or "file".',
    };
  }

  const query = typeof args.query === "string" ? args.query.trim() : "";
  if (!query) {
    return {
      ok: false,
      name: "search",
      error: 'Missing required "query" string.',
    };
  }

  const rawMax = typeof args.maxResults === "number" ? args.maxResults : DEFAULT_MAX_RESULTS;
  const maxResults = Math.max(1, Math.min(rawMax, HARD_MAX_RESULTS));

  const includePattern = typeof args.includePattern === "string" ? args.includePattern.trim() : undefined;
  const explicitRegexp = typeof args.isRegexp === "boolean" ? args.isRegexp : undefined;

  // 确定搜索根目录
  let rootPath: string;
  if (typeof args.path === "string" && args.path.trim()) {
    const p = args.path.trim();
    const normalized = process.platform === "win32" ? posixPathToWindowsPath(p) : p;
    rootPath = path.resolve(normalized);
  } else {
    rootPath = context.projectRoot;
  }

  if (!fs.existsSync(rootPath)) {
    return {
      ok: false,
      name: "search",
      error: `Path not found: ${rootPath}`,
    };
  }

  const isIgnored = loadGitignoreMatcher(rootPath) ?? (() => false);

  const matcher = resolveQueryMatcher(query, explicitRegexp);
  if ("error" in matcher) {
    return {
      ok: false,
      name: "search",
      error: matcher.error,
    };
  }

  try {
    if (mode === "text") {
      const results = await searchText(
        rootPath,
        buildContentMatcher(matcher.regexp, matcher.needleLower),
        includePattern,
        maxResults,
        isIgnored,
      );
      return {
        ok: true,
        name: "search",
        output: formatTextResults(results, query, rootPath, matcher.isRegexp, includePattern),
        metadata: { mode: "text", total: results.length, regexp: matcher.isRegexp },
      };
    } else {
      const results = await searchFiles(rootPath, query, includePattern, maxResults, isIgnored);
      return {
        ok: true,
        name: "search",
        output: formatFileResults(results, query, rootPath, includePattern),
        metadata: { mode: "file", total: results.length },
      };
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      name: "search",
      error: `SearchError: ${message}`,
    };
  }
}
