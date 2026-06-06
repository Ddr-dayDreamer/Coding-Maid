/**
 * 审批配置处理器
 *
 * 处理 approveTool、getApprovalConfig、setApprovalConfig。
 */

import type { HandlerContext } from "../handler-context";
import { registry } from "../../tools/index";
import { loadGlobalSettings, saveGlobalSettings, type ApprovalConfig } from "../../utils/global-settings";

export function registerApprovalHandlers(
  ctx: HandlerContext,
  registerHandler: (type: string, handler: (msg: Record<string, unknown>) => Promise<void>) => void,
): void {
  /**
   * 用户审批/拒绝工具调用
   */
  registerHandler("approveTool", async (message) => {
    const toolCallId = String(message.toolCallId ?? "");
    const action = String(message.action ?? "reject") as "approve" | "reject";
    const modifiedArgs = message.modifiedArgs as Record<string, unknown> | undefined;

    const sessionId = ctx.sessionManager.getActiveSessionId();
    if (!sessionId) return;

    await ctx.sessionManager.handleToolApproval(sessionId, toolCallId, action, modifiedArgs);
  });

  /**
   * 获取当前审批配置（请求-响应模式）
   */
  registerHandler("getApprovalConfig", async (message) => {
    const settings = loadGlobalSettings();
    ctx.respond(message.requestId as string, true, settings.approvalConfig ?? {});
  });

  /**
   * 保存审批配置
   */
  registerHandler("setApprovalConfig", async (message) => {
    const config = message.config as ApprovalConfig | undefined;
    if (!config) {
      ctx.respond(message.requestId as string, false, undefined, "缺少审批配置");
      return;
    }

    // 保存到 settings.json
    const settings = loadGlobalSettings();
    settings.approvalConfig = config;
    saveGlobalSettings(settings);

    // 更新运行时 registry
    registry.setApprovalConfig(config);

    ctx.respond(message.requestId as string, true);
  });
}
