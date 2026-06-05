/**
 * 连接配置 CRUD 处理器
 *
 * 处理 listProfiles、getProfile、deleteProfile、selectProfile、
 * testConnection、openProfileFile、createProfile、renameProfile。
 */

import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";
import OpenAI from "openai";
import type { HandlerContext } from "../handler-context";
import {
  listProfiles,
  loadProfile,
  deleteProfile,
  renameProfile,
  setActiveProfile,
  getActiveProfile,
  createProfileFromTemplate,
} from "../../utils/connection-profiles";

export function registerProfileHandlers(
  ctx: HandlerContext,
  registerHandler: (type: string, handler: (msg: Record<string, unknown>) => Promise<void>) => void,
): void {
  registerHandler("listProfiles", async (message) => {
    const names = listProfiles();
    const profilesDir = path.join(os.homedir(), ".codingmaid", "profiles");
    const items = names.map((name) => {
      const safeName = name.replace(/[^a-zA-Z0-9_\-\u4e00-\u9fff]+/g, "_");
      return { name, filePath: path.join(profilesDir, `${safeName}.json`) };
    });
    ctx.respond(message.requestId as string, true, items);
  });

  registerHandler("getProfile", async (message) => {
    const name = String(message.name || "").trim();
    if (!name) {
      ctx.respond(message.requestId as string, false, undefined, "缺少配置名称");
      return;
    }
    const cryptoKey = ctx.getCryptoKey();
    const profile = loadProfile(name, cryptoKey);
    if (!profile) {
      ctx.respond(message.requestId as string, false, undefined, `配置 "${name}" 未找到`);
      return;
    }
    const { apiKey, ...safe } = profile;
    ctx.respond(message.requestId as string, true, safe);
  });

  registerHandler("deleteProfile", async (message) => {
    const name = String(message.name || "").trim();
    if (!name) {
      ctx.respond(message.requestId as string, false, undefined, "缺少配置名称");
      return;
    }
    deleteProfile(name);
    ctx.respond(message.requestId as string, true);
  });

  registerHandler("selectProfile", async (message) => {
    const name = String(message.name || "").trim();
    if (!name) {
      respondIfRequested(ctx, message, false, undefined, "缺少配置名称");
      return;
    }
    setActiveProfile(name);
    void ctx.initializeMcpServers();
    respondIfRequested(ctx, message, true);
  });

  registerHandler("testConnection", async (message) => {
    const name = String(message.name || "").trim();
    if (!name) {
      ctx.respond(message.requestId as string, false, undefined, "缺少配置名称");
      return;
    }

    const cryptoKey = ctx.getCryptoKey();
    const profile = loadProfile(name, cryptoKey);
    if (!profile) {
      ctx.respond(message.requestId as string, false, undefined, `配置 "${name}" 未找到`);
      return;
    }
    if (!profile.apiKey) {
      ctx.respond(message.requestId as string, false, undefined, "API Key 未设置");
      return;
    }

    try {
      const client = new OpenAI({
        apiKey: profile.apiKey,
        baseURL: profile.baseURL || undefined,
      });

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000);

      const response = await client.chat.completions.create(
        {
          model: profile.model,
          messages: [{ role: "user", content: "Hi" }],
          max_tokens: 1,
          stream: false,
        },
        { signal: controller.signal },
      );

      clearTimeout(timeout);
      ctx.respond(message.requestId as string, true, { success: true, model: response.model });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      ctx.respond(message.requestId as string, false, undefined, msg);
    }
  });

  registerHandler("openProfileFile", async (message) => {
    const name = String(message.name || "").trim();
    if (!name) {
      ctx.respond(message.requestId as string, false, undefined, "缺少配置名称");
      return;
    }

    const profilesDir = path.join(os.homedir(), ".codingmaid", "profiles");
    const safeName = name.replace(/[^a-zA-Z0-9_\-\u4e00-\u9fff]+/g, "_");
    const filePath = path.join(profilesDir, `${safeName}.json`);

    if (!fs.existsSync(filePath)) {
      ctx.respond(message.requestId as string, false, undefined, `配置文件 "${name}" 不存在`);
      return;
    }

    await ctx.openFileInEditor(filePath, 1);
    ctx.respond(message.requestId as string, true);
  });

  registerHandler("createProfile", async (message) => {
    const name = String(message.name || "new-profile").trim();
    if (!name) {
      ctx.respond(message.requestId as string, false, undefined, "缺少配置名称");
      return;
    }
    const cryptoKey = ctx.getCryptoKey();
    const profile = createProfileFromTemplate(name, ctx.templatesDir, cryptoKey);
    const profilesDir = path.join(os.homedir(), ".codingmaid", "profiles");
    const safeName = name.replace(/[^a-zA-Z0-9_\-\u4e00-\u9fff]+/g, "_");
    ctx.respond(message.requestId as string, true, {
      name: profile.name,
      filePath: path.join(profilesDir, `${safeName}.json`),
    });
  });

  registerHandler("renameProfile", async (message) => {
    const oldName = String(message.oldName || "").trim();
    const newName = String(message.newName || "").trim();
    if (!oldName || !newName) {
      ctx.respond(message.requestId as string, false, undefined, "缺少配置名称");
      return;
    }
    if (oldName === newName) {
      ctx.respond(message.requestId as string, true);
      return;
    }
    const success = renameProfile(oldName, newName);
    if (!success) {
      ctx.respond(message.requestId as string, false, undefined, `重命名失败（目标 "${newName}" 可能已存在）`);
      return;
    }

    const activeName = getActiveProfile(ctx.getCryptoKey())?.name;
    if (activeName === oldName) {
      setActiveProfile(newName);
    }

    ctx.respond(message.requestId as string, true);
  });
}

function respondIfRequested(ctx: HandlerContext, message: Record<string, unknown>, ok: boolean, data?: unknown, error?: string): void {
  const rid = message.requestId;
  if (rid && typeof rid === "string") ctx.respond(rid, ok, data, error);
}
