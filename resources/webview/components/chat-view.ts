import { $, state, vscode } from "../state";
import type { SessionMessageData } from "../types";
import { formatDisplayPath } from "../utils/formatting";

// ─── 添加消息气泡 ────────────────────────────────────────

export function addMessageBubble(msg: SessionMessageData, shouldConnect?: boolean): void {
  const content = msg.content ?? "";
  const role = msg.role;
  const meta = msg.meta || {};

  // 不可见消息跳过
  if (msg.visible === false) return;

  // 构建气泡 HTML
  const bubble = document.createElement("div");
  bubble.className = `bubble bubble-${role}`;
  bubble.dataset.messageId = msg.id;

  // 决定是否折叠
  const isCollapsible = role === "system" || (role === "assistant" && meta.asThinking === true) || role === "tool";
  const isThinking = role === "assistant" && meta.asThinking === true;
  const isSkillBubble = !!(role === "system" && meta.skill);
  const defaultExpanded = false;

  // 头像点（用户消息右对齐，不画连接线）
  const showConnect = shouldConnect && role !== "user";
  const dot = document.createElement("div");
  dot.className = `bubble-dot${showConnect ? " connect-to-prev" : ""}`;
  bubble.appendChild(dot);

  // 内容区域
  const body = document.createElement("div");
  body.className = "bubble-body";
  bubble.appendChild(body);

  if (isCollapsible) {
    // 对于 thinking 消息，content 通常为 null，需要用后端预渲染的 HTML
    const displayContent = isThinking ? (msg.html ?? content) : content;
    renderCollapsibleContent(body, displayContent, role, meta, defaultExpanded, isThinking, isSkillBubble, msg.html);
  } else {
    // 普通内容（user / 普通 assistant）
    const contentDiv = document.createElement("div");
    contentDiv.className = "bubble-normal-content";
    if (role === "user") {
      contentDiv.textContent = content;
      // 有 checkpoint 的用户消息 → 显示回退按钮
      if (msg.checkpointHash) {
        const undoBtn = document.createElement("button");
        undoBtn.className = "bubble-undo-btn";
        undoBtn.dataset.sessionId = msg.sessionId;
        undoBtn.dataset.messageId = msg.id;
        undoBtn.textContent = "↩ 回退到此";
        undoBtn.title = "回退到此消息，撤消后续的对话和文件变更";
        // 直接绑定点击（用 function 而非箭头函数，this = 按钮元素）
        undoBtn.addEventListener("click", function (this: HTMLElement) {
          vscode.postMessage({
            type: "restoreSession",
            sessionId: this.dataset.sessionId || "",
            messageId: this.dataset.messageId || "",
          });
        });
        body.appendChild(undoBtn);
      }
    } else {
      // assistant 的 HTML 是后端预渲染的 → 优先使用 msg.html
      contentDiv.innerHTML = msg.html ?? content;
    }
    body.appendChild(contentDiv);
  }

  $.messages.appendChild(bubble);
  state.lastMessageRole = role;

  // 滚动到底部
  scrollToBottom();

  // 更新连接线
  if (shouldConnect) {
    requestAnimationFrame(() => updateAllConnectionLines());
  }
}

// ─── 折叠内容渲染 ────────────────────────────────────────

