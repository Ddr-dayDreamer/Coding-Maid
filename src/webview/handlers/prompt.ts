/**
 * 提示词发送处理器
 *
 * 处理 userPrompt、interrupt、attachFiles 等。
 * 发送后自动清除附加文件。
 */

import type { HandlerContext } from "../handler-context";
import type { UserPromptContent } from "../../session/types";
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
}

async function handlePrompt(ctx: HandlerContext, prompt: string): Promise<void> {
  await handlePromptWithImages(ctx, prompt, []);
}

async function handlePromptWithImages(ctx: HandlerContext, prompt: string, imageUrls: string[]): Promise<void> {
  // 捕获编辑器状态，供宏使用
  ctx.sessionManager.setEditorSelection(captureEditorSelection());
  ctx.sessionManager.setActiveFile(captureActiveFile());

  // 先让前端显示用户气泡 + 加载状态（后端处理完 LLM 后会发 appendMessage 替换为真实消息）
  const displayPrompt = prompt || (imageUrls.length > 0 ? "粘贴的图像" : "");
  ctx.sendMessage({ type: "userMessage", content: displayPrompt });
  ctx.sendMessage({ type: "loading", value: true });

  try {
    const userPrompt: UserPromptContent = { text: prompt, imageUrls };
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
    thinkingEnabled: settings.thinkingEnabled ?? false,
    reasoningEffort: settings.reasoningEffort ?? "max",
    contextLimit: settings.contextLimit ?? 1_000_000,
    usage: session?.usage ?? null,
    lastUsage: session?.lastUsage ?? null,
  };
}
