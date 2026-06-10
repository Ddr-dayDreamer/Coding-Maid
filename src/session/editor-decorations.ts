/**
 * EditorDecorationManager — 编辑器编辑高亮装饰
 *
 * 在 Edit 工具成功执行后，在编辑器中标记变更行：
 * - 纯新增 → 绿色背景
 * - 有删除 → 绿色背景 + 红色左边框 + gutter 红短线 + overview ruler 红线
 *
 * 多次编辑同一文件时，装饰累积（不会覆盖之前的）。
 * 用户发送新消息时自动清除所有高亮。
 * 自动监听编辑器切换事件，切换回来时重新挂上装饰。
 */

import * as vscode from "vscode";

const INSERTED_BG = new vscode.ThemeColor("diffEditor.insertedTextBackground");

type FileDecoration = {
  bg: vscode.TextEditorDecorationType;
  /** 绿色背景覆盖的所有变更行范围 */
  bgRanges: vscode.Range[];
  /** 红色删除标记 */
  border: vscode.TextEditorDecorationType;
  /** 红色删除标记覆盖的行范围 */
  borderRanges: vscode.Range[];
};

export class EditorDecorationManager {
  private decorations = new Map<string, FileDecoration>();

  private listenerDisposable: vscode.Disposable | null = null;

  constructor() {
    this.listenerDisposable = vscode.window.onDidChangeActiveTextEditor((editor) => {
      if (!editor) return;
      const entry = this.decorations.get(editor.document.uri.fsPath);
      if (entry) this.applyToEditor(editor, entry);
    });
  }

  clearAll(): void {
    for (const { bg, border } of this.decorations.values()) {
      bg.dispose();
      border.dispose();
    }
    this.decorations.clear();
  }

  /** 标记变更区域（累积式，不覆盖之前）。 */
  applyEditDecoration(filePath: string, diffPreview: string): void {
    const parsed = this.parseDiffHunk(diffPreview);
    if (!parsed) return;
    const { range, removedLines } = parsed;

    let entry = this.decorations.get(filePath);

    if (!entry) {
      // 首次编辑该文件 → 创建装饰类型
      const bg = vscode.window.createTextEditorDecorationType({
        backgroundColor: INSERTED_BG,
        isWholeLine: true,
      });
      const border = vscode.window.createTextEditorDecorationType({
        isWholeLine: false,
        border: "3px solid rgba(231, 76, 60, 0.6)",
        borderColor: "rgba(231, 76, 60, 0.6)",
        overviewRulerLane: vscode.OverviewRulerLane.Left,
        overviewRulerColor: new vscode.ThemeColor("diffEditor.removedTextBackground"),
        gutterIconPath: vscode.Uri.parse(
          "data:image/svg+xml," +
            encodeURIComponent(
              '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16">' +
                '<rect x="3" y="7" width="10" height="2" fill="#e74c3c"/></svg>',
            ),
        ),
      });
      entry = { bg, bgRanges: [], border, borderRanges: [] };
      this.decorations.set(filePath, entry);
    }

    // 累积绿色背景范围（所有变更都有）
    entry.bgRanges.push(range);
    // 累积红色删除标记范围（仅在本次有删除时才加）
    if (removedLines > 0) {
      entry.borderRanges.push(range);
    }

    // 应用到所有可见编辑器
    for (const editor of vscode.window.visibleTextEditors) {
      if (editor.document.uri.fsPath === filePath) this.applyToEditor(editor, entry);
    }
  }

  dispose(): void {
    this.clearAll();
    this.listenerDisposable?.dispose();
    this.listenerDisposable = null;
  }

  // ── 私有 ──

  private applyToEditor(editor: vscode.TextEditor, entry: FileDecoration): void {
    editor.setDecorations(entry.bg, entry.bgRanges);
    editor.setDecorations(entry.border, entry.borderRanges);
  }

  /** 从 unified diff @@ 头解析行范围和是否有删除。 */
  private parseDiffHunk(
    diff: string,
  ): { range: vscode.Range; removedLines: number } | null {
    const match = diff.match(
      /^@@\s+-(\d+)(?:,(\d+))?\s+\+(\d+)(?:,(\d+))?\s+@@/m,
    );
    if (!match) return null;

    const newStart = parseInt(match[3], 10);
    const newCount = match[4] ? parseInt(match[4], 10) : 1;
    const oldCount = match[2] ? parseInt(match[2], 10) : 1;

    return {
      range: new vscode.Range(
        new vscode.Position(newStart - 1, 0),
        new vscode.Position(newStart + newCount - 1, 0),
      ),
      removedLines: oldCount,
    };
  }
}
