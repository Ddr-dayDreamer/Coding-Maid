/**
 * Coding Maid Webview — Svelte 5 入口
 *
 * 挂载根组件 App.svelte
 */

import { mount } from "svelte";
import App from "./App.svelte";
import { api } from "./lib/api";
import { appState } from "./lib/state.svelte";
import { notify } from "./lib/notification.svelte";
import type { SessionMessageData } from "./types";

// ─── 启动 ────────────────────────────────────────────────

function renderError(msg: string) {
  const app = document.getElementById("app");
  if (app) {
    app.innerHTML = `<div style="padding:20px;color:red;"><h3>启动失败</h3><pre>${msg}</pre></div>`;
  }
}

try {
  const target = document.getElementById("app");
  if (!target) {
    renderError('找不到 #app 挂载点');
  } else {
    mount(App, { target });
  }
} catch (e) {
  renderError(String(e));
}

// ─── 后端消息处理 ────────────────────────────────────────

window.addEventListener("message", (event: MessageEvent) => {
  const msg = api.handleMessage(event);
  if (!msg) return;

  switch (msg.type) {
    case "initializeEmpty":
      appState.messages = [];
      appState.currentSessionId = null;
      appState.currentSessionStatus = msg.status;
      appState.tokenTelemetry = msg.tokenTelemetry ?? null;
      appState.sessions = msg.sessions;
      appState.activePreset = msg.activePreset ?? "default";
      appState.activeProfile = msg.activeProfile ?? "default";
      appState.attachedFiles = [];
      break;

    case "loadSession":
      appState.messages = msg.messages.filter((m) => m.visible !== false);
      appState.currentSessionId = msg.sessionId;
      appState.currentSessionStatus = msg.status;
      appState.isLoading = false;
      appState.tokenTelemetry = msg.tokenTelemetry ?? null;
      appState.runningProcesses = normalizeProcesses(msg.processes);
      appState.sessions = msg.sessions;
      appState.activePreset = msg.activePreset ?? "default";
      appState.activeProfile = msg.activeProfile ?? "default";
      if (appState.pendingRollback) {
        appState.pendingRollback = false;
        notify.success("已回退到此");
      }
      break;

    case "showSessionsList":
      appState.sessions = msg.sessions;
      break;

    case "attachedFilesCleared":
      appState.attachedFiles = [];
      break;

    case "sessionStatus":
      appState.currentSessionStatus = msg.status;
      appState.runningProcesses = normalizeProcesses(msg.processes);
      appState.tokenTelemetry = msg.tokenTelemetry ?? null;
      if (msg.status === "completed" || msg.status === "interrupted" || msg.status === "failed") {
        appState.isLoading = false;
      } else if (msg.status === "processing") {
        appState.isLoading = true;
      }
      break;

    case "userMessage":
      appState.inputHistory = [...appState.inputHistory, msg.content];
      appState.lastPrompt = msg.content;
      appState.messages = [
        ...appState.messages,
        {
          id: `user-${Date.now()}`,
          sessionId: appState.currentSessionId ?? "",
          role: "user",
          content: msg.content,
          visible: true,
        } as SessionMessageData,
      ];
      appState.isLoading = true;
      break;

    case "assistant":
      appState.messages = [
        ...appState.messages,
        {
          id: `assistant-${Date.now()}`,
          sessionId: appState.currentSessionId ?? "",
          role: "assistant",
          content: msg.html,
          visible: true,
        } as SessionMessageData,
      ];
      break;

    case "appendMessage":
      clearStreamState();
      handleAppendMessage(msg.message);
      break;

    case "loading":
      appState.isLoading = msg.value;
      break;

    case "llmStreamProgress":
      appState.llmStreamProgress = msg.progress;
      break;

    case "streamChunk":
      handleStreamChunk(msg.content ?? "", msg.reasoningContent ?? "");
      break;

    case "notify":
      notify[msg.level](msg.text, msg.duration);
      break;

    case "approvalConfig":
      appState.approvalConfig = msg.config;
      break;
  }
});

// ─── 工具函数 ────────────────────────────────────────────

function normalizeProcesses(
  processes?: { pid: number; command: string; startTime: string }[] | null
): Record<string, { startTime: string; command: string }> | null {
  if (!processes || processes.length === 0) return null;
  const record: Record<string, { startTime: string; command: string }> = {};
  for (const p of processes) {
    record[String(p.pid)] = { startTime: p.startTime, command: p.command };
  }
  return record;
}

function handleAppendMessage(message: SessionMessageData): void {
  if (message.role === "user") {
    // 用后端真实数据更新最后一个用户消息
    appState.messages = appState.messages.map((m, i) => {
      const isLastUser = m.role === "user" && i === appState.messages.length - 1;
      return isLastUser ? { ...message, visible: true } : m;
    });
  } else if (message.visible !== false) {
    appState.messages = [...appState.messages, message];
  }
}

function clearStreamState(): void {
  appState.streamingContent = "";
  appState.streamingReasoning = "";
}

function handleStreamChunk(content: string, reasoningContent: string): void {
  if (content) appState.streamingContent += content;
  if (reasoningContent) appState.streamingReasoning += reasoningContent;
}

// 报告就绪
api.send("ready");
