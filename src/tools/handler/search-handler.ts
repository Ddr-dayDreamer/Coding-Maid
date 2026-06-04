/**
 * search — handler 实现
 *
 * 两种模式：
 *   text — 文件内容搜索（grep-like）
 *   file — 文件路径搜索（glob-like）
 *
 * 使用 Node.js 原生 fs，无需外部依赖。
 * 自动过滤 .gitignore 和二进制文件。
 */

import * as fs from "fs";
import * as path from "path";
import ignore from "ignore";
import type { ToolExecutionContext, ToolExecutionResult } from "../types";

// ─── 常量 ───────────────────────────────────────────────

const DEFAULT_MAX_RESULTS = 50;
const HARD_MAX_RESULTS = 200;
const MAX_FILE_SIZE_BYTES = 1 * 1024 * 1024; // 跳过 >1MB 的文件

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

/** 检查路径是否匹配 glob 模式 */
function matchGlob(filePath: string, pattern: string): boolean {
  // 纯字符串包含查询
  if (!pattern.includes("*") && !pattern.includes("?") && !pattern.includes("{")) {
    return filePath.toLowerCase().includes(pattern.toLowerCase());
  }

  const re = globToRegex(pattern);
  return re.test(filePath);
}

// ─── 二进制文件检测 ─────────────────────────────────────

function isBinaryExt(filePath: string): boolean {
  return BINARY_EXTS.has(path.extname(filePath).toLowerCase());
}

// ─── Text 模式 ──────────────────────────────────────────

interface TextMatch {
  file: string;
  line: number;
  content: string;
}

function searchText(
  rootPath: string,
  query: string,
  isRegexp: boolean,
  includePattern: string | undefined,
  maxResults: number,
  isIgnored: (relPath: string, isDir: boolean) => boolean,
): TextMatch[] {
  const results: TextMatch[] = [];
  const regex = isRegexp ? new RegExp(query, "i") : null;
  const searchStr = isRegexp ? null : query.toLowerCase();

  function walk(dir: string, relPath: string): void {
    if (results.length >= maxResults) return;

    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (results.length >= maxResults) break;

      const relEntry = relPath ? `${relPath}/${entry.name}` : entry.name;
      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        if (!isIgnored(relEntry, true)) {
          walk(fullPath, relEntry);
        }
      } else if (entry.isFile()) {
        if (isIgnored(relEntry, false)) continue;
        if (isBinaryExt(fullPath)) continue;
        if (includePattern && !matchGlob(relEntry, includePattern)) continue;

        // 跳过过大文件
        let stat: fs.Stats;
        try {
          stat = fs.statSync(fullPath);
        } catch {
          continue;
        }
        if (stat.size > MAX_FILE_SIZE_BYTES) continue;

        // 读取文件并搜索
        let content: string;
        try {
          content = fs.readFileSync(fullPath, "utf8");
        } catch {
          continue; // 二进制或无法读取
        }

        const lines = content.split("\n");
        for (let i = 0; i < lines.length; i++) {
          if (results.length >= maxResults) break;

          const line = lines[i];
          const matched = isRegexp ? regex!.test(line) : line.toLowerCase().includes(searchStr!);

          if (matched) {
            results.push({
              file: relEntry,
              line: i + 1,
              content: line.replace(/\t/g, " ").substring(0, 200).trimEnd(),
            });
          }
        }
      }
    }
  }

  walk(rootPath, "");
  return results;
}

// ─── File 模式 ──────────────────────────────────────────

function searchFiles(
  rootPath: string,
  query: string,
  includePattern: string | undefined,
  maxResults: number,
  isIgnored: (relPath: string, isDir: boolean) => boolean,
): string[] {
  const results: string[] = [];

  function walk(dir: string, relPath: string): void {
    if (results.length >= maxResults) return;

    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (results.length >= maxResults) break;

      const relEntry = relPath ? `${relPath}/${entry.name}` : entry.name;
      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        if (!isIgnored(relEntry, true)) {
          walk(fullPath, relEntry);
        }
      } else if (entry.isFile()) {
        if (isIgnored(relEntry, false)) continue;
        if (includePattern && !matchGlob(relEntry, includePattern)) continue;

        if (matchGlob(relEntry, query)) {
          results.push(relEntry);
        }
      }
    }
  }

  walk(rootPath, "");
  return results;
}

// ─── 格式化输出 ─────────────────────────────────────────

function formatTextResults(results: TextMatch[], query: string): string {
  if (results.length === 0) {
    return `No results found for "${query}".`;
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

function formatFileResults(results: string[], query: string): string {
  if (results.length === 0) {
    return `No files found matching "${query}".`;
  }

  return results.join("\n") + `\n\n(${results.length} file${results.length > 1 ? "s" : ""})`;
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
  const isRegexp = args.isRegexp === true;

  // 确定搜索根目录
  let rootPath: string;
  if (typeof args.path === "string" && args.path.trim()) {
    rootPath = path.resolve(args.path.trim());
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

  try {
    if (mode === "text") {
      const results = searchText(rootPath, query, isRegexp, includePattern, maxResults, isIgnored);
      return {
        ok: true,
        name: "search",
        output: formatTextResults(results, query),
        metadata: { mode: "text", total: results.length },
      };
    } else {
      const results = searchFiles(rootPath, query, includePattern, maxResults, isIgnored);
      return {
        ok: true,
        name: "search",
        output: formatFileResults(results, query),
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
