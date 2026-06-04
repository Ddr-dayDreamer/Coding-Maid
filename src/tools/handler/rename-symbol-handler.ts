/**
 * rename_symbol — handler 实现
 *
 * 利用 VS Code Language Server 跨文件安全重命名符号。
 * 需要 vscode 模块（extension host 提供）。
 */

import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import type { ToolExecutionContext, ToolExecutionResult } from "../types";

/**
 * 解析 filePath + lineContent 找到符号的精确位置�? */
function resolveSymbolPosition(
  filePath: string,
  symbol: string,
  lineContent: string,
  projectRoot: string,
): { uri: vscode.Uri; position: vscode.Position } | { error: string } {
  const absPath = path.isAbsolute(filePath) ? filePath : path.resolve(projectRoot, filePath);
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
  const lowerLineContent = lineContent.toLowerCase();

  for (let i = 0; i < lines.length; i++) {
    if (lines[i].toLowerCase().includes(lowerLineContent)) {
      // 在匹配行中找 symbol
      const col = lines[i].indexOf(symbol, Math.max(0, lines[i].toLowerCase().indexOf(lowerLineContent)));
      if (col !== -1) {
        return { uri, position: new vscode.Position(i, col) };
      }
      // lineContent 匹配了但 symbol 不在该行，用行首
      return { uri, position: new vscode.Position(i, 0) };
    }
  }

  return { error: `lineContent "${lineContent}" not found in ${normalized}` };
}

export async function handleRenameSymbol(
  args: Record<string, unknown>,
  context: ToolExecutionContext,
): Promise<ToolExecutionResult> {
  const symbol = typeof args.symbol === "string" ? args.symbol.trim() : "";
  if (!symbol) {
    return { ok: false, name: "rename_symbol", error: 'Missing required "symbol".' };
  }

  const newName = typeof args.newName === "string" ? args.newName.trim() : "";
  if (!newName) {
    return { ok: false, name: "rename_symbol", error: 'Missing required "newName".' };
  }

  if (symbol === newName) {
    return {
      ok: false,
      name: "rename_symbol",
      error: "newName must be different from symbol.",
    };
  }

  const filePath = typeof args.filePath === "string" ? args.filePath.trim() : "";
  if (!filePath) {
    return { ok: false, name: "rename_symbol", error: 'Missing required "filePath".' };
  }

  const lineContent = typeof args.lineContent === "string" ? args.lineContent.trim() : "";
  if (!lineContent) {
    return { ok: false, name: "rename_symbol", error: 'Missing required "lineContent".' };
  }

  // 解析符号位置
  const resolved = resolveSymbolPosition(filePath, symbol, lineContent, context.projectRoot);
  if ("error" in resolved) {
    return { ok: false, name: "rename_symbol", error: resolved.error };
  }

  try {
    // 调用 VS Code LSP 获取重命名编辑
    const edit = await vscode.commands.executeCommand<vscode.WorkspaceEdit | null>(
      "vscode.executeDocumentRename",
      resolved.uri,
      resolved.position,
      newName,
    );

    if (!edit) {
      return {
        ok: false,
        name: "rename_symbol",
        error: `Language Server could not rename "${symbol}". The symbol may not support renaming.`,
      };
    }

    // 统计受影响的文件
    const changes = edit.entries();
    const affectedFiles = changes.length;
    const totalEdits = changes.reduce((sum, [, textEdits]) => sum + textEdits.length, 0);

    // 应用编辑
    const applied = await vscode.workspace.applyEdit(edit);

    if (!applied) {
      return {
        ok: false,
        name: "rename_symbol",
        error: "Rename edit was rejected by VS Code. The file may have been modified externally.",
      };
    }

    // 格式化输出
    const lines: string[] = [];
    lines.push(`Renamed "${symbol}" → "${newName}" across ${affectedFiles} file${affectedFiles > 1 ? "s" : ""}:`);
    lines.push("");

    for (const [uri, textEdits] of changes) {
      const relPath = path.relative(context.projectRoot, uri.fsPath);
      lines.push(`  ${relPath} (${textEdits.length} change${textEdits.length > 1 ? "s" : ""})`);
    }

    lines.push("");
    lines.push(`Total: ${totalEdits} edit${totalEdits > 1 ? "s" : ""} in ${affectedFiles} file${affectedFiles > 1 ? "s" : ""}`);

    return {
      ok: true,
      name: "rename_symbol",
      output: lines.join("\n"),
      metadata: { symbol, newName, affectedFiles, totalEdits },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      name: "rename_symbol",
      error: `LSP Error: ${message}`,
    };
  }
}
