/**
 * 消息处理器统一注册入口
 *
 * 遍历所有 handler 模块并注册到 Provider。
 */

import type { HandlerContext } from "../handler-context";
import { registerPromptHandlers } from "./prompt";
import { registerSessionHandlers } from "./session";
import { registerPresetHandlers } from "./preset";
import { registerProfileHandlers } from "./profile";
import { registerEditorHandlers } from "./editor";

export function registerAllHandlers(
  ctx: HandlerContext,
  registerHandler: (type: string, handler: (msg: Record<string, unknown>) => Promise<void>) => void,
): void {
  registerEditorHandlers(ctx, registerHandler);
  registerPromptHandlers(ctx, registerHandler);
  registerSessionHandlers(ctx, registerHandler);
  registerPresetHandlers(ctx, registerHandler);
  registerProfileHandlers(ctx, registerHandler);
}
