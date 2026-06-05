/**
 * 预设 CRUD 处理器
 *
 * 处理 listPresets、getPreset、savePreset、deletePreset、
 * selectPreset、getActivePreset、exportPreset、importPreset。
 */

import * as vscode from "vscode";
import type { HandlerContext } from "../handler-context";
import { getActivePreset, setActivePreset } from "../../utils/global-settings";

export function registerPresetHandlers(
  ctx: HandlerContext,
  registerHandler: (type: string, handler: (msg: Record<string, unknown>) => Promise<void>) => void,
): void {
  registerHandler("listPresets", async (message) => {
    const presets = ctx.sessionManager.presetMgr.listPresets();
    const data = presets.map((p) => ({ name: p.name, displayName: p.displayName, description: p.description }));
    ctx.respond(message.requestId as string, true, data);
  });

  registerHandler("getPreset", async (message) => {
    const name = String(message.name || "").trim();
    if (!name) {
      ctx.respond(message.requestId as string, false, undefined, "缺少预设名称");
      return;
    }
    const def = ctx.sessionManager.presetMgr.loadPreset(name);
    ctx.respond(message.requestId as string, true, def);
  });

  registerHandler("savePreset", async (message) => {
    const name = String(message.name || "").trim();
    if (!name || !message.definition) {
      ctx.respond(message.requestId as string, false, undefined, "缺少预设名称或定义");
      return;
    }
    ctx.sessionManager.presetMgr.savePreset(name, message.definition as any);
    ctx.respond(message.requestId as string, true);
  });

  registerHandler("deletePreset", async (message) => {
    const name = String(message.name || "").trim();
    if (!name) {
      ctx.respond(message.requestId as string, false, undefined, "缺少预设名称");
      return;
    }
    ctx.sessionManager.presetMgr.deletePreset(name);
    ctx.respond(message.requestId as string, true);
  });

  registerHandler("selectPreset", async (message) => {
    const name = String(message.name || "").trim();
    if (!name) {
      respondIfRequested(ctx, message, false, undefined, "缺少预设名称");
      return;
    }
    setActivePreset(name);
    respondIfRequested(ctx, message, true);
  });

  registerHandler("getActivePreset", async (message) => {
    const name = getActivePreset();
    ctx.respond(message.requestId as string, true, { name });
  });

  registerHandler("exportPreset", async (message) => {
    const name = String(message.name || "").trim();
    if (!name) {
      ctx.respond(message.requestId as string, false, undefined, "缺少预设名称");
      return;
    }

    const defaultUri = vscode.Uri.file(`${name}.json`);
    const uri = await vscode.window.showSaveDialog({
      defaultUri,
      filters: { "Preset JSON": ["json"] },
      title: "导出预设",
    });
    if (!uri) {
      ctx.respond(message.requestId as string, true);
      return;
    }

    ctx.sessionManager.presetMgr.exportPreset(name, uri.fsPath);
    ctx.respond(message.requestId as string, true);
  });

  registerHandler("importPreset", async (message) => {
    const uris = await vscode.window.showOpenDialog({
      canSelectMany: false,
      filters: { "Preset JSON": ["json"] },
      title: "导入预设",
    });
    if (!uris || uris.length === 0) {
      ctx.respond(message.requestId as string, true);
      return;
    }

    const def = ctx.sessionManager.presetMgr.importPreset(uris[0].fsPath);
    ctx.respond(message.requestId as string, true, def);
  });
}

function respondIfRequested(ctx: HandlerContext, message: Record<string, unknown>, ok: boolean, data?: unknown, error?: string): void {
  const rid = message.requestId;
  if (rid && typeof rid === "string") ctx.respond(rid, ok, data, error);
}
