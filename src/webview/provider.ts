/**
 * CodingMaidViewProvider — VS Code WebviewView 提供者
 *
 * 职责：
 * 1. Webview 生命周期管理 (resolveWebviewView, getWebviewHtml)
 * 2. 消息路由 (registerHandler, handlers Map, respond)
 * 3. OpenAI 客户端工厂、token 遥测、MCP 初始化
 * 4. 编辑器文件打开
 *
 * 消息处理委托给 handlers/ 目录下的各模块。
 */

import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import OpenAI from "openai";
import MarkdownIt from "markdown-it";
import { SessionManager } from "../session/manager";
import { registry } from "../tools/index";
import { deriveKeyFromSeed } from "../utils/crypto-utils";
import { setShellIfWindows } from "../utils/shell-utils";
import {
  resolveSettingsWithCryptoKey,
  ensureInitialConfig,
} from "../settings";
import type { ResolvedSettings, ReasoningEffort } from "../settings";
import type { HandlerContext } from "./handler-context";
import { registerAllHandlers } from "./handlers/index";

const CRYPTO_KEY_STORAGE_KEY = "codingmaid.cryptoKey";

export class CodingMaidViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = "codingmaid.chatView";

  private webviewView: vscode.WebviewView | undefined;
  private readonly md: MarkdownIt;
  private readonly sessionManager: SessionManager;
  private readonly templatesDir: string;

  /** 消息路由表 */
  private readonly handlers = new Map<string, (message: Record<string, unknown>) => Promise<void>>();

  constructor(private readonly context: vscode.ExtensionContext) {
    this.md = new MarkdownIt({ html: false, linkify: false, breaks: true });
    this.sessionManager = new SessionManager({
      projectRoot: this.getWorkspaceRoot(),
      createOpenAIClient: () => this.createOpenAIClient(),
      getResolvedSettings: () => this.resolveCurrentSettings(),
      renderMarkdown: (text) => this.md.render(text),
      onAssistantMessage: (message, shouldConnect) => {
        if (!this.webviewView) return;
        if (message.visible === false) return;
        if (message.role !== "tool") {
          const reasoningContent = (message.messageParams as Record<string, unknown> | null)?.reasoning_content as string | undefined;
          message.html = this.md.render(message.content || reasoningContent || "");
        }
        this.webviewView.webview.postMessage({ type: "appendMessage", message, shouldConnect });
      },
      onSessionEntryUpdated: (entry) => {
        if (!this.webviewView) return;
        this.webviewView.webview.postMessage({
          type: "sessionStatus",
          sessionId: entry.id,
          status: entry.status,
          processes: this.serializeProcesses(entry.processes),
          tokenTelemetry: this.buildTokenTelemetry(entry),
        });
      },
      onLlmStreamProgress: (progress) => {
        if (!this.webviewView) return;
        this.webviewView.webview.postMessage({ type: "llmStreamProgress", progress });
      },
      onStreamChunk: (chunk) => {
        if (!this.webviewView) return;
        this.webviewView.webview.postMessage({
          type: "streamChunk",
          sessionId: chunk.sessionId,
          content: chunk.content,
          reasoningContent: chunk.reasoningContent,
        });
      },
      onNotify: (level, text, duration) => {
        if (!this.webviewView) return;
        this.webviewView.webview.postMessage({ type: "notify", level, text, duration });
      },
    });

    this.templatesDir = path.join(this.context.extensionUri.fsPath, "templates");
    this.initCryptoKey();
    ensureInitialConfig(this.templatesDir, this.getCryptoKey());

    // 加载审批配置到 registry
    const initialSettings = resolveSettingsWithCryptoKey(this.getCryptoKey());
    registry.setApprovalConfig(initialSettings.approvalConfig);

    // 注册所有消息处理器
    const handlerCtx = this.buildHandlerContext();
    registerAllHandlers(handlerCtx, (type, handler) => this.registerHandler(type, handler));

    void this.initializeMcpServers();
  }

  dispose(): void {
    this.sessionManager.dispose();
  }

  // ═══════════════════════════════════════════════════════
  //  消息路由
  // ═══════════════════════════════════════════════════════

  private registerHandler(type: string, handler: (msg: Record<string, unknown>) => Promise<void>): void {
    this.handlers.set(type, handler);
  }

  private buildHandlerContext(): HandlerContext {
    return {
      sessionManager: this.sessionManager,
      md: this.md,
      templatesDir: this.templatesDir,
      resolveCurrentSettings: () => this.resolveCurrentSettings(),
      getCryptoKey: () => this.getCryptoKey(),
      getWorkspaceRoot: () => this.getWorkspaceRoot(),
      openFileInEditor: (filePath, line) => this.openFileInEditor(filePath, line),
      initializeMcpServers: () => this.initializeMcpServers(),
      sendMessage: (msg) => this.sendMessage(msg),
      respond: (requestId, ok, data, error) => this.respond(requestId, ok, data, error),
    };
  }

  // ═══════════════════════════════════════════════════════
  //  Webview 生命周期
  // ═══════════════════════════════════════════════════════

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.webviewView = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.context.extensionUri],
    };

    webviewView.webview.html = this.getWebviewHtml(webviewView.webview);

    webviewView.webview.onDidReceiveMessage(async (message: Record<string, unknown>) => {
      const handler = this.handlers.get(message?.type as string);
      if (!handler) return;
      try {
        await handler(message);
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        if (message.requestId) {
          this.respond(message.requestId as string, false, undefined, msg);
        } else {
          console.error(`[handler:${message.type}]`, msg);
        }
      }
    });
  }

  /** 响应前端的 request() 调用 */
  private respond(requestId: string, ok: boolean, data?: unknown, error?: string): void {
    this.sendMessage({ type: "response", requestId, ok, data, error });
  }

  private sendMessage(message: unknown): void {
    this.webviewView?.webview.postMessage(message);
  }

  // ═══════════════════════════════════════════════════════
  //  OpenAI 工厂 & 遥测
  // ═══════════════════════════════════════════════════════

  private createOpenAIClient(): {
    client: OpenAI | null;
    model: string;
    baseURL: string;
    thinkingEnabled?: boolean;
    reasoningEffort?: ReasoningEffort;
    params?: Record<string, unknown>;
    notify?: string;
    webSearchTool?: string;
    env?: Record<string, string>;
    machineId?: string;
  } {
    const settings = this.resolveCurrentSettings();
    const { apiKey, baseURL, model, thinkingEnabled, reasoningEffort, params, notify, webSearchTool } = settings;
    const machineId = vscode.env.machineId;

    if (!apiKey) {
      return { client: null, model, baseURL, thinkingEnabled, reasoningEffort, params, notify, webSearchTool, machineId };
    }

    return {
      client: new OpenAI({ apiKey, baseURL: baseURL || undefined }),
      model,
      baseURL,
      thinkingEnabled,
      reasoningEffort,
      params,
      notify,
      webSearchTool,
      machineId,
    };
  }

  private buildTokenTelemetry(session: { usage?: unknown; lastUsage?: unknown } | null) {
    const settings = this.resolveCurrentSettings();
    return {
      model: settings.model,
      thinkingEnabled: settings.thinkingEnabled ?? false,
      reasoningEffort: settings.reasoningEffort ?? "max",
      contextLimit: settings.contextLimit ?? 1_000_000,
      usage: session?.usage ?? null,
      lastUsage: session?.lastUsage ?? null,
    };
  }

  // ═══════════════════════════════════════════════════════
  //  初始化 & 辅助
  // ═══════════════════════════════════════════════════════

  private async initializeMcpServers(): Promise<void> {
    try {
      await this.sessionManager.initMcpServers(this.resolveCurrentSettings().mcpServers);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      void vscode.window.showErrorMessage(`Failed to initialize MCP servers: ${message}`);
    }
  }

  private getCryptoKey(): string {
    return deriveKeyFromSeed(vscode.env.machineId);
  }

  private initCryptoKey(): void {
    const newKey = deriveKeyFromSeed(vscode.env.machineId);
    void this.context.globalState.update(CRYPTO_KEY_STORAGE_KEY, newKey);
  }

  private resolveCurrentSettings(): ResolvedSettings {
    return resolveSettingsWithCryptoKey(this.getCryptoKey());
  }

  private getWorkspaceRoot(): string {
    const workspace = vscode.workspace.workspaceFolders?.[0];
    return workspace ? workspace.uri.fsPath : process.cwd();
  }

  private serializeProcesses(
    processes: Map<string, { startTime: string; command: string }> | null,
  ): Record<string, { startTime: string; command: string }> | null {
    if (!processes || processes.size === 0) return null;
    const serialized: Record<string, { startTime: string; command: string }> = {};
    for (const [pid, entry] of processes.entries()) {
      serialized[pid] = entry;
    }
    return serialized;
  }

  private async openFileInEditor(filePath: string, line: number): Promise<void> {
    const document = await vscode.workspace.openTextDocument(vscode.Uri.file(filePath));
    const editor = await vscode.window.showTextDocument(document, { preview: false, preserveFocus: false });
    const targetLine = Number.isFinite(line) && line > 0 ? Math.floor(line) - 1 : 0;
    const safeLine = Math.min(Math.max(0, targetLine), Math.max(0, document.lineCount - 1));
    const position = new vscode.Position(safeLine, 0);
    editor.selection = new vscode.Selection(position, position);
    editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenter);
  }

  private getWebviewHtml(webview: vscode.Webview): string {
    const nonce = getNonce();
    const csp = webview.cspSource;

    const htmlPath = vscode.Uri.joinPath(this.context.extensionUri, "resources", "webview.html");
    let html = fs.readFileSync(htmlPath.fsPath, "utf8");

    const cssUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, "resources", "webview.css"));
    const bundleJsUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, "resources", "webview", "bundle.js"));
    const bundleCssUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, "resources", "webview", "bundle.css"));

    html = html.replace(/\{\{nonce\}\}/g, nonce);
    html = html.replace(/\{\{cspSource\}\}/g, csp);
    html = html.replace(/\{\{cssUri\}\}/g, cssUri.toString());
    html = html.replace(/\{\{bundleJsUri\}\}/g, bundleJsUri.toString());
    html = html.replace(/\{\{bundleCssUri\}\}/g, bundleCssUri.toString());
    html = html.replace(/\{\{workspaceRoot\}\}/g, JSON.stringify(this.getWorkspaceRoot()));

    return html;
  }
}

function getNonce(): string {
  let text = "";
  const possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  for (let i = 0; i < 32; i += 1) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}
