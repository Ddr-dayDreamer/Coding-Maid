/**
 * Coding Maid Webview — 入口
 *
 * 由 esbuild 打包为 resources/webview/bundle.js
 * webview.html 加载此 bundle
 */

import { vscode, state, history } from "./state";
import type { ProcessInfo } from "./types";
import type { BackendMessage, SessionMessageData } from "./types";
import { setWorkspaceRoot } from "./utils/formatting";
import { initComposer, setLoading, initAttachmentManager } from "./components/composer";
import { updateContextMeter } from "./components/context-meter";
import { initSessionList, updateSessionDropdown, updateSessionTitle } from "./components/session-list";
import {
  addMessageBubble,
  clearMessages,
  updateLoadingText,
  renderAskUserQuestion,
  updateAllConnectionLines,
  appendStreamChunk,
  clearStreamState,
} from "./components/chat-view";

// ─── 入口 ────────────────────────────────────────────────

let loadingTimer: ReturnType<typeof setInterval> | null = null;

function init(): void {
  // 设置工作区路径（从 HTML 中的全局变量读取）
  const root = ((window as unknown as Record<string, unknown>).workspaceRoot as string) || "";
  setWorkspaceRoot(root);

  // 初始化组件
  initComposer();
  initAttachmentManager();
  initSessionList();

  // 监听后端消息
  window.addEventListener("message", handleMessage);

  // 事件代理：回退按钮点击（避免闭包问题）
  $.messages.addEventListener("click", (e) => {
    const target = e.target as HTMLElement;
    const btn = target.closest(".bubble-undo-btn") as HTMLElement | null;
    if (!btn) return;

    const sessionId = btn.dataset.sessionId;
    const messageId = btn.dataset.messageId;
    if (sessionId && messageId) {
      vscode.postMessage({ type: "restoreSession", sessionId, messageId });
    }
  });

  // 报告就绪
  vscode.postMessage({ type: "ready" });
}

// ─── 工具函数 ────────────────────────────────────────────

/** 将 ProcessInfo[] 转为 state 所需的 Record 格式 */
function normalizeProcesses(
  processes: ProcessInfo[] | null | undefined
): Record<string, { startTime: string; command: string }> | null {
  if (!processes || processes.length === 0) return null;
  const record: Record<string, { startTime: string; command: string }> = {};
  for (const p of processes) {
    record[String(p.pid)] = { startTime: p.startTime, command: p.command };
  }
  return record;
}

// ─── 消息处理 ────────────────────────────────────────────

function handleMessage(event: MessageEvent): void {
  const msg = event.data as BackendMessage;

  switch (msg.type) {
    case "initializeEmpty":
      handleInitializeEmpty(msg);
      break;
    case "loadSession":
      handleLoadSession(msg);
      break;
    case "showSessionsList":
      updateSessionDropdown(msg.sessions);
      break;
    case "sessionStatus":
      handleSessionStatus(msg);
      break;
    case "userMessage":
      handleUserMessage(msg.content);
      break;
    case "assistant":
      handleAssistantMessage(msg.html);
      break;
    case "appendMessage":
      handleAppendMessage(msg);
      break;
    case "loading":
      setLoading(msg.value);
      if (!msg.value) stopLoadingTimer();
      break;
    case "llmStreamProgress":
      state.currentLlmStreamProgress = msg.progress;
      break;
    case "streamChunk":
      appendStreamChunk(msg.content, msg.reasoningContent);
      break;
  }
}

// ─── 各消息类型处理 ─────────────────────────────────────

function handleInitializeEmpty(msg: BackendMessage & { type: "initializeEmpty" }): void {
  clearMessages();
  clearStreamState();
  state.currentSessionId = null;
  state.currentSessionStatus = msg.status;
  state.currentTokenTelemetry = msg.tokenTelemetry ?? null;
  updateSessionTitle("New Chat");
  updateSessionDropdown(msg.sessions);
  updateContextMeter(state.currentTokenTelemetry);
}

function handleLoadSession(msg: BackendMessage & { type: "loadSession" }): void {
  clearMessages();
  clearStreamState();
  state.currentSessionId = msg.sessionId;
  state.currentSessionStatus = msg.status;
  state.currentTokenTelemetry = msg.tokenTelemetry ?? null;
  state.currentRunningProcesses = normalizeProcesses(msg.processes);

  updateSessionTitle(msg.summary || "Chat");
  updateSessionDropdown(msg.sessions);
  updateContextMeter(state.currentTokenTelemetry);
  hideEmptyNewChat();

  // 按顺序渲染所有消息
  let prevShouldConnect = false;
  for (const m of msg.messages) {
    renderMessage(m, prevShouldConnect);
    prevShouldConnect = m.visible !== false;
  }

  requestAnimationFrame(() => updateAllConnectionLines());
}

