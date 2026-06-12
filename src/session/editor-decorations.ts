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
    const hunks = this.parseDiffHunks(diffPreview);
    if (hunks.length === 0) return;

    let entry = this.decorations.get(filePath);

    if (!entry) {
      // 首次编辑该文件 → 创建装饰类型
      const bg = vscode.window.createTextEditorDecorationType({
        backgroundColor: INSERTED_BG,
        isWholeLine: true,
      });
      const border = vscode.window.createTextEditorDecorationType({
        isWholeLine: true,
        border: "3px solid rgba(231, 76, 60, 0.6)",
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

    for (const hunk of hunks) {
      // 即使 newCount === 0，也生成一个单行范围以便标记删除
      const endLine = Math.max(hunk.newStart, hunk.newStart + hunk.newCount - 1);
      const range = new vscode.Range(
        new vscode.Position(hunk.newStart - 1, 0),
        new vscode.Position(endLine, 0),
      );
      entry.bgRanges.push(range);
      if (hunk.removedLines > 0) {
        entry.borderRanges.push(range);
      }
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

  /** 解析所有 diff hunk，返回每个 hunk 的行范围信息和实际删除行数。 */
  private parseDiffHunks(
    diff: string,
  ): { newStart: number; newCount: number; removedLines: number }[] {
    const results: { newStart: number; newCount: number; removedLines: number }[] = [];
    const hunkHeaderRegex = /^@@\s+-(\d+)(?:,(\d+))?\s+\+(\d+)(?:,(\d+))?\s+@@/gm;
    const headers: { match: RegExpExecArray; index: number }[] = [];
    let match: RegExpExecArray | null;

    while ((match = hunkHeaderRegex.exec(diff)) !== null) {
      headers.push({ match, index: match.index });
    }

    for (let i = 0; i < headers.length; i++) {
      const { match: m } = headers[i];
      const newStart = parseInt(m[3], 10);
      const newCount = m[4] ? parseInt(m[4], 10) : 1;
      const oldCount = m[2] ? parseInt(m[2], 10) : 1;

      if (newCount === 0 && oldCount === 0) continue;

      // hunk body 范围：从当前 @@ 到下一个 @@（或文件尾）
      const hunkStart = m.index;
      const hunkEnd = i + 1 < headers.length ? headers[i + 1].index : diff.length;
      const hunkBody = diff.slice(hunkStart, hunkEnd);
      const removedLines = hunkBody
        .split("\n")
        .filter((line) => line.startsWith("-") && !line.startsWith("---")).length;

      results.push({ newStart, newCount, removedLines });
    }

    return results;
  }
}
