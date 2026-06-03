import { $, state, history, vscode } from "../state";

// ─── 初始化 ──────────────────────────────────────────────

export function initComposer(): void {
  $.promptInput.addEventListener("input", onInput);
  $.promptInput.addEventListener("keydown", onKeyDown);
  $.sendButton.addEventListener("click", onSendClick);

  // 恢复状态
  const savedState = vscode.getState() as { promptText?: string } | undefined;
  if (savedState?.promptText) {
    $.promptInput.value = savedState.promptText || "";
    autoResize();
    updateSendIconState();
  }

  // visibilitychange 时保存
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      vscode.setState({ promptText: $.promptInput.value });
    }
  });

  // 初始更新发送按钮
  updateSendIconState();
}

// ─── 输入事件 ────────────────────────────────────────────

function onInput(): void {
  exitHistoryBrowsing();
  autoResize();
  updateSendIconState();
}

function onKeyDown(e: KeyboardEvent): void {
  // Enter → 发送（Shift+Enter → 换行）
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    sendPrompt();
    return;
  }

  // ArrowUp/ArrowDown → 历史导航
  if (e.key === "ArrowUp" && $.promptInput.selectionStart === 0 && $.promptInput.selectionEnd === 0) {
    e.preventDefault();
    navigateHistory(-1);
    return;
  }
  if (e.key === "ArrowDown" && $.promptInput.selectionStart === $.promptInput.value.length) {
    e.preventDefault();
    navigateHistory(1);
    return;
  }
}

function onSendClick(): void {
  sendPrompt();
}

// ─── 发送 ────────────────────────────────────────────────

function isProcessing(): boolean {
  return state.currentSessionStatus === "processing" || state.currentSessionStatus === "pending";
}

function sendPrompt(): void {
  if (isProcessing()) {
    vscode.postMessage({ type: "interrupt" });
    state.currentSessionStatus = "interrupted";
    setLoading(false);
    return;
  }

  const text = $.promptInput.value.trim();
  const imageUrls = getAttachedImageUrls();
  if ((!text && imageUrls.length === 0) || $.sendButton.disabled) return;

  // 清空输入
  $.promptInput.value = "";
  vscode.setState({ promptText: "" });
  autoResize();
  updateSendIconState();

  // 发送
  vscode.postMessage({
    type: "userPrompt",
    prompt: text,
    images: imageUrls.length > 0 ? imageUrls : undefined,
  });

  // 记录历史
  history.pendingUserPrompt = text || (imageUrls.length > 0 ? "粘贴的图像" : "");
  attachmentManager?.clear();
  updateSendIconState();
}

// ─── 自动调整输入框大小 ─────────────────────────────────

function getLineHeight(): number {
  const computed = window.getComputedStyle($.promptInput);
  const fontSize = parseFloat(computed.fontSize) || 16;
  const lineHeight = parseFloat(computed.lineHeight) || fontSize * 1.2;
  return lineHeight;
}

function getVerticalSize(): number {
  const computed = window.getComputedStyle($.promptInput);
  const paddingTop = parseFloat(computed.paddingTop) || 0;
  const paddingBottom = parseFloat(computed.paddingBottom) || 0;
  const borderTop = parseFloat(computed.borderTopWidth) || 0;
  const borderBottom = parseFloat(computed.borderBottomWidth) || 0;
  return paddingTop + paddingBottom + borderTop + borderBottom;
}

export function autoResize(): void {
  const lineHeight = getLineHeight();
  const vertical = getVerticalSize();
  $.promptInput.style.height = "0";
  const scrollHeight = $.promptInput.scrollHeight;
  const minHeight = lineHeight * state.promptMinRows + vertical;
  const maxHeight = lineHeight * state.promptMaxRows + vertical;
  const clamped = Math.max(minHeight, Math.min(scrollHeight, maxHeight));
  $.promptInput.style.height = `${clamped}px`;
}

// ─── 发送按钮状态 ────────────────────────────────────────

export function updateSendIconState(): void {
  const hasText = $.promptInput.value.trim().length > 0;
  const hasImages = getAttachedImageUrls().length > 0;
  const disabled = !hasText && !hasImages;
  $.sendButton.disabled = disabled;
  $.sendButton.classList.toggle("disabled", disabled);
}

export function setLoading(isLoading: boolean): void {
  $.loading.classList.toggle("active", isLoading);
  $.sendIcon.classList.toggle("hidden", isLoading);
  $.stopIcon.classList.toggle("hidden", !isLoading);
}

// ─── 图片附件 ────────────────────────────────────────────

declare const window: Window & {
  createPromptAttachmentManager?: (opts: {
    promptInput: HTMLTextAreaElement;
    inputWrap: HTMLElement;
    toolsLine: HTMLElement;
    onAttachmentChange: () => void;
  }) => AttachmentManager;
};

export let attachmentManager: AttachmentManager | null = null;

interface AttachmentManager {
  clear(): void;
  getImageUrls(): string[];
}

function getAttachedImageUrls(): string[] {
  return attachmentManager?.getImageUrls() ?? [];
}

export function initAttachmentManager(): void {
  if (typeof window.createPromptAttachmentManager === "function") {
    attachmentManager = window.createPromptAttachmentManager({
      promptInput: $.promptInput,
      inputWrap: $.inputWrap,
      toolsLine: $.toolsLine,
      onAttachmentChange: () => {
        updateSendIconState();
      },
    });
  }
}

// ─── 历史导航 ────────────────────────────────────────────

function navigateHistory(direction: number): void {
  if (history.inputHistory.length === 0) return;

  // 进入历史浏览模式时保存当前草稿
  if (history.cursor === -1) {
    history.draftBeforeHistory = $.promptInput.value;
  }

  const newCursor = history.cursor + direction;
  if (newCursor < -1 || newCursor >= history.inputHistory.length) return;

  history.cursor = newCursor;

  if (newCursor === -1) {
    // 退出历史浏览
    $.promptInput.value = history.draftBeforeHistory || "";
    history.draftBeforeHistory = null;
  } else {
    $.promptInput.value = history.inputHistory[history.inputHistory.length - 1 - newCursor];
  }

  autoResize();
  updateSendIconState();
  // 光标移到末尾
  const len = $.promptInput.value.length;
  $.promptInput.setSelectionRange(len, len);
}

function exitHistoryBrowsing(): void {
  if (history.cursor === -1) return;
  history.cursor = -1;
  history.draftBeforeHistory = null;
}
