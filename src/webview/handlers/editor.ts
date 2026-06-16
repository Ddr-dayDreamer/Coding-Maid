/**
 * 编辑器上下文捕获
 *
 * 在用户发送 prompt 前捕获当前编辑器状态，
 * 供 {{editor_selection}}、{{active_file}} 等宏使用。
 */

import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";
import { execSync } from "child_process";
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

  // ── 清除修改文件列表与编辑器装饰 ────────────────

  registerHandler("clearFileChanges", async () => {
    const sessionId = ctx.sessionManager.getActiveSessionId();
    if (sessionId) {
      ctx.sessionManager.clearFileChanges(sessionId);
    }
  });

  // ── 打开文件 Diff 视图 ─────────────────────────

  registerHandler("openFileDiff", async (message) => {
    const filePath = String(message.filePath || "").trim();
    if (!filePath) return;

    const sessionId = ctx.sessionManager.getActiveSessionId();
    if (!sessionId) return;

    const projectRoot = ctx.getWorkspaceRoot();
    if (!projectRoot) return;

    const relativePath = path.relative(projectRoot, filePath);
    if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) return;

    // 计算 file-history git 仓库路径
    const projectCode = projectRoot.replace(/[\\/]/g, "-").replace(/:/g, "");
    const fileHistoryDir = path.join(
      os.homedir(),
      ".codingmaid",
      "projects",
      projectCode,
      "file-history",
      ".git"
    );

    // 获取最后一次用户消息的 checkpointHash
    const messages = ctx.sessionManager.listSessionMessages(sessionId);
    let checkpointHash: string | undefined;
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i]?.role === "user" && messages[i]?.checkpointHash) {
        checkpointHash = messages[i].checkpointHash;
        break;
      }
    }

    if (!checkpointHash || !fs.existsSync(fileHistoryDir)) {
      // 没有 checkpoint 或 file-history 不存在，直接打开当前文件
      await ctx.openFileInEditor(filePath, 1);
      return;
    }

    try {
      // 从 git checkpoint 提取文件的旧版本
      const gitDir = `--git-dir=${fileHistoryDir}`;
      const workTree = `--work-tree=${projectRoot}`;
      const normalizedPath = relativePath.split(path.sep).join("/");
      const oldContent = execSync(
        `git ${gitDir} ${workTree} show ${checkpointHash}:${normalizedPath}`,
        { encoding: "utf8", timeout: 5000 }
      );

      // 写入临时文件
      const ext = path.extname(filePath);
      const baseName = path.basename(filePath, ext);
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "codingmaid-diff-"));
      const tmpFile = path.join(tmpDir, `${baseName}.checkpoint${ext}`);
      fs.writeFileSync(tmpFile, oldContent, "utf8");

      const leftUri = vscode.Uri.file(tmpFile);
      const rightUri = vscode.Uri.file(filePath);
      const title = `${baseName}${ext} (checkpoint → 当前)`;

      await vscode.commands.executeCommand("vscode.diff", leftUri, rightUri, title);
    } catch {
      // checkpoint 中不包含此文件或命令失败，回退到直接打开
      await ctx.openFileInEditor(filePath, 1);
    }
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
