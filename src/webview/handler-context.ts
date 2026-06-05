/**
 * 处理器上下文 — Webview 消息处理器所需的依赖集合。
 *
 * CodingMaidViewProvider 创建此上下文并传给各 handler 模块，
 * 避免处理器直接依赖完整的 Provider 实例。
 */

import type { SessionManager } from "../session/manager";
import type { ResolvedSettings } from "../settings";

export type HandlerContext = {
  sessionManager: SessionManager;
  md: { render: (text: string) => string };
  templatesDir: string;

  resolveCurrentSettings: () => ResolvedSettings;
  getCryptoKey: () => string;
  getWorkspaceRoot: () => string;

  openFileInEditor: (filePath: string, line: number) => Promise<void>;
  initializeMcpServers: () => Promise<void>;
  sendMessage: (message: unknown) => void;
  respond: (requestId: string, ok: boolean, data?: unknown, error?: string) => void;
};
