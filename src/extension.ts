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
  type LlmStreamProgress,
  type SessionEntry,
  type UserPromptContent,
} from "./session";
import {
  resolveSettingsWithCryptoKey,
  ensureInitialConfig,
  type ReasoningEffort,
  type ResolvedSettings,
} from "./settings";
import {
  listProfiles,
  loadProfile,
  saveProfile,
  deleteProfile,
  renameProfile,
  setActiveProfile,
  getActiveProfile,
  createProfileFromTemplate,
  type ConnectionProfile,
} from "./common/connection-profiles";
import { getActivePreset, setActivePreset } from "./common/global-settings";
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
  private readonly templatesDir: string;

  /** 消息路由表 */
  private readonly handlers = new Map<string, (message: Record<string, unknown>) => Promise<void>>();

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
        if (!this.webviewView) return;
        if (message.visible === false) return;
        if (message.role !== "tool") {
          const reasoningContent = (message.messageParams as ReasoningMessageParams | null)?.reasoning_content;
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
      onLlmStreamProgress: (progress: LlmStreamProgress) => {
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
      onDebugPrompt: (messages: ChatCompletionMessageParam[], iteration: number) => {
        this.debugOutputChannel.clear();
        this.debugOutputChannel.appendLine("=".repeat(80));
        this.debugOutputChannel.appendLine(
          `[Coding Maid Debug] Iteration: ${iteration}`
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

    // 注册消息处理器
    this.registerHandler("ready", async () => this.loadInitialSession());
    this.registerHandler("userPrompt", this.handleUserPromptMsg);
    this.registerHandler("interrupt", async () => this.sessionManager.interruptActiveSession());
    this.registerHandler("createNewSession", async () => this.createNewSession());
    this.registerHandler("selectSession", this.handleSelectSession);
    this.registerHandler("backToList", async () => this.showSessionsList());
    this.registerHandler("openFile", this.handleOpenFile);
    this.registerHandler("deleteSession", this.handleDeleteSessionMsg);
    this.registerHandler("restoreSession", this.handleRestoreSessionMsg);

    // 预设管理
    this.registerHandler("listPresets", this.handleListPresets);
    this.registerHandler("getPreset", this.handleGetPreset);
    this.registerHandler("savePreset", this.handleSavePreset);
    this.registerHandler("deletePreset", this.handleDeletePreset);
    this.registerHandler("selectPreset", this.handleSelectPreset);
    this.registerHandler("getActivePreset", this.handleGetActivePreset);
    this.registerHandler("exportPreset", this.handleExportPreset);
    this.registerHandler("importPreset", this.handleImportPreset);

    // 连接配置管理
    this.registerHandler("listProfiles", this.handleListProfiles);
    this.registerHandler("getProfile", this.handleGetProfile);
    this.registerHandler("saveProfile", this.handleSaveProfile);
    this.registerHandler("deleteProfile", this.handleDeleteProfile);
    this.registerHandler("selectProfile", this.handleSelectProfile);
    this.registerHandler("testConnection", this.handleTestConnection);
    this.registerHandler("openProfileFile", this.handleOpenProfileFile);
    this.registerHandler("createProfile", this.handleCreateProfile);
    this.registerHandler("renameProfile", this.handleRenameProfile);

    this.initCryptoKey();
    this.templatesDir = path.join(this.context.extensionUri.fsPath, "templates");
    const templatesDir = this.templatesDir;
    ensureInitialConfig(templatesDir, this.getCryptoKey());
    void this.initializeMcpServers();
  }

  dispose(): void {
    this.sessionManager.dispose();
    this.debugOutputChannel.dispose();
  }

  // ═══════════════════════════════════════════════════════
  //  消息路由
  // ═══════════════════════════════════════════════════════

  private registerHandler(type: string, handler: (msg: Record<string, unknown>) => Promise<void>): void {
    this.handlers.set(type, handler);
  }

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
        // 如果是 requestId 请求，返回错误响应
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

  private async loadInitialSession(): Promise<void> {
    const sessions = this.sessionManager.listSessions();
    const sessionsList = sessions.map((s) => ({
      id: s.id,
      summary: s.summary || "Untitled",
      createTime: s.createTime,
      updateTime: s.updateTime,
      status: s.status,
    }));
    const globalSettings = this.resolveCurrentSettings();

    if (sessions.length === 0) {
      // 没有历史会话，显示新对话界面
      this.sendMessage({
        type: "initializeEmpty",
        sessions: sessionsList,
        status: null,
        tokenTelemetry: this.buildTokenTelemetry(null),
        activePreset: globalSettings.activePreset,
        activeProfile: globalSettings.profileName,
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
    const globalSettings = this.resolveCurrentSettings();

    // 发送对话信息到 webview
    this.sendMessage({
      type: "loadSession",
      sessionId,
      summary: session.summary || "Untitled",
      status: session.status,
      processes: this.serializeProcesses(session.processes),
      tokenTelemetry: this.buildTokenTelemetry(session),
      sessions: sessionsList,
      activePreset: globalSettings.activePreset,
      activeProfile: globalSettings.profileName,
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
    const globalSettings = this.resolveCurrentSettings();

    // 回到空对话界面
    this.sendMessage({
      type: "initializeEmpty",
      sessions: sessionsList,
      status: null,
      tokenTelemetry: this.buildTokenTelemetry(null),
      activePreset: globalSettings.activePreset,
      activeProfile: globalSettings.profileName,
    });
  }

  private async handleRestoreSession(sessionId: string, messageId: string): Promise<void> {
    // 先中断当前处理（如果有），避免与 LLM 循环竞争
    this.sessionManager.interruptSession(sessionId);

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
    const globalSettings = this.resolveCurrentSettings();

    this.sendMessage({
      type: "initializeEmpty",
      sessions: sessionsList,
      status: null,
      tokenTelemetry: this.buildTokenTelemetry(null),
      activePreset: globalSettings.activePreset,
      activeProfile: globalSettings.profileName,
    });
  }

  private sendMessage(message: unknown): void {
    if (!this.webviewView) {
      return;
    }
    this.webviewView.webview.postMessage(message);
  }

  // ═══════════════════════════════════════════════════════
  //  消息处理器
  // ═══════════════════════════════════════════════════════

  private handleUserPromptMsg = async (message: Record<string, unknown>): Promise<void> => {
    const prompt = String(message.prompt || "").trim();
    if (!prompt) return;
    await this.handlePrompt(prompt);
  };

  private handleSelectSession = async (message: Record<string, unknown>): Promise<void> => {
    const sessionId = String(message.sessionId || "").trim();
    if (sessionId) this.loadSession(sessionId);
  };

  private handleOpenFile = async (message: Record<string, unknown>): Promise<void> => {
    const filePath = String(message.filePath || "").trim();
    const line = Number(message.line || 1);
    if (filePath) await this.openFileInEditor(filePath, line);
  };

  private handleDeleteSessionMsg = async (message: Record<string, unknown>): Promise<void> => {
    const sessionId = String(message.sessionId || "").trim();
    if (sessionId) await this.handleDeleteSession(sessionId);
  };

  private handleRestoreSessionMsg = async (message: Record<string, unknown>): Promise<void> => {
    const sessionId = String(message.sessionId || "").trim();
    const messageId = String(message.messageId || "").trim();
    if (sessionId && messageId) await this.handleRestoreSession(sessionId, messageId);
  };

  private handlePrompt(prompt: string): Promise<void> {
    return this._handlePromptWithImages(prompt, []);
  }

  private async _handlePromptWithImages(prompt: string, imageUrls: string[]): Promise<void> {
    if (!this.webviewView) return;

    const webview = this.webviewView.webview;
    const displayPrompt = prompt || (imageUrls.length > 0 ? "粘贴的图像" : "");
    webview.postMessage({ type: "userMessage", content: displayPrompt });
    webview.postMessage({ type: "loading", value: true });

    try {
      const userPrompt: UserPromptContent = { text: prompt, imageUrls };
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

      const sessions = this.sessionManager.listSessions();
      const sessionsList = sessions.map((s) => ({
        id: s.id,
        summary: s.summary || "Untitled",
        createTime: s.createTime,
        updateTime: s.updateTime,
        status: s.status,
      }));
      webview.postMessage({ type: "showSessionsList", sessions: sessionsList });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      webview.postMessage({ type: "assistant", html: this.md.render(`Request failed: ${msg}`) });
    } finally {
      webview.postMessage({ type: "loading", value: false });
    }
  }

  // ═══════════════════════════════════════════════════════
  //  预设处理器
  // ═══════════════════════════════════════════════════════

  private handleListPresets = async (message: Record<string, unknown>): Promise<void> => {
    const presets = this.sessionManager.presetMgr.listPresets();
    const data = presets.map((p) => ({ name: p.name, displayName: p.displayName, description: p.description }));
    this.respond(message.requestId as string, true, data);
  };

  private handleGetPreset = async (message: Record<string, unknown>): Promise<void> => {
    const name = String(message.name || "").trim();
    if (!name) { this.respond(message.requestId as string, false, undefined, "缺少预设名称"); return; }
    const def = this.sessionManager.presetMgr.loadPreset(name);
    this.respond(message.requestId as string, true, def);
  };

  private handleSavePreset = async (message: Record<string, unknown>): Promise<void> => {
    const name = String(message.name || "").trim();
    if (!name || !message.definition) { this.respond(message.requestId as string, false, undefined, "缺少预设名称或定义"); return; }
    this.sessionManager.presetMgr.savePreset(name, message.definition as any);
    this.respond(message.requestId as string, true);
  };

  private handleDeletePreset = async (message: Record<string, unknown>): Promise<void> => {
    const name = String(message.name || "").trim();
    if (!name) { this.respond(message.requestId as string, false, undefined, "缺少预设名称"); return; }
    this.sessionManager.presetMgr.deletePreset(name);
    this.respond(message.requestId as string, true);
  };

  private handleSelectPreset = async (message: Record<string, unknown>): Promise<void> => {
    const name = String(message.name || "").trim();
    if (!name) { this.respond(message.requestId as string, false, undefined, "缺少预设名称"); return; }
    setActivePreset(name);
    this.respond(message.requestId as string, true);
  };

  private handleGetActivePreset = async (message: Record<string, unknown>): Promise<void> => {
    const name = getActivePreset();
    this.respond(message.requestId as string, true, { name });
  };

  private handleExportPreset = async (message: Record<string, unknown>): Promise<void> => {
    const name = String(message.name || "").trim();
    if (!name) { this.respond(message.requestId as string, false, undefined, "缺少预设名称"); return; }

    const defaultUri = vscode.Uri.file(`${name}.json`);
    const uri = await vscode.window.showSaveDialog({
      defaultUri,
      filters: { "Preset JSON": ["json"] },
      title: "导出预设",
    });
    if (!uri) { this.respond(message.requestId as string, true); return; } // 用户取消

    this.sessionManager.presetMgr.exportPreset(name, uri.fsPath);
    this.respond(message.requestId as string, true);
  };

  private handleImportPreset = async (message: Record<string, unknown>): Promise<void> => {
    const uris = await vscode.window.showOpenDialog({
      canSelectMany: false,
      filters: { "Preset JSON": ["json"] },
      title: "导入预设",
    });
    if (!uris || uris.length === 0) { this.respond(message.requestId as string, true); return; } // 用户取消

    const def = this.sessionManager.presetMgr.importPreset(uris[0].fsPath);
    this.respond(message.requestId as string, true, def);
  };

  // ═══════════════════════════════════════════════════════
  //  连接配置处理器
  // ═══════════════════════════════════════════════════════

  private handleListProfiles = async (message: Record<string, unknown>): Promise<void> => {
    const names = listProfiles();
    const profilesDir = path.join(os.homedir(), ".codingmaid", "profiles");
    const items = names.map((name) => {
      const safeName = name.replace(/[^a-zA-Z0-9_\-\u4e00-\u9fff]+/g, "_");
      return { name, filePath: path.join(profilesDir, `${safeName}.json`) };
    });
    this.respond(message.requestId as string, true, items);
  };

  private handleGetProfile = async (message: Record<string, unknown>): Promise<void> => {
    const name = String(message.name || "").trim();
    if (!name) { this.respond(message.requestId as string, false, undefined, "缺少配置名称"); return; }
    const cryptoKey = this.getCryptoKey();
    const profile = loadProfile(name, cryptoKey);
    if (!profile) { this.respond(message.requestId as string, false, undefined, `配置 "${name}" 未找到`); return; }
    // 不返回 apiKey（保密）
    const { apiKey, ...safe } = profile;
    this.respond(message.requestId as string, true, safe);
  };

  private handleSaveProfile = async (message: Record<string, unknown>): Promise<void> => {
    const profile = message.profile as ConnectionProfile | undefined;
    if (!profile?.name) { this.respond(message.requestId as string, false, undefined, "缺少配置信息"); return; }
    const cryptoKey = this.getCryptoKey();
    saveProfile(profile, cryptoKey);
    this.respond(message.requestId as string, true);
  };

  private handleDeleteProfile = async (message: Record<string, unknown>): Promise<void> => {
    const name = String(message.name || "").trim();
    if (!name) { this.respond(message.requestId as string, false, undefined, "缺少配置名称"); return; }
    deleteProfile(name);
    this.respond(message.requestId as string, true);
  };

  private handleSelectProfile = async (message: Record<string, unknown>): Promise<void> => {
    const name = String(message.name || "").trim();
    if (!name) return;
    setActiveProfile(name);
    // 重新初始化 MCP 服务器（配置可能变了）
    void this.initializeMcpServers();
    this.respond(message.requestId as string, true);
  };

  private handleTestConnection = async (message: Record<string, unknown>): Promise<void> => {
    const name = String(message.name || "").trim();
    if (!name) { this.respond(message.requestId as string, false, undefined, "缺少配置名称"); return; }

    const cryptoKey = this.getCryptoKey();
    const profile = loadProfile(name, cryptoKey);
    if (!profile) { this.respond(message.requestId as string, false, undefined, `配置 "${name}" 未找到`); return; }
    if (!profile.apiKey) { this.respond(message.requestId as string, false, undefined, "API Key 未设置"); return; }

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
        { signal: controller.signal }
      );

      clearTimeout(timeout);

      this.respond(message.requestId as string, true, {
        success: true,
        model: response.model,
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.respond(message.requestId as string, false, undefined, msg);
    }
  };

  private handleOpenProfileFile = async (message: Record<string, unknown>): Promise<void> => {
    const name = String(message.name || "").trim();
    if (!name) { this.respond(message.requestId as string, false, undefined, "缺少配置名称"); return; }

    const profilesDir = path.join(os.homedir(), ".codingmaid", "profiles");
    const safeName = name.replace(/[^a-zA-Z0-9_\-\u4e00-\u9fff]+/g, "_");
    const filePath = path.join(profilesDir, `${safeName}.json`);

    if (!fs.existsSync(filePath)) {
      this.respond(message.requestId as string, false, undefined, `配置文件 "${name}" 不存在`);
      return;
    }

    await this.openFileInEditor(filePath, 1);
    this.respond(message.requestId as string, true);
  };

  private handleCreateProfile = async (message: Record<string, unknown>): Promise<void> => {
    const name = String(message.name || "new-profile").trim();
    if (!name) { this.respond(message.requestId as string, false, undefined, "缺少配置名称"); return; }
    const cryptoKey = this.getCryptoKey();
    const profile = createProfileFromTemplate(name, this.templatesDir, cryptoKey);
    const profilesDir = path.join(os.homedir(), ".codingmaid", "profiles");
    const safeName = name.replace(/[^a-zA-Z0-9_\-\u4e00-\u9fff]+/g, "_");
    this.respond(message.requestId as string, true, {
      name: profile.name,
      filePath: path.join(profilesDir, `${safeName}.json`),
    });
  };

  private handleRenameProfile = async (message: Record<string, unknown>): Promise<void> => {
    const oldName = String(message.oldName || "").trim();
    const newName = String(message.newName || "").trim();
    if (!oldName || !newName) { this.respond(message.requestId as string, false, undefined, "缺少配置名称"); return; }
    if (oldName === newName) { this.respond(message.requestId as string, true); return; }
    const success = renameProfile(oldName, newName);
    if (!success) {
      this.respond(message.requestId as string, false, undefined, `重命名失败（目标 "${newName}" 可能已存在）`);
      return;
    }

    // 如果重命名的是当前激活配置，更新 activeProfile
    const activeName = getActiveProfile(this.getCryptoKey())?.name;
    if (activeName === oldName) {
      setActiveProfile(newName);
    }

    this.respond(message.requestId as string, true);
  };

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
    contextLimit: number;
    usage: unknown | null;
    lastUsage: unknown | null;
  } {
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

  private resolveCurrentSettings(): ResolvedSettings {
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
    const bundleJsPath = vscode.Uri.joinPath(this.context.extensionUri, "resources", "webview", "bundle.js");
    const bundleCssPath = vscode.Uri.joinPath(this.context.extensionUri, "resources", "webview", "bundle.css");
    const bundleJsUri = webview.asWebviewUri(bundleJsPath);

    html = html.replace(/\{\{nonce\}\}/g, nonce);
    html = html.replace(/\{\{cspSource\}\}/g, csp);
    html = html.replace(/\{\{cssUri\}\}/g, cssUri.toString());
    const bundleCssUri = webview.asWebviewUri(bundleCssPath);
    html = html.replace(/\{\{bundleJsUri\}\}/g, bundleJsUri.toString());
    html = html.replace(/\{\{bundleCssUri\}\}/g, bundleCssUri.toString());
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
