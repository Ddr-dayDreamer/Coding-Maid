/**
 * 提示词发送处理器
 *
 * 处理 userPrompt、interrupt、attachFiles。
 * 在发送前捕获编辑器上下文注入 MacroEngine。
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
    await handlePrompt(ctx, prompt);
  });

  registerHandler("interrupt", async () => {
    ctx.sessionManager.interruptActiveSession();
  });

  registerHandler("attachFiles", async (message) => {
    const filePaths = message.filePaths;
    if (Array.isArray(filePaths)) {
      ctx.sessionManager.setAttachedFiles(filePaths.map(String));
    }
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
