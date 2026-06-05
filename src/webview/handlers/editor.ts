/**
 * 编辑器上下文捕获
 *
 * 在用户发送 prompt 前捕获当前编辑器状态，
 * 供 {{editor_selection}}、{{active_file}} 等宏使用。
 */

import * as vscode from "vscode";
import * as path from "path";
import type { HandlerContext } from "../handler-context";

// 单条代码段上限 50KB
const SNIPPET_MAX_BYTES = 50 * 1024;

export function registerEditorHandlers(
  ctx: HandlerContext,
  registerHandler: (type: string, handler: (msg: Record<string, unknown>) => Promise<void>) => void,
): void {
  // ── 捕获编辑器选中内容并附加为代码段 ───────────

  registerHandler("captureSelectionSnippet", async (message) => {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.selection.isEmpty) {
      ctx.respond(message.requestId as string, false, undefined, "No active selection");
      return;
    }

    const document = editor.document;
    const selection = editor.selection;
    const text = document.getText(selection);
    if (!text) {
      ctx.respond(message.requestId as string, false, undefined, "Empty selection");
      return;
    }

    // 单条上限 50KB，防止内存溢出
    if (text.length > SNIPPET_MAX_BYTES) {
      ctx.respond(message.requestId as string, false, undefined, `Selection too large (${(text.length / 1024).toFixed(0)}KB, max 50KB)`);
      return;
    }

    // 生成虚拟路径标识（不写磁盘）
    const sourceFileName = path.basename(document.uri.fsPath, path.extname(document.uri.fsPath));
    const lineRange =
      selection.start.line === selection.end.line
        ? `L${selection.start.line + 1}`
        : `L${selection.start.line + 1}-${selection.end.line + 1}`;
    const key = `${sourceFileName} ${lineRange}`;

    const header = `> 来自 ${document.uri.fsPath}:${selection.start.line + 1}-${selection.end.line + 1}\n\n`;
    ctx.sessionManager.setAttachedSnippet(key, header + text);

    // 追加到 attachedFiles
    const current = ctx.sessionManager.getAttachedFiles();
    ctx.sessionManager.setAttachedFiles([...current, key]);

    ctx.respond(message.requestId as string, true, {
      filePath: key,
      fileName: key,
      isSnippet: true,
    });
  });
}

/** 捕获选中位置，无选中时返回 undefined */
export function captureEditorSelection(): { filePath: string; startLine: number; endLine: number } | undefined {
  const editor = vscode.window.activeTextEditor;
  if (!editor || editor.selection.isEmpty) return undefined;
  const document = editor.document;
  const selection = editor.selection;
  return {
    filePath: document.uri.fsPath,
    startLine: selection.start.line + 1,
    endLine: selection.end.line + 1,
  };
}

/** 捕获当前活动文件路径，无活动编辑器时返回 undefined */
export function captureActiveFile(): string | undefined {
  const editor = vscode.window.activeTextEditor;
  if (!editor) return undefined;
  return editor.document.uri.fsPath;
}

/** 检查当前编辑器是否有选中内容 */
export function hasEditorSelection(): boolean {
  const editor = vscode.window.activeTextEditor;
  return !!editor && !editor.selection.isEmpty;
}
