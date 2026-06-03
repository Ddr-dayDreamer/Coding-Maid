import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import OpenAI from "openai";
import MarkdownIt from "markdown-it";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import type { SessionMessage } from "./session";
import {
  SessionManager,
  getCompactPromptTokenThreshold,
  type LlmStreamProgress,
  type SessionEntry,
  type UserPromptContent,
} from "./session";
import {
  resolveSettingsWithCryptoKey,
  ensureInitialConfig,
  type ConnectionProfile,
  type ReasoningEffort,
  type ResolvedCodingMaidSettings,
} from "./settings";
import { setShellIfWindows } from "./common/shell-utils";
import { generateEncryptionKey } from "./common/crypto-utils";

const CRYPTO_KEY_STORAGE_KEY = "codingmaid.cryptoKey";

type ReasoningMessageParams = {
  reasoning_content?: string;
};

class CodingMaidViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = "codingmaid.chatView";

  private readonly context: vscode.ExtensionContext;
  private webviewView: vscode.WebviewView | undefined;
  private readonly md: MarkdownIt;
  private readonly sessionManager: SessionManager;
  private readonly debugOutputChannel: vscode.OutputChannel;

  constructor(context: vscode.ExtensionContext) {
    this.context = context;
    this.md = new MarkdownIt({
      html: false,
      linkify: false,
      breaks: true,
    });
    this.debugOutputChannel = vscode.window.createOutputChannel("Coding Maid Debug", "log");
    this.sessionManager = new SessionManager({
      projectRoot: this.getWorkspaceRoot(),
      createOpenAIClient: () => this.createOpenAIClient(),
      getResolvedSettings: () => this.resolveCurrentSettings(),
      renderMarkdown: (text) => this.md.render(text),
      onAssistantMessage: (message: SessionMessage, shouldConnect: boolean) => {
        if (!this.webviewView) {
          return;
        }
        if (message.visible === false) {
          return;
        }
        if (message.role !== "tool") {
          const reasoningContent = (message.messageParams as ReasoningMessageParams | null)?.reasoning_content;
          message.html = this.md.render(message.content || reasoningContent || "");
        }
        this.webviewView.webview.postMessage({ type: "appendMessage", message, shouldConnect });
      },
      onSessionEntryUpdated: (entry) => {
        if (!this.webviewView) {
          return;
        }
        this.webviewView.webview.postMessage({
          type: "sessionStatus",
          sessionId: entry.id,
          status: entry.status,
          processes: this.serializeProcesses(entry.processes),
          tokenTelemetry: this.buildTokenTelemetry(entry),
        });
      },
      onLlmStreamProgress: (progress: LlmStreamProgress) => {
        if (!this.webviewView) {
          return;
        }
        this.webviewView.webview.postMessage({
          type: "llmStreamProgress",
          progress,
        });
      },
      onStreamChunk: (chunk) => {
        if (!this.webviewView) {
          return;
        }
        this.webviewView.webview.postMessage({
          type: "streamChunk",
          sessionId: chunk.sessionId,
          content: chunk.content,
          reasoningContent: chunk.reasoningContent,
        });
      },
      onDebugPrompt: (messages: ChatCompletionMessageParam[], iteration: number) => {
        this.debugOutputChannel.clear();
        this.debugOutputChannel.appendLine("=".repeat(80));
        this.debugOutputChannel.appendLine(
          `[Coding Maid Debug] Iteration: ${iteration === -1 ? "COMPACT" : iteration}`
        );
        this.debugOutputChannel.appendLine("=".repeat(80));
        for (const msg of messages) {
          const role = msg.role ?? "unknown";
          const content = typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content, null, 2);
          this.debugOutputChannel.appendLine(`\n--- ${role.toUpperCase()} ---`);
          this.debugOutputChannel.appendLine(content);
          this.debugOutputChannel.appendLine("");
        }
        this.debugOutputChannel.appendLine("=".repeat(80));
        this.debugOutputChannel.appendLine("[End]");
        this.debugOutputChannel.show(true);
      },
    });
    this.initCryptoKey();
    // 统一初始化：settings.json + 连接预设（缺失则从 templates/ 复制）
    const templatesDir = path.join(this.context.extensionUri.fsPath, "templates");
    ensureInitialConfig(templatesDir, this.getCryptoKey());
    void this.initializeMcpServers();
  }

  dispose(): void {
    this.sessionManager.dispose();
    this.debugOutputChannel.dispose();
  }

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.webviewView = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.context.extensionUri],
    };

    webviewView.webview.html = this.getWebviewHtml(webviewView.webview);

    // 直接初始化（不依赖 webview 的 ready 消息，因视图复用时 ready 可能不会重新发送）
    this.loadInitialSession().catch((error) => {
      void vscode.window.showErrorMessage(`初始化失败：${error}`);
    });

    webviewView.webview.onDidReceiveMessage(async (message) => {
      if (message?.type === "userPrompt") {
        const prompt = String(message.prompt || "").trim();
        const images = Array.isArray(message.images)
          ? message.images.filter((image: unknown): image is string => typeof image === "string" && image.length > 0)
          : [];
        if (!prompt && images.length === 0) {
          return;
        }
        await this.handlePrompt(prompt, images);
      } else if (message?.type === "interrupt") {
        // 中断当前会话
        this.sessionManager.interruptActiveSession();
      } else if (message?.type === "createNewSession") {
        await this.createNewSession();
      } else if (message?.type === "selectSession") {
        const sessionId = String(message.sessionId || "").trim();
        if (sessionId) {
          this.loadSession(sessionId);
        }
      } else if (message?.type === "backToList") {
        this.showSessionsList();
      } else if (message?.type === "openFile") {
        const filePath = String(message.filePath || "").trim();
        const line = Number(message.line || 1);
        if (filePath) {
          await this.openFileInEditor(filePath, line);
        }
      } else if (message?.type === "deleteSession") {
        const sessionId = String(message.sessionId || "").trim();
        if (sessionId) {
          await this.handleDeleteSession(sessionId);
        }
      } else if (message?.type === "restoreSession") {
        const sessionId = String(message.sessionId || "").trim();
        const messageId = String(message.messageId || "").trim();
        if (sessionId && messageId) {
          await this.handleRestoreSession(sessionId, messageId);
        }
      }
    });
  }

  private async loadInitialSession(): Promise<void> {
    const sessions = this.sessionManager.listSessions();
    const sessionsList = sessions.map((s) => ({
      id: s.id,
      summary: s.summary || "Untitled",
      createTime: s.createTime,
      updateTime: s.updateTime,
      status: s.status,
    }));

    if (sessions.length === 0) {
      // 没有历史会话，显示新对话界面
      this.sendMessage({
        type: "initializeEmpty",
        sessions: sessionsList,
        status: null,
        tokenTelemetry: this.buildTokenTelemetry(null),
      });
      return;
    }

    // 显示最新的对话
    const latestSession = sessions[0];
    this.loadSession(latestSession.id);
  }

  private loadSession(sessionId: string): void {
    const session = this.sessionManager.getSession(sessionId);
    if (!session) {
      return;
    }

    // 设置为活动会话
    this.sessionManager.setActiveSessionId(sessionId);

    const messages = this.sessionManager.listSessionMessages(sessionId);

    // 获取所有会话列表
    const sessions = this.sessionManager.listSessions();
    const sessionsList = sessions.map((s) => ({
      id: s.id,
      summary: s.summary || "Untitled",
      createTime: s.createTime,
      updateTime: s.updateTime,
      status: s.status,
    }));

    // 发送对话信息到 webview
    this.sendMessage({
      type: "loadSession",
      sessionId,
      summary: session.summary || "Untitled",
      status: session.status,
      processes: this.serializeProcesses(session.processes),
      tokenTelemetry: this.buildTokenTelemetry(session),
      sessions: sessionsList,
      messages: messages
        .filter((m) => m.visible)
        .map((m) => ({
          id: m.id,
          sessionId: m.sessionId,
          role: m.role,
          content: m.content,
          html:
            m.role !== "tool"
              ? this.md.render(m.content || (m.messageParams as ReasoningMessageParams | null)?.reasoning_content || "")
              : undefined,
          meta: m.meta,
          checkpointHash: m.checkpointHash,
        })),
    });
  }

  private showSessionsList(): void {
    const sessions = this.sessionManager.listSessions();
    this.sendMessage({
      type: "showSessionsList",
      sessions: sessions.map((s) => ({
        id: s.id,
        summary: s.summary || "Untitled",
        createTime: s.createTime,
        updateTime: s.updateTime,
        status: s.status,
      })),
    });
  }

  private async handleDeleteSession(sessionId: string): Promise<void> {
    // 前端已做内联确认，此处直接执行删除
    this.sessionManager.deleteSession(sessionId);

    // 通知前端更新会话列表
    const sessions = this.sessionManager.listSessions();
    const sessionsList = sessions.map((s) => ({
      id: s.id,
      summary: s.summary || "Untitled",
      createTime: s.createTime,
      updateTime: s.updateTime,
      status: s.status,
    }));
    this.sendMessage({ type: "showSessionsList", sessions: sessionsList });

    // 回到空对话界面
    this.sendMessage({
      type: "initializeEmpty",
      sessions: sessionsList,
      status: null,
      tokenTelemetry: this.buildTokenTelemetry(null),
    });
  }

  private async handleRestoreSession(sessionId: string, messageId: string): Promise<void> {
    // 先恢复文件（需要在截断对话之前找到消息的 checkpointHash）
    try {
      this.sessionManager.restoreSessionCode(sessionId, messageId);
    } catch {
      // 文件恢复失败不阻塞，仅回退对话
    }

    // 再截断对话消息
    try {
      this.sessionManager.restoreSessionConversation(sessionId, messageId);
    } catch {
      void vscode.window.showErrorMessage("回退失败：找不到目标消息");
      return;
    }

    // 重新加载会话
    this.loadSession(sessionId);
  }

  private async createNewSession(): Promise<void> {
    // 清除当前活动会话
    this.sessionManager.setActiveSessionId(null);

    // 获取所有会话列表
    const sessions = this.sessionManager.listSessions();
    const sessionsList = sessions.map((s) => ({
      id: s.id,
      summary: s.summary || "Untitled",
      createTime: s.createTime,
      updateTime: s.updateTime,
      status: s.status,
    }));

    this.sendMessage({
      type: "initializeEmpty",
      sessions: sessionsList,
      status: null,
      tokenTelemetry: this.buildTokenTelemetry(null),
    });
  }

  private sendMessage(message: unknown): void {
    if (!this.webviewView) {
      return;
    }
    this.webviewView.webview.postMessage(message);
  }

  private async handlePrompt(prompt: string, imageUrls?: string[]): Promise<void> {
    if (!this.webviewView) {
      return;
    }

    const webview = this.webviewView.webview;
    const normalizedImages = Array.isArray(imageUrls) ? imageUrls.filter(Boolean) : [];
    const displayPrompt = prompt || (normalizedImages.length > 0 ? "粘贴的图像" : "");

    // 先显示用户消息（原始文本，不做 HTML 格式化）
    webview.postMessage({ type: "userMessage", content: displayPrompt });

    webview.postMessage({ type: "loading", value: true });

    try {
      const userPrompt: UserPromptContent = { text: prompt, imageUrls: normalizedImages };
      await this.sessionManager.handleUserPrompt(userPrompt);

      const activeSessionId = this.sessionManager.getActiveSessionId();
      const activeSession = activeSessionId ? this.sessionManager.getSession(activeSessionId) : null;
      if (activeSessionId && activeSession) {
        webview.postMessage({
          type: "sessionStatus",
          sessionId: activeSessionId,
          status: activeSession.status,
          processes: this.serializeProcesses(activeSession.processes),
          tokenTelemetry: this.buildTokenTelemetry(activeSession),
        });
      }

      // 发送更新后的会话列表（可能创建了新会话）
      const sessions = this.sessionManager.listSessions();
      const sessionsList = sessions.map((s) => ({
        id: s.id,
        summary: s.summary || "Untitled",
        createTime: s.createTime,
        updateTime: s.updateTime,
        status: s.status,
      }));
      webview.postMessage({
        type: "showSessionsList",
        sessions: sessionsList,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      webview.postMessage({
        type: "assistant",
        html: this.md.render(`Request failed: ${message}`),
      });
    } finally {
      webview.postMessage({ type: "loading", value: false });
    }
  }

  private createOpenAIClient(): {
    client: OpenAI | null;
    model: string;
    baseURL: string;
    thinkingEnabled?: boolean;
    reasoningEffort?: ReasoningEffort;
    params?: Record<string, unknown>;
    debugLogEnabled: boolean;
    debugPromptEnabled: boolean;
    notify?: string;
    webSearchTool?: string;
    env?: Record<string, string>;
    machineId?: string;
  } {
    const settings = this.resolveCurrentSettings();

    const {
      apiKey,
      baseURL,
      model,
      thinkingEnabled,
      reasoningEffort,
      params,
      debugLogEnabled,
      debugPromptEnabled,
      notify,
      webSearchTool,
    } = settings;
    const machineId = vscode.env.machineId;

    if (!apiKey) {
      return {
        client: null,
        model,
        baseURL,
        thinkingEnabled,
        reasoningEffort,
        params,
        debugLogEnabled,
        debugPromptEnabled,
        notify,
        webSearchTool,
        machineId,
      };
    }

    const client = new OpenAI({
      apiKey,
      baseURL: baseURL || undefined,
    });

    return {
      client,
      model,
      baseURL,
      thinkingEnabled,
      reasoningEffort,
      params,
      debugLogEnabled,
      debugPromptEnabled,
      notify,
      webSearchTool,
      machineId,
    };
  }

  private buildTokenTelemetry(session: SessionEntry | null): {
    model: string;
    thinkingEnabled: boolean;
    reasoningEffort: ReasoningEffort;
    activeTokens: number;
    compactPromptTokenThreshold: number;
    usage: unknown | null;
  } {
    const settings = this.resolveCurrentSettings();
    return {
      model: settings.model,
      thinkingEnabled: settings.thinkingEnabled ?? false,
      reasoningEffort: settings.reasoningEffort ?? "max",
      activeTokens: session?.activeTokens ?? 0,
      compactPromptTokenThreshold: getCompactPromptTokenThreshold(settings.model),
      usage: session?.usage ?? null,
    };
  }

  private async initializeMcpServers(): Promise<void> {
    try {
      await this.sessionManager.initMcpServers(this.resolveCurrentSettings().mcpServers);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      void vscode.window.showErrorMessage(`Failed to initialize MCP servers: ${message}`);
    }
  }

  private getCryptoKey(): string {
    return this.context.globalState.get<string>(CRYPTO_KEY_STORAGE_KEY, "");
  }

  private initCryptoKey(): void {
    const existing = this.context.globalState.get<string>(CRYPTO_KEY_STORAGE_KEY);
    if (!existing) {
      const key = generateEncryptionKey();
      void this.context.globalState.update(CRYPTO_KEY_STORAGE_KEY, key);
    }
  }

  private resolveCurrentSettings(): ResolvedCodingMaidSettings {
    const cryptoKey = this.getCryptoKey();
    return resolveSettingsWithCryptoKey(cryptoKey);
  }

  private getWorkspaceRoot(): string {
    const workspace = vscode.workspace.workspaceFolders?.[0];
    if (workspace) {
      return workspace.uri.fsPath;
    }
    return process.cwd();
  }

  private serializeProcesses(
    processes: Map<string, { startTime: string; command: string }> | null
  ): Record<string, { startTime: string; command: string }> | null {
    if (!processes || processes.size === 0) {
      return null;
    }

    const serialized: Record<string, { startTime: string; command: string }> = {};
    for (const [pid, entry] of processes.entries()) {
      serialized[pid] = entry;
    }
    return serialized;
  }

  private getWebviewHtml(webview: vscode.Webview): string {
    const nonce = getNonce();
    const csp = webview.cspSource;

    const htmlPath = vscode.Uri.joinPath(this.context.extensionUri, "resources", "webview.html");
    let html = fs.readFileSync(htmlPath.fsPath, "utf8");

    const cssPath = vscode.Uri.joinPath(this.context.extensionUri, "resources", "webview.css");
    const cssUri = webview.asWebviewUri(cssPath);
    const attachmentsJsPath = vscode.Uri.joinPath(this.context.extensionUri, "resources", "prompt-attachments.js");
    const attachmentsJsUri = webview.asWebviewUri(attachmentsJsPath);
    const iconPath = vscode.Uri.joinPath(this.context.extensionUri, "resources", "coding_maid_icon.png");
    const iconUri = webview.asWebviewUri(iconPath);
    const bundleJsPath = vscode.Uri.joinPath(this.context.extensionUri, "resources", "webview", "bundle.js");
    const bundleJsUri = webview.asWebviewUri(bundleJsPath);

    html = html.replace(/\{\{nonce\}\}/g, nonce);
    html = html.replace(/\{\{cspSource\}\}/g, csp);
    html = html.replace(/\{\{cssUri\}\}/g, cssUri.toString());
    html = html.replace(/\{\{attachmentsJsUri\}\}/g, attachmentsJsUri.toString());
    html = html.replace(/\{\{bundleJsUri\}\}/g, bundleJsUri.toString());
    html = html.replace(/\{\{iconUri\}\}/g, iconUri.toString());
    html = html.replace(/\{\{workspaceRoot\}\}/g, JSON.stringify(this.getWorkspaceRoot()));

    return html;
  }

  private async openFileInEditor(filePath: string, line: number): Promise<void> {
    const document = await vscode.workspace.openTextDocument(vscode.Uri.file(filePath));
    const editor = await vscode.window.showTextDocument(document, {
      preview: false,
      preserveFocus: false,
    });

    const targetLine = Number.isFinite(line) && line > 0 ? Math.floor(line) - 1 : 0;
    const safeLine = Math.min(Math.max(0, targetLine), Math.max(0, document.lineCount - 1));
    const position = new vscode.Position(safeLine, 0);
    const selection = new vscode.Selection(position, position);
    editor.selection = selection;
    editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenter);
  }
}

export function activate(context: vscode.ExtensionContext): void {
  process.env.NoDefaultCurrentDirectoryInExePath = "1";
  try {
    setShellIfWindows();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    void vscode.window.showErrorMessage(message);
  }

  const provider = new CodingMaidViewProvider(context);
  context.subscriptions.push(provider);
  context.subscriptions.push(vscode.window.registerWebviewViewProvider(CodingMaidViewProvider.viewType, provider));
  context.subscriptions.push(
    vscode.commands.registerCommand("codingmaid.openView", async () => {
      await vscode.commands.executeCommand("workbench.view.extension.codingmaid");
      await vscode.commands.executeCommand("codingmaid.chatView.focus");
    })
  );
}

export function deactivate(): void {
  // no-op
}

function getNonce(): string {
  let text = "";
  const possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  for (let i = 0; i < 32; i += 1) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}
