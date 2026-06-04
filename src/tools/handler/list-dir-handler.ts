/**
 * list_dir — handler 实现
 *
 * 列出目录内容，文件/目录分开展示，目录名带 "/" 后缀。
 */

import * as fs from "fs";
import * as path from "path";
import type { ToolExecutionContext, ToolExecutionResult } from "../types";

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

  // 解析为绝对路径（相对于 projectRoot 如果传入的是相对路径）
  const dirPath = path.isAbsolute(rawPath) ? rawPath : path.resolve(context.projectRoot, rawPath);

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

  lines.push(`Total: ${dirs.length} director${dirs.length === 1 ? "y" : "ies"}, ${files.length} file${files.length === 1 ? "" : "s"}`);

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