function handleSessionStatus(msg: BackendMessage & { type: "sessionStatus" }): void {
  state.currentSessionStatus = msg.status;
  state.currentRunningProcesses = normalizeProcesses(msg.processes);
  state.currentTokenTelemetry = msg.tokenTelemetry ?? null;

  updateContextMeter(state.currentTokenTelemetry);

  if (msg.status === "completed" || msg.status === "interrupted" || msg.status === "failed") {
    setLoading(false);
    stopLoadingTimer();
  } else if (msg.status === "processing") {
    setLoading(true);
    startLoadingTimer();
  }

  // waiting_for_user 时启用表单
  if (msg.status === "waiting_for_user") {
    document
      .querySelectorAll(".ask-user-form input, .ask-user-form textarea, .ask-user-form button")
      .forEach((el) => ((el as HTMLInputElement).disabled = false));
  }
}

function handleUserMessage(content: string): void {
  // 记录到历史
  history.inputHistory.push(content);
  history.lastRecordText = content;
  history.lastRecordAt = Date.now();

  // 显示用户气泡
  const msg: SessionMessageData = {
    id: `user-${Date.now()}`,
    sessionId: state.currentSessionId || "",
    role: "user",
    content,
    visible: true,
  };
  addMessageBubble(msg, false);
  hideEmptyNewChat();

  setLoading(true);
  startLoadingTimer();
}

function handleAssistantMessage(html: string): void {
  const msg: SessionMessageData = {
    id: `assistant-${Date.now()}`,
    sessionId: state.currentSessionId || "",
    role: "assistant",
    content: html,
    visible: true,
  };
  addMessageBubble(msg, true);
}

function handleAppendMessage(msg: BackendMessage & { type: "appendMessage" }): void {
  // 收到最终消息，清除流式状态（后续会用完整渲染的 HTML 替换流式气泡）
  clearStreamState();

  const message = msg.message;

  // 用户消息：后端返回了真实数据（含 checkpointHash），更新前端已有气泡
  if (message.role === "user") {
    // 找到最后一个用户气泡，更新其 dataset（使用后端真实 id 和 checkpointHash）
    const bubbles = $.messages.querySelectorAll(".bubble-user");
    const lastUserBubble = bubbles[bubbles.length - 1] as HTMLElement | undefined;
    if (lastUserBubble) {
      lastUserBubble.dataset.messageId = message.id;
      // 补上回退按钮（只要还没有就加，按钮点击由后端验证 checkpointHash）
      if (!lastUserBubble.querySelector(".bubble-undo-btn")) {
        const body = lastUserBubble.querySelector(".bubble-body");
        if (body) {
          const undoBtn = document.createElement("button");
          undoBtn.className = "bubble-undo-btn";
          undoBtn.dataset.sessionId = message.sessionId;
          undoBtn.dataset.messageId = message.id;
          undoBtn.textContent = "↩ 回退到此";
          undoBtn.title = "回退到此消息，撤消后续的对话和文件变更";
          undoBtn.addEventListener("click", function (this: HTMLElement) {
            vscode.postMessage({
              type: "restoreSession",
              sessionId: this.dataset.sessionId || "",
              messageId: this.dataset.messageId || "",
            });
          });
          body.appendChild(undoBtn);
        }
      }
    }
    return;
  }

  renderMessage(message, msg.shouldConnect);

  // 如果是 tool message 且是 AskUserQuestion → 渲染表单
  if (message.role === "tool" && message.content) {
    try {
      const parsed = JSON.parse(message.content) as { awaitUserResponse?: boolean; metadata?: { kind?: string } };
      if (parsed.awaitUserResponse || parsed.metadata?.kind === "ask_user_question") {
        renderAskUserQuestion(message, msg.shouldConnect);
      }
    } catch {
      // ignore
    }
  }
}

// ─── 辅助 ────────────────────────────────────────────────

function renderMessage(message: SessionMessageData, shouldConnect: boolean): void {
  if (message.visible === false) return;
  addMessageBubble(message, shouldConnect);
}

function hideEmptyNewChat(): void {
  // 隐藏空状态提示
  // 后续可加
}

function startLoadingTimer(): void {
  if (loadingTimer) return;
  loadingTimer = setInterval(() => {
    updateLoadingText();
  }, 1000);
}

function stopLoadingTimer(): void {
  if (loadingTimer) {
    clearInterval(loadingTimer);
    loadingTimer = null;
  }
}

// ─── DOM Ready 启动 ──────────────────────────────────────

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
