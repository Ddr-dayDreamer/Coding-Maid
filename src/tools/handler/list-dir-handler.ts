/**
 * list_dir — handler 实现
 *
 * 列出目录内容，文件/目录分开展示，目录名带 "/" 后缀。
 * 支持 recursive 模式：以树形结构递归展示子目录。
 */

import * as fs from "fs";
import * as path from "path";
import type { ToolExecutionContext, ToolExecutionResult } from "../types";
import { posixPathToWindowsPath } from "../../utils/shell-utils";

// ─── 递归目录扫描 ─────────────────────────────────────

type DirEntry = {
  name: string;
  isDir: boolean;
  children: DirEntry[];
};

/**
 * 递归扫描目录（不跟随符号链接），返回树结构。
 */
function scanTree(dirPath: string, maxDepth: number, depth: number): DirEntry[] {
  if (maxDepth >= 0 && depth > maxDepth) return [];

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dirPath, { withFileTypes: true });
  } catch {
    return []; // 权限不足等无法读取的目录，直接跳过
  }

  // 排序：目录优先，再按名称排序
  entries.sort((a, b) => {
    if (a.isDirectory() !== b.isDirectory()) {
      return a.isDirectory() ? -1 : 1;
    }
    return a.name.localeCompare(b.name);
  });

  const result: DirEntry[] = [];

  for (const entry of entries) {
    // 跳过符号链接（防止死循环）
    if (entry.isSymbolicLink()) continue;

    if (entry.isDirectory()) {
      const subDir = path.join(dirPath, entry.name);
      const children = scanTree(subDir, maxDepth, depth + 1);
      result.push({ name: entry.name, isDir: true, children });
    } else if (entry.isFile()) {
      result.push({ name: entry.name, isDir: false, children: [] });
    }
    // 忽略其他类型
  }

  return result;
}

/**
 * 将树结构渲染为带缩进的文本。
 */
function renderTree(
  entries: DirEntry[],
  prefix: string,
  isRoot: boolean,
  lines: string[],
): { dirs: number; files: number } {
  let dirCount = 0;
  let fileCount = 0;

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    const isLast = i === entries.length - 1;
    const connector = isLast ? "└── " : "├── ";
    const childPrefix = isLast ? "    " : "│   ";

    if (entry.isDir) {
      dirCount++;
      lines.push(`${prefix}${connector}${entry.name}/`);
      const childResult = renderTree(
        entry.children,
        prefix + childPrefix,
        false,
        lines,
      );
      dirCount += childResult.dirs;
      fileCount += childResult.files;
    } else {
      fileCount++;
      lines.push(`${prefix}${connector}${entry.name}`);
    }
  }

  return { dirs: dirCount, files: fileCount };
}

// ─── 平面列表模式 ──────────────────────────────────────

function renderFlat(entries: fs.Dirent[]): {
  dirs: string[];
  files: string[];
} {
  const dirs: string[] = [];
  const files: string[] = [];

  for (const entry of entries) {
    if (entry.isDirectory()) {
      dirs.push(`${entry.name}/`);
    } else if (entry.isFile()) {
      files.push(entry.name);
    }
    // 忽略符号链接和其他类型
  }

  return { dirs, files };
}

// ─── 主入口 ────────────────────────────────────────────

export async function handleListDirTool(
  args: Record<string, unknown>,
  context: ToolExecutionContext,
): Promise<ToolExecutionResult> {
  const rawPath = typeof args.path === "string" ? args.path.trim() : "";
  if (!rawPath) {
    return {
      ok: false,
      name: "list_dir",
      error: 'Missing required "path" string.',
    };
  }

  const recursive = args.recursive !== false;
  const rawMaxDepth = typeof args.maxDepth === "number" ? args.maxDepth : undefined;
  const maxDepth = rawMaxDepth ?? (recursive ? 5 : 0);

  // 在 Windows 上，将 Git Bash / MSYS2 风格路径（如 /f/extra/test）转为盘符格式（F:\extra\test）
  const normalized =
    process.platform === "win32" ? posixPathToWindowsPath(rawPath) : rawPath;
  // 解析为绝对路径（相对于 projectRoot 如果传入的是相对路径）
  const dirPath = path.isAbsolute(normalized)
    ? normalized
    : path.resolve(context.projectRoot, normalized);

  if (!fs.existsSync(dirPath)) {
    return {
      ok: false,
      name: "list_dir",
      error: `Directory not found: ${dirPath}`,
    };
  }

  const stat = fs.statSync(dirPath);
  if (!stat.isDirectory()) {
    return {
      ok: false,
      name: "list_dir",
      error: `Not a directory: ${dirPath}`,
    };
  }

  // ── Recursive tree mode ────────────────────────────
  if (recursive) {
    const tree = scanTree(dirPath, maxDepth, 0);

    const lines: string[] = [];
    lines.push(`📁 ${path.basename(dirPath) || dirPath}/`);
    lines.push("");

    if (tree.length === 0) {
      lines.push("  (empty)");
      lines.push("");
    } else {
      const total = renderTree(tree, "", true, lines);
      lines.push("");

      const depthNote =
        maxDepth >= 0
          ? ` (max depth: ${maxDepth})`
          : " (unlimited depth)";
      lines.push(
        `Total: ${total.dirs} director${total.dirs === 1 ? "y" : "ies"}, ${total.files} file${total.files === 1 ? "" : "s"}${depthNote}`,
      );

      if (tree.length > 0 && maxDepth >= 0) {
        // 检查是否有被 maxDepth 截断的目录
        let truncated = 0;
        function countTruncated(entries: DirEntry[], depth: number) {
          for (const e of entries) {
            if (e.isDir && depth >= maxDepth && e.children.length > 0) {
              truncated++;
            }
            countTruncated(e.children, depth + 1);
          }
        }
        countTruncated(tree, 0);
        if (truncated > 0) {
          lines.push(
            `⚠️  ${truncated} director${truncated === 1 ? "y" : "ies"} truncated at max depth. Increase maxDepth or set to -1 for full listing.`,
          );
        }
      }
    }

    return {
      ok: true,
      name: "list_dir",
      output: lines.join("\n"),
      metadata: {
        path: dirPath,
        recursive: true,
        maxDepth,
      },
    };
  }

  // ── Flat list mode (original behavior) ─────────────
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dirPath, { withFileTypes: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      name: "list_dir",
      error: `Failed to read directory: ${message}`,
    };
  }

  // 按 name 排序，目录优先
  entries.sort((a, b) => {
    if (a.isDirectory() !== b.isDirectory()) {
      return a.isDirectory() ? -1 : 1;
    }
    return a.name.localeCompare(b.name);
  });

  const { dirs, files } = renderFlat(entries);

  const lines: string[] = [];
  lines.push(`📁 ${path.basename(dirPath) || dirPath}`);
  lines.push("");

  if (dirs.length > 0) {
    lines.push("Directories:");
    for (const d of dirs) {
      lines.push(`  ${d}`);
    }
    lines.push("");
  }

  if (files.length > 0) {
    lines.push("Files:");
    for (const f of files) {
      lines.push(`  ${f}`);
    }
    lines.push("");
  }

  if (dirs.length === 0 && files.length === 0) {
    lines.push("  (empty)");
    lines.push("");
  }

  lines.push(
    `Total: ${dirs.length} director${dirs.length === 1 ? "y" : "ies"}, ${files.length} file${files.length === 1 ? "" : "s"}`,
  );

  return {
    ok: true,
    name: "list_dir",
    output: lines.join("\n"),
    metadata: {
      path: dirPath,
      directories: dirs.length,
      files: files.length,
    },
  };
}
