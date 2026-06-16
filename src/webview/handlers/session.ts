/**
 * 会话导航处理器
 *
 * 处理 selectSession、createNewSession、backToList、deleteSession、restoreSession。
 */

import * as path from "path";
import * as os from "os";
import type { HandlerContext } from "../handler-context";
import type { SessionEntry } from "../../session/types";

export function registerSessionHandlers(
  ctx: HandlerContext,
  registerHandler: (type: string, handler: (msg: Record<string, unknown>) => Promise<void>) => void,
): void {
  registerHandler("ready", async () => {
    const sessions = buildSessionsList(ctx);
    const settings = ctx.resolveCurrentSettings();

    if (sessions.length === 0) {
      // 没有历史会话，显示新对话界面
      ctx.sendMessage({
        type: "initializeEmpty",
        sessions,
        status: null,
        tokenTelemetry: buildTokenTelemetry(ctx, null),
        activePreset: settings.activePreset,
        activeProfile: settings.profileName,
      });
      return;
    }

    // 显示最新的对话
    loadSession(ctx, sessions[0].id);
  });

  registerHandler("selectSession", async (message) => {
    const sessionId = String(message.sessionId || "").trim();
    if (sessionId) loadSession(ctx, sessionId);
  });

  registerHandler("backToList", async () => {
    showSessionsList(ctx);
  });

  registerHandler("createNewSession", async () => {
    ctx.sessionManager.setActiveSessionId(null);
    ctx.sessionManager.clearAllAttachments();
    const sessions = buildSessionsList(ctx);
    const settings = ctx.resolveCurrentSettings();
    ctx.sendMessage({
      type: "initializeEmpty",
      sessions,
      status: null,
      tokenTelemetry: buildTokenTelemetry(ctx, null),
      activePreset: settings.activePreset,
      activeProfile: settings.profileName,
    });
  });

  registerHandler("deleteSession", async (message) => {
    const sessionId = String(message.sessionId || "").trim();
    if (!sessionId) return;
    ctx.sessionManager.deleteSession(sessionId);

    const sessions = buildSessionsList(ctx);
    ctx.sendMessage({ type: "showSessionsList", sessions });
    const settings = ctx.resolveCurrentSettings();
    ctx.sendMessage({
      type: "initializeEmpty",
      sessions,
      status: null,
      tokenTelemetry: buildTokenTelemetry(ctx, null),
      activePreset: settings.activePreset,
      activeProfile: settings.profileName,
    });
  });

  registerHandler("restoreSession", async (message) => {
    const sessionId = String(message.sessionId || "").trim();
    const messageId = String(message.messageId || "").trim();
    if (!sessionId || !messageId) {
      ctx.sendMessage({
        type: "notify",
        level: "error",
        text: "回退失败：会话或消息 ID 为空",
      });
      return;
    }

    ctx.sessionManager.interruptSession(sessionId);
    let restoreError: string | undefined;
    try {
      const result = ctx.sessionManager.rollbackToMessage(sessionId, messageId);
      restoreError = result.restoreError;
    } catch (err) {
      ctx.sendMessage({
        type: "notify",
        level: "error",
        text: `回退失败：${err instanceof Error ? err.message : String(err)}`,
      });
      return;
    }
    loadSession(ctx, sessionId);

    // 文件恢复失败时给出警告（不阻塞对话回退）
    if (restoreError) {
      ctx.sendMessage({
        type: "notify",
        level: "warning",
        text: `文件恢复失败：${restoreError}。对话已回退，但文件内容未还原。`,
        duration: 8000,
      });
    }
  });

  registerHandler("openFile", async (message) => {
    const filePath = String(message.filePath || "").trim();
    const line = Number(message.line || 1);
    if (filePath) await ctx.openFileInEditor(filePath, line);
  });

  registerHandler("openSettings", async () => {
    const settingsPath = path.join(os.homedir(), ".codingmaid", "settings.json");
    await ctx.openFileInEditor(settingsPath, 1);
  });
}

// ─── 内部工具 ────────────────────────────────────────────

function loadSession(ctx: HandlerContext, sessionId: string): void {
  const session = ctx.sessionManager.getSession(sessionId);
  if (!session) return;
  ctx.sessionManager.setActiveSessionId(sessionId);

  const messages = ctx.sessionManager.listSessionMessages(sessionId);
  const sessions = buildSessionsList(ctx);
  const settings = ctx.resolveCurrentSettings();

  ctx.sendMessage({
    type: "loadSession",
    sessionId,
    summary: session.summary || "Untitled",
    status: session.status,
    processes: serializeProcesses(session.processes),
    modifiedFiles: session.modifiedFiles ?? undefined,
    tokenTelemetry: buildTokenTelemetry(ctx, session),
    sessions,
    activePreset: settings.activePreset,
    activeProfile: settings.profileName,
    messages: messages
      .filter((m) => m.visible)
      .map((m) => ({
        id: m.id,
        sessionId: m.sessionId,
        role: m.role,
        content: m.content,
        messageParams: m.messageParams,
        html:
          m.role !== "tool"
            ? ctx.md.render(
                m.content ||
                  ((m.messageParams as Record<string, unknown> | null)?.reasoning_content as string) ||
                  "",
              )
            : undefined,
        meta: m.meta,
        checkpointHash: m.checkpointHash,
      })),
  });
}

function showSessionsList(ctx: HandlerContext): void {
  const sessions = buildSessionsList(ctx);
  ctx.sendMessage({ type: "showSessionsList", sessions });
}

function buildSessionsList(ctx: HandlerContext) {
  return ctx.sessionManager.listSessions().map((s) => ({
    id: s.id,
    summary: s.summary || "Untitled",
    createTime: s.createTime,
    updateTime: s.updateTime,
    status: s.status,
  }));
}

function buildTokenTelemetry(ctx: HandlerContext, session: SessionEntry | null) {
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