function renderCollapsibleContent(
  body: HTMLElement,
  content: string,
  role: string,
  meta: Record<string, unknown>,
  defaultExpanded: boolean,
  isThinking: boolean,
  isSkillBubble: boolean,
  rawHtml?: string
): void {
  const header = document.createElement("div");
  header.className = "bubble-collapsible-header";

  const toggle = document.createElement("span");
  toggle.className = "bubble-toggle";
  toggle.textContent = defaultExpanded ? "▼" : "▶";
  header.appendChild(toggle);

  // 标题文本
  const title = document.createElement("span");
  if (isSkillBubble) {
    title.textContent = `🧠 ${meta.skill as string}`;
  } else if (isThinking) {
    title.textContent = "思考中...";
  } else if (role === "tool") {
    const paramsMd = meta.paramsMd as string;
    title.textContent = `🔧 ${paramsMd || "工具调用"}`;
  } else if (role === "system") {
    title.textContent = "系统消息";
  }
  header.appendChild(title);

  body.appendChild(header);

  const contentDiv = document.createElement("div");
  contentDiv.className = "bubble-collapsible-content";
  contentDiv.style.display = defaultExpanded ? "block" : "none";

  if (role === "tool") {
    renderToolContent(contentDiv, content, meta);
  } else if (isThinking) {
    // 优先使用后端预渲染的 HTML，否则纯文本
    if (rawHtml) {
      contentDiv.innerHTML = rawHtml;
    } else {
      contentDiv.textContent = content;
    }
  } else if (role === "system") {
    contentDiv.textContent = content;
  } else {
    contentDiv.innerHTML = content;
  }

  body.appendChild(contentDiv);

  // 点击切换
  header.addEventListener("click", () => {
    const isNowExpanded = contentDiv.style.display !== "none";
    contentDiv.style.display = isNowExpanded ? "none" : "block";
    toggle.textContent = isNowExpanded ? "▶" : "▼";
    requestAnimationFrame(() => updateAllConnectionLines());
  });
}

// ─── 工具内容渲染 ────────────────────────────────────────

function renderToolContent(container: HTMLElement, content: string, meta: Record<string, unknown>): void {
  const resultMd = meta.resultMd as string;

  // 显示结果摘要
  if (resultMd) {
    const resultEl = document.createElement("div");
    resultEl.className = "tool-result-snippet";
    resultEl.textContent = resultMd.length > 500 ? resultMd.slice(0, 500) + "..." : resultMd;
    container.appendChild(resultEl);
  }

  // 尝试解析结构化的工具结果
  try {
    const parsed = JSON.parse(content) as Record<string, unknown>;
    if (parsed.metadata && typeof parsed.metadata === "object") {
      const md = parsed.metadata as Record<string, unknown>;
      // 文件路径
      if (md.file_path) {
        const pathEl = document.createElement("div");
        pathEl.className = "tool-file-path";
        pathEl.textContent = `📄 ${formatDisplayPath(md.file_path as string)}`;
        container.appendChild(pathEl);
      }
      // diff 预览
      if (md.diff_preview) {
        const diffEl = document.createElement("div");
        diffEl.className = "tool-diff-preview";
        diffEl.textContent = md.diff_preview as string;
        container.appendChild(diffEl);
      }
    }
  } catch {
    // 不是 JSON，忽略
  }
}

// ─── 连接线 ──────────────────────────────────────────────

export function updateAllConnectionLines(): void {
  document.querySelectorAll(".bubble-dot.connect-to-prev").forEach((dot) => {
    const dotEl = dot as HTMLElement;
    const bubble = dotEl.closest(".bubble") as HTMLElement | null;
    if (!bubble) return;

    const prev = bubble.previousElementSibling as HTMLElement | null;
    if (!prev) return;

    const prevDot = prev.querySelector(".bubble-dot") as HTMLElement | null;
    if (!prevDot) return;

    const prevRect = prevDot.getBoundingClientRect();
    const thisRect = dotEl.getBoundingClientRect();
    const height = thisRect.top - prevRect.bottom;
    dotEl.style.setProperty("--connector-height", `${Math.max(0, height)}px`);
  });
}

// ─── 滚动 ────────────────────────────────────────────────

function scrollToBottom(): void {
  $.messages.scrollTop = $.messages.scrollHeight;
}

// ─── 流式内容更新 ────────────────────────────────────────

/** 当前的流式消息气泡（正在出字的 assistant） */
let streamBubble: HTMLElement | null = null;
/** 流式内容的完整累积文本 */
let streamContent = "";
/** 是否有流式更新的 reasoning 待显示 */
let streamReasoningContent = "";

/**
 * 接收一段流式增量，追加到当前的流式气泡。
 * 如果还没有气泡，创建一个新的 assistant 气泡。
 */
