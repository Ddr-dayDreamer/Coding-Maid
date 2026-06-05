/**
 * 编辑器上下文捕获
 *
 * 在用户发送 prompt 前捕获当前编辑器状态，
 * 供 {{editor_selection}}、{{active_file}} 等宏使用。
 */

import * as vscode from "vscode";
import type { HandlerContext } from "../handler-context";

export function registerEditorHandlers(
  ctx: HandlerContext,
  _registerHandler: (type: string, handler: (msg: Record<string, unknown>) => Promise<void>) => void,
): void {
  // editor 模块不需要注册消息处理器，而是通过 captureEditorSelection / captureActiveFile
  // 在 prompt 发送前由 provider 直接调用。
  // 这里仅作占位，保持模块一致性。
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
