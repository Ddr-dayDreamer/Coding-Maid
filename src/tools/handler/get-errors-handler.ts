/**
 * get_errors — handler 实现
 *
 * 利用 VS Code Language Server 诊断信息获取编译/语法错误。
 * 需要 vscode 模块（extension host 提供）。
 */

import * as vscode from "vscode";
import * as path from "path";
import type { ToolExecutionContext, ToolExecutionResult } from "../types";
import { posixPathToWindowsPath } from "../../common/shell-utils";

export async function handleGetErrors(
  args: Record<string, unknown>,
  context: ToolExecutionContext,
): Promise<ToolExecutionResult> {
  const rawPaths = args.filePaths;

  // 收集要检查的 URI
  let uris: vscode.Uri[];

  if (rawPaths === undefined || rawPaths === null) {
    // 不传 → 全部文件的诊断
    uris = vscode.languages.getDiagnostics().map(([uri]) => uri);
  } else if (Array.isArray(rawPaths)) {
    if (rawPaths.length === 0) {
      // 空数组 → 全部
      uris = vscode.languages.getDiagnostics().map(([uri]) => uri);
    } else {
      // 指定文件列表
      uris = [];
      for (const p of rawPaths) {
        if (typeof p !== "string") continue;
        const normalized = process.platform === "win32" ? posixPathToWindowsPath(p) : p;
        const absPath = path.isAbsolute(normalized) ? normalized : path.resolve(context.projectRoot, normalized);
        const uri = vscode.Uri.file(absPath);
        uris.push(uri);
      }
    }
  } else if (typeof rawPaths === "string") {
    const normalized = process.platform === "win32" ? posixPathToWindowsPath(rawPaths) : rawPaths;
    const absPath = path.isAbsolute(normalized) ? normalized : path.resolve(context.projectRoot, normalized);
    uris = [vscode.Uri.file(absPath)];
  } else {
    return {
      ok: false,
      name: "get_errors",
      error: "filePaths must be an array of strings, a single string, or omitted.",
    };
  }

  // 收集诊断信息
  interface FileError {
    file: string;
    line: number;
    column: number;
    message: string;
    severity: string;
    code: string | number | undefined;
  }

  const allErrors: FileError[] = [];
  let filesWithErrors = 0;
  let filesChecked = 0;

  for (const uri of uris) {
    filesChecked++;
    const diagnostics = vscode.languages.getDiagnostics(uri);
    if (diagnostics.length === 0) continue;

    filesWithErrors++;
    const relPath = path.relative(context.projectRoot, uri.fsPath);

    for (const diag of diagnostics) {
      // 忽略提示（Information）
      if (diag.severity === vscode.DiagnosticSeverity.Information) continue;

      const severityLabel =
        diag.severity === vscode.DiagnosticSeverity.Error
          ? "error"
          : diag.severity === vscode.DiagnosticSeverity.Warning
            ? "warning"
            : "hint";

      // 提取诊断代码（兼容 string | number | { value, target }）
      let code: string | number | undefined;
      if (typeof diag.code === "string" || typeof diag.code === "number") {
        code = diag.code;
      } else if (diag.code && typeof diag.code === "object" && "value" in diag.code) {
        code = diag.code.value;
      }

      allErrors.push({
        file: relPath || uri.fsPath,
        line: diag.range.start.line + 1,
        column: diag.range.start.character + 1,
        message: diag.message,
        severity: severityLabel,
        code,
      });
    }
  }

  if (allErrors.length === 0) {
    return {
      ok: true,
      name: "get_errors",
      output: filesChecked === 1
        ? "No errors or warnings found."
        : `No errors or warnings found across ${filesChecked} file${filesChecked > 1 ? "s" : ""}.`,
      metadata: { total: 0, filesChecked, filesWithErrors: 0 },
    };
  }

  // 按文件分组输出
  const groups = new Map<string, FileError[]>();
  for (const err of allErrors) {
    if (!groups.has(err.file)) groups.set(err.file, []);
    groups.get(err.file)!.push(err);
  }

  const lines: string[] = [];
  const errorCount = allErrors.filter((e) => e.severity === "error").length;
  const warningCount = allErrors.filter((e) => e.severity === "warning").length;
  const hintCount = allErrors.filter((e) => e.severity === "hint").length;

  lines.push(`Found ${errorCount} error${errorCount !== 1 ? "s" : ""}, ${warningCount} warning${warningCount !== 1 ? "s" : ""}${hintCount > 0 ? `, ${hintCount} hint${hintCount !== 1 ? "s" : ""}` : ""} in ${filesWithErrors} file${filesWithErrors > 1 ? "s" : ""}:`);
  lines.push("");

  for (const [file, errors] of groups) {
    lines.push(`  ${file}`);
    for (const err of errors) {
      const tag = err.severity === "error" ? "✖" : err.severity === "warning" ? "⚠" : "ℹ";
      lines.push(`    ${tag} [${err.severity}] Line ${err.line}, Col ${err.column}: ${err.message}`);
    }
    lines.push("");
  }

  return {
    ok: true,
    name: "get_errors",
    output: lines.join("\n").trimEnd(),
    metadata: {
      total: allErrors.length,
      errors: errorCount,
      warnings: warningCount,
      hints: hintCount,
      filesChecked,
      filesWithErrors,
    },
  };
}