export function appendStreamChunk(content?: string, reasoningContent?: string): void {
  if (!content && !reasoningContent) return;

  // 首次收到内容时创建气泡
  if (!streamBubble) {
    streamBubble = createStreamBubble();
    streamContent = "";
    streamReasoningContent = "";
  }

  if (content) {
    streamContent += content;
  }
  if (reasoningContent) {
    streamReasoningContent += reasoningContent;
  }

  // 更新气泡内容
  const body = streamBubble.querySelector(".bubble-body") as HTMLElement | null;
  if (!body) return;

  // 清空并显示累积内容
  body.innerHTML = "";

  // 如果有 reasoning 就显示为灰色
  if (streamReasoningContent) {
    const reasoningEl = document.createElement("div");
    reasoningEl.style.cssText = "color: var(--vscode-descriptionForeground); font-style: italic; margin-bottom: 8px;";
    reasoningEl.textContent = streamReasoningContent;
    body.appendChild(reasoningEl);
  }

  // 显示回复内容（纯文本，等最终 appendMessage 会替换为渲染好的 HTML）
  const contentEl = document.createElement("div");
  contentEl.className = "bubble-normal-content stream-content";
  contentEl.textContent = streamContent;
  body.appendChild(contentEl);

  scrollToBottom();
}

/** 当收到最终的 appendMessage 时，清除流式状态 */
export function clearStreamState(): void {
  streamBubble = null;
  streamContent = "";
  streamReasoningContent = "";
}

function createStreamBubble(): HTMLElement {
  const bubble = document.createElement("div");
  bubble.className = "bubble bubble-assistant streaming";
  bubble.dataset.messageId = `streaming-${Date.now()}`;

  // 头像点
  const dot = document.createElement("div");
  dot.className = "bubble-dot";
  bubble.appendChild(dot);

  // 内容区域
  const body = document.createElement("div");
  body.className = "bubble-body";
  bubble.appendChild(body);

  $.messages.appendChild(bubble);
  scrollToBottom();
  return bubble;
}

// ─── 清除消息 ────────────────────────────────────────────

export function clearMessages(): void {
  streamBubble = null;
  streamContent = "";
  streamReasoningContent = "";
  $.messages.innerHTML = "";
  state.lastMessageRole = null;
  state.currentRunningProcesses = null;
  state.currentLlmStreamProgress = null;
}

// ─── 询问用户表单渲染 ────────────────────────────────────

export function renderAskUserQuestion(msg: SessionMessageData, shouldConnect: boolean): void {
  addMessageBubble(msg, shouldConnect);
  // 表单交互性在 session 状态为 waiting_for_user 时启用
  if (state.currentSessionStatus === "waiting_for_user") {
    enableAskUserForms();
  }
}

function enableAskUserForms(): void {
  $.messages.querySelectorAll(".ask-user-form").forEach((form) => {
    (form as HTMLElement).querySelectorAll("input, textarea, button").forEach((el) => {
      (el as HTMLInputElement).disabled = false;
    });
  });
}

// ─── 加载文本更新 ────────────────────────────────────────

export function updateLoadingText(): void {
  const loadingText = $.loading.querySelector("span");
  if (!loadingText) return;

  const parts: string[] = [];

  // 进程运行
  if (state.currentRunningProcesses) {
    const pids = Object.keys(state.currentRunningProcesses);
    for (const pid of pids) {
      const proc = state.currentRunningProcesses[pid];
      const elapsed = formatElapsedTimeSimple(proc.startTime);
      const cmd = proc.command.slice(0, 60);
      parts.push(`[PID ${pid}] ${cmd} (${elapsed})`);
    }
  }

  // LLM 流式进度
  const progress = state.currentLlmStreamProgress;
  if (progress) {
    const elapsed = formatElapsedTimeSimple(progress.startedAt);
    if (progress.formattedTokens) {
      parts.push(`已生成约 ${progress.formattedTokens} tokens (${elapsed})`);
    } else {
      parts.push(`生成中 (${elapsed})`);
    }
  }

  loadingText.textContent = parts.length > 0 ? parts.join(" | ") : "处理中...";
}

function formatElapsedTimeSimple(startTimeIso: string): string {
  const elapsedMs = Date.now() - new Date(startTimeIso).getTime();
  const totalSec = Math.floor(elapsedMs / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}
