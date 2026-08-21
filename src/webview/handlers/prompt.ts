/**
 * 提示词发送处理器
 *
 * 处理 userPrompt、interrupt、attachFiles 等。
 * 发送后自动清除附加文件。
 */

import * as path from "path";
import type { HandlerContext } from "../handler-context";
import type { UserPromptContent, UserPromptFilePart } from "../../session/types";
import { isImageExtension, readFileContent, readImageAsDataUrl } from "../../utils/file-utils";
import { captureEditorSelection, captureActiveFile } from "./editor";

export function registerPromptHandlers(
  ctx: HandlerContext,
  registerHandler: (type: string, handler: (msg: Record<string, unknown>) => Promise<void>) => void,
): void {
  registerHandler("userPrompt", async (message) => {
    const prompt = String(message.prompt || "").trim();
    if (!prompt) return;
    // 立即清除前端展示，让用户知道附加文件已被消费
    ctx.sendMessage({ type: "attachedFilesCleared" });
    await handlePrompt(ctx, prompt);
    // 发送后自动清除附加文件数据（代码段内存内容等）
    ctx.sessionManager.clearAllAttachments();
  });

  registerHandler("interrupt", async () => {
    ctx.sessionManager.interruptActiveSession();
  });

  // ─── 附加文件（追加模式） ─────────────────────────

  registerHandler("attachFiles", async (message) => {
    const filePaths = message.filePaths;
    if (Array.isArray(filePaths) && filePaths.length > 0) {
      const current = ctx.sessionManager.getAttachedFiles();
      const newPaths = filePaths
        .map(String)
        .filter((p) => !current.includes(p));
      ctx.sessionManager.setAttachedFiles([...current, ...newPaths]);
    }
  });

  // ─── 移除单个附加文件 ──────────────────────────────

  registerHandler("removeAttachedFile", async (message) => {
    const filePath = String(message.filePath || "");
    if (filePath) {
      ctx.sessionManager.removeAttachedFile(filePath);
    }
  });

  // ─── 清空所有附加文件（含代码段内存内容） ───────────

  registerHandler("clearAttachedFiles", async () => {
    ctx.sessionManager.clearAllAttachments();
  });

  // ─── 附加文件内容（webview 拿不到路径时，主进程写临时文件） ──

  registerHandler("attachFileContents", async (message) => {
    const files = Array.isArray(message.files) ? message.files : [];
    const filePaths: string[] = [];
    for (const raw of files) {
      const f = raw as { name?: unknown; data?: unknown; mime?: unknown };
      const name = typeof f.name === "string" && f.name ? f.name : "dropped-file";
      const mime = typeof f.mime === "string" ? f.mime : "";
      const uint8 = toUint8Array(f.data);
      if (!uint8) continue;
      // 存入内存映射（不写磁盘），返回虚拟路径
      const key = ctx.sessionManager.attachDndContent(name, mime, uint8);
      if (key) filePaths.push(key);
    }
    ctx.respond(message.requestId as string, true, { filePaths });
  });
}

// ─── 拖放内容工具 ────────────────────────────────────────

/**
 * 把 webview postMessage 传来的二进制数据归一化为 Uint8Array。
 * 传输后可能保留 Uint8Array，也可能变成 ArrayBuffer 或普通数字数组。
 */
function toUint8Array(data: unknown): Uint8Array | null {
  if (data instanceof Uint8Array) return data;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (ArrayBuffer.isView(data)) {
    return new Uint8Array((data as ArrayBufferView).buffer);
  }
  if (Array.isArray(data) && data.every((v) => typeof v === "number")) {
    return Uint8Array.from(data as number[]);
  }
  return null;
}

async function handlePrompt(ctx: HandlerContext, prompt: string): Promise<void> {
  await handlePromptWithImages(ctx, prompt, []);
}

/**
 * 将附加文件组装为用户消息的 content parts。
 * - 代码段（snippetContents）→ text part
 * - 拖入文件内容（dndContents，内存）→ text part 或 image_url part
 * - 磁盘图像文件 → image_url part（base64 data URL）
 * - 其他磁盘文本文件 → text part（带行数截断）
 */
