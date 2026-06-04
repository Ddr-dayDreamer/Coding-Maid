/**
 * find_references �?handler 实现
 *
 * 利用 VS Code Language Server 查找符号的引�?定义/实现�? * 需�?vscode 模块（extension host 提供）�? */

import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import type { ToolExecutionContext, ToolExecutionResult } from "../types";
import { posixPathToWindowsPath } from "../../common/shell-utils";

/**
 * 解析 filePath + lineContent 找到符号的精确位置。 */
function resolveSymbolPosition(
  filePath: string,
  symbol: string,
  lineContent: string | undefined,
  projectRoot: string,
): { uri: vscode.Uri; position: vscode.Position } | { error: string } {
  // 在 Windows 上归一化 Git Bash 风格路径
  const normalizedPath = process.platform === "win32" ? posixPathToWindowsPath(filePath) : filePath;
  // 解析为绝对路径
  const absPath = path.isAbsolute(normalizedPath) ? normalizedPath : path.resolve(projectRoot, normalizedPath);
  const normalized = path.resolve(absPath);

  if (!fs.existsSync(normalized)) {
    return { error: `File not found: ${normalized}` };
  }

  const uri = vscode.Uri.file(normalized);
  let content: string;
  try {
    content = fs.readFileSync(normalized, "utf8");
  } catch {
    return { error: `Failed to read file: ${normalized}` };
  }

  const lines = content.split("\n");

  // 如果�?lineContent，用它定位行
  if (lineContent) {
    const lowerLineContent = lineContent.toLowerCase();
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].toLowerCase().includes(lowerLineContent)) {
        // 在该行中�?symbol 的列位置
        const col = lines[i].indexOf(symbol, lines[i].toLowerCase().indexOf(lowerLineContent));
        if (col !== -1) {
          return { uri, position: new vscode.Position(i, col) };
        }
        // lineContent 匹配了但 symbol 不在该行? 用行�?        return { uri, position: new vscode.Position(i, 0) };
      }
    }
    return { error: `lineContent "${lineContent}" not found in ${normalized}` };
  }

  // 没有 lineContent，在整个文件中搜�?symbol
  for (let i = 0; i < lines.length; i++) {
    const col = lines[i].indexOf(symbol);
    if (col !== -1) {
      return { uri, position: new vscode.Position(i, col) };
    }
  }

  return { error: `Symbol "${symbol}" not found in ${normalized}` };
}

export async function handleFindReferences(
  args: Record<string, unknown>,
  context: ToolExecutionContext,
): Promise<ToolExecutionResult> {
  const symbol = typeof args.symbol === "string" ? args.symbol.trim() : "";
  if (!symbol) {
    return { ok: false, name: "find_references", error: 'Missing required "symbol".' };
  }

  const filePath = typeof args.filePath === "string" ? args.filePath.trim() : "";
  if (!filePath) {
    return { ok: false, name: "find_references", error: 'Missing required "filePath".' };
  }

  const lineContent = typeof args.lineContent === "string" ? args.lineContent.trim() : undefined;
  if (!lineContent) {
    return { ok: false, name: "find_references", error: 'Missing required "lineContent".' };
  }

  // 解析符号位置
  const resolved = resolveSymbolPosition(filePath, symbol, lineContent, context.projectRoot);
  if ("error" in resolved) {
    return { ok: false, name: "find_references", error: resolved.error };
  }

  try {
    // 调用 VS Code LSP 查找引用
    const locations = await vscode.commands.executeCommand<vscode.Location[]>(
      "vscode.executeReferenceProvider",
      resolved.uri,
      resolved.position,
    );

    if (!locations || locations.length === 0) {
      return {
        ok: true,
        name: "find_references",
        output: `No references found for "${symbol}".`,
        metadata: { symbol, total: 0 },
      };
    }

    // 按文件分组格式化输出
    const groups = new Map<string, { line: number; column: number }[]>();
    for (const loc of locations) {
      const file = loc.uri.fsPath;
      const line = loc.range.start.line + 1; // 1-based for display
      const column = loc.range.start.character + 1;
      if (!groups.has(file)) groups.set(file, []);
      groups.get(file)!.push({ line, column });
    }

    const lines: string[] = [];
    lines.push(`Found ${locations.length} reference${locations.length > 1 ? "s" : ""} for "${symbol}":`);
    lines.push("");

    for (const [file, refs] of groups) {
      const relPath = path.relative(context.projectRoot, file);
      lines.push(`  ${relPath}`);
      for (const ref of refs) {
        lines.push(`    Line ${ref.line}, Column ${ref.column}`);
      }
      lines.push("");
    }

    return {
      ok: true,
      name: "find_references",
      output: lines.join("\n").trimEnd(),
      metadata: { symbol, total: locations.length, files: groups.size },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      name: "find_references",
      error: `LSP Error: ${message}`,
    };
  }
}