function buildFileParts(
  attachedFiles: string[],
  snippetContents: Record<string, string>,
  dndContents: Record<string, { data: Uint8Array; mime: string }>
): UserPromptFilePart[] {
  const parts: UserPromptFilePart[] = [];
  for (const filePath of attachedFiles) {
    // 优先使用内存中的代码段内容
    const snippet = snippetContents[filePath];
    if (snippet !== undefined) {
      parts.push({ type: "text", path: filePath, content: snippet });
      continue;
    }

    // 拖入文件内容（内存，虚拟路径 dnd://...）
    const dnd = dndContents[filePath];
    if (dnd) {
      const mime = dnd.mime || "";
      const isImage = mime.startsWith("image/") || isImageExtension(path.extname(filePath).toLowerCase());
      if (isImage) {
        const dataUrl = `data:${mime || "application/octet-stream"};base64,${Buffer.from(dnd.data).toString("base64")}`;
        parts.push({ type: "image", path: filePath, dataUrl });
      } else {
        const text = Buffer.from(dnd.data).toString("utf8").replace(/^\uFEFF/, "");
        if (text) parts.push({ type: "text", path: filePath, content: text });
      }
      continue;
    }

    // 磁盘文件
    const ext = path.extname(filePath).toLowerCase();
    if (isImageExtension(ext)) {
      const dataUrl = readImageAsDataUrl(filePath);
      if (dataUrl) parts.push({ type: "image", path: filePath, dataUrl });
      continue;
    }
    // 文本文件：读取并截断
    try {
      const result = readFileContent({ filePath });
      if (!result.content) continue;
      const location = result.truncated
        ? `${filePath} (${result.totalLines} lines, ${result.omittedLines} omitted)`
        : `${filePath} (${result.totalLines} lines)`;
      parts.push({ type: "text", path: location, content: result.content });
    } catch {
      // 读取失败的文件静默跳过
      continue;
    }
  }
  return parts;
}

async function handlePromptWithImages(ctx: HandlerContext, prompt: string, imageUrls: string[]): Promise<void> {
  // 捕获编辑器状态，供宏使用
  ctx.sessionManager.setEditorSelection(captureEditorSelection());
  ctx.sessionManager.setActiveFile(captureActiveFile());

  // 组装附加文件 parts（代码段 → text，图片 → image_url，其他文本 → text）
  const attachedFiles = ctx.sessionManager.getAttachedFiles();
  const snippetContents = ctx.sessionManager.getAttachedSnippetContents();
  const dndContents = ctx.sessionManager.getAttachedDndContents();
  const fileParts = buildFileParts(attachedFiles, snippetContents, dndContents);

  // 先让前端显示用户气泡 + 加载状态（后端处理完 LLM 后会发 appendMessage 替换为真实消息）
  const displayPrompt =
    prompt || (imageUrls.length > 0 ? "粘贴的图像" : "") || (fileParts.length > 0 ? "附加的文件" : "");
  ctx.sendMessage({ type: "userMessage", content: displayPrompt });
  ctx.sendMessage({ type: "loading", value: true });

  try {
    const userPrompt: UserPromptContent = { text: prompt, imageUrls, fileParts };
    await ctx.sessionManager.handleUserPrompt(userPrompt);

    const activeSessionId = ctx.sessionManager.getActiveSessionId();
    const activeSession = activeSessionId ? ctx.sessionManager.getSession(activeSessionId) : null;
    if (activeSessionId && activeSession) {
      ctx.sendMessage({
        type: "sessionStatus",
        sessionId: activeSessionId,
        status: activeSession.status,
        processes: serializeProcesses(activeSession.processes),
        modifiedFiles: activeSession.modifiedFiles ?? undefined,
        tokenTelemetry: buildTokenTelemetry(ctx, activeSession),
      });
    }

    const sessions = ctx.sessionManager.listSessions().map((s) => ({
      id: s.id,
      summary: s.summary || "Untitled",
      createTime: s.createTime,
      updateTime: s.updateTime,
      status: s.status,
    }));
    ctx.sendMessage({ type: "showSessionsList", sessions });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    ctx.sendMessage({ type: "assistant", html: ctx.md.render(`Request failed: ${msg}`) });
  }
}

function serializeProcesses(
  processes: Map<string, { startTime: string; command: string }> | null,
): Record<string, { startTime: string; command: string }> | null {
  if (!processes || processes.size === 0) return null;
  const serialized: Record<string, { startTime: string; command: string }> = {};
  for (const [pid, entry] of processes.entries()) {
    serialized[pid] = entry;
  }
  return serialized;
}

function buildTokenTelemetry(ctx: HandlerContext, session: { usage?: unknown; lastUsage?: unknown } | null) {
  const settings = ctx.resolveCurrentSettings();
  return {
    model: settings.model,
    contextLimit: settings.contextLimit ?? 1_000_000,
    usage: session?.usage ?? null,
    lastUsage: session?.lastUsage ?? null,
  };
}
