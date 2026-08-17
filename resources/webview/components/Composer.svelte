<script lang="ts">
  import { tick } from "svelte";
  import { appState } from "../lib/state.svelte";
  import { api } from "../lib/api";
  import ContextMeter from "./ContextMeter.svelte";
  import PresetQuickSelector from "./PresetQuickSelector.svelte";
  import ProfileQuickSelector from "./ProfileQuickSelector.svelte";
  import AttachedFilesBar from "./AttachedFilesBar.svelte";
  import type { QuickReply } from "../types";

  let promptText = $state("");
  let textareaEl: HTMLTextAreaElement | undefined = $state();

  // ─── 自动扩展 textarea ──────────────────────────────

  const MAX_HEIGHT_RATIO = 0.5; // 最多占视口高度 50%

  function autoResize() {
    const el = textareaEl;
    if (!el) return;

    el.style.height = "auto";
    const maxH = window.innerHeight * MAX_HEIGHT_RATIO;
    const newH = Math.min(el.scrollHeight, maxH);
    el.style.height = `${newH}px`;
    el.style.overflowY = el.scrollHeight > maxH ? "auto" : "hidden";
  }

  // ─── 窗口 resize 时重算 ──────────────────────────────

  $effect(() => {
    if (!textareaEl) return;
    const onResize = () => autoResize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  });

  // ─── 回退时填入输入框 ───────────────────────────────

  $effect(() => {
    const text = appState.pendingPrompt;
    if (text) {
      promptText = text;
      appState.pendingPrompt = "";
    }
  });

  // ─── 发送 / 中断 ─────────────────────────────────────

  function sendPrompt() {
    if (appState.isProcessing) {
      api.send("interrupt");
      appState.currentSessionStatus = "interrupted";
      appState.isLoading = false;
      return;
    }

    const text = promptText.trim();
    if (!text) return;

    promptText = "";
    api.send("userPrompt", { prompt: text });
    appState.currentSessionStatus = "pending"; // 立即切换为停止按钮，不等后端响应

    // 重置 textarea 高度
    if (textareaEl) {
      textareaEl.style.height = "auto";
    }
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      const textarea = e.currentTarget as HTMLTextAreaElement;
      promptText = textarea.value;
      sendPrompt();
    }
  }

  function handleInput() {
    autoResize();
  }

  // ─── 快速回复 ─────────────────────────────────────
  // 可选功能：预设目录下存在 quickReply.json 时，发送按钮旁出现入口。
  // 跟随当前激活的预设，切换预设时自动重新加载。

  let quickReplies = $state<QuickReply[]>([]);
  let quickReplyOpen = $state(false);

  $effect(() => {
    const preset = appState.activePreset;
    void loadQuickReplies(preset);
  });

  async function loadQuickReplies(preset: string) {
    try {
      quickReplies = await api.request<QuickReply[]>("listQuickReplies", { preset });
    } catch {
      quickReplies = [];
    }
  }

  function toggleQuickReply() {
    quickReplyOpen = !quickReplyOpen;
  }

  /** 选中快速回复：填入输入框（可再编辑），聚焦以便发送 */
  function applyQuickReply(reply: QuickReply) {
    promptText = reply.content;
    quickReplyOpen = false;
    void tick().then(() => {
      autoResize();
      textareaEl?.focus();
    });
  }
</script>

<div class="composer" class:dragover={appState.isDragOver}>
  <div class="input-wrap">
    <AttachedFilesBar />
    <textarea
      bind:this={textareaEl}
      bind:value={promptText}
      onkeydown={handleKeydown}
      oninput={handleInput}
      placeholder="输入消息... (Shift+Enter 换行，拖入文件按住 Shift)"
      rows="1"
    ></textarea>
    <div class="composer-footer">
      <div class="footer-left">
        <ContextMeter />
        <PresetQuickSelector />
        <ProfileQuickSelector />
      </div>
      <div class="footer-right">
        {#if quickReplies.length > 0}
          <div class="quick-reply-wrap">
            <button
              class="quick-reply-btn"
              class:open={quickReplyOpen}
              onclick={toggleQuickReply}
              title="快速回复"
            >
              <svg viewBox="0 0 16 16" width="14" height="14">
                <path d="M9 0L1 9h4l-1 7 8-9H8l1-7z" fill="currentColor" />
              </svg>
            </button>
            {#if quickReplyOpen}
              <div class="quick-reply-dropdown">
                {#each quickReplies as reply (reply.id)}
                  <button class="dropdown-item" onclick={() => applyQuickReply(reply)}>
                    <span class="item-label">{reply.label}</span>
                  </button>
                {/each}
              </div>
            {/if}
          </div>
        {/if}
        <button
          class="send-btn"
          onclick={sendPrompt}
          disabled={!promptText.trim() && !appState.isProcessing}
          title={appState.isProcessing ? "中断" : "发送"}
        >
          {#if appState.isProcessing}
            <svg viewBox="0 0 16 16" width="16" height="16">
              <rect x="3" y="3" width="10" height="10" rx="2" fill="currentColor" />
            </svg>
          {:else}
            <svg viewBox="0 0 16 16" width="16" height="16">
              <path d="M1.5 1.5L14.5 8L1.5 14.5V1.5z" fill="currentColor" />
            </svg>
          {/if}
        </button>
      </div>
    </div>
  </div>
</div>

<style>
  .composer {
    flex-shrink: 0;
    padding: 6px 6px 6px;
    background: var(--vscode-sideBar-background);
    border-top: 1px solid var(--vscode-panel-border);
  }

  .input-wrap {
    display: flex;
    flex-direction: column;
    border-radius: 8px;
    border: 1px solid var(--vscode-panel-border);
    background: var(--vscode-input-background);
    transition: border-color 0.15s;
  }

  .input-wrap:focus-within {
    border-color: var(--vscode-focusBorder);
  }

  textarea {
    width: 100%;
    min-height: 28px;
    max-height: 50vh;
    resize: none;
    border: none;
    background: transparent;
    color: var(--vscode-input-foreground);
    padding: 10px 12px 4px;
    font-size: 13px;
    line-height: 18px;
    outline: none;
    font-family: var(--vscode-font-family);
    overflow-y: hidden;
    box-sizing: border-box;
  }

  textarea::placeholder {
    color: var(--vscode-input-placeholderForeground);
  }

  .composer-footer {
    display: flex;
    height: 34px;
    align-items: center;
    justify-content: space-between;
    padding: 0 8px 4px;
  }

  .footer-left {
    display: flex;
    gap: 6px;
    align-items: center;
  }

  .footer-right {
    position: relative;
    display: flex;
    align-items: center;
    gap: 4px;
  }

  .quick-reply-wrap {
    position: relative;
  }

  .quick-reply-btn {
    width: 28px;
    height: 28px;
    border-radius: 50%;
    border: none;
    cursor: pointer;
    display: grid;
    place-items: center;
    background: transparent;
    color: var(--vscode-foreground);
    transition: background 0.15s;
  }

  .quick-reply-btn:hover,
  .quick-reply-btn.open {
    background: var(--vscode-toolbar-hoverBackground);
  }

  .quick-reply-dropdown {
    position: absolute;
    bottom: calc(100% + 4px);
    right: 0;
    z-index: 100;
    min-width: 200px;
    max-height: 260px;
    overflow-y: auto;
    background: var(--vscode-dropdown-background, var(--vscode-sideBar-background));
    border: 1px solid var(--vscode-panel-border);
    border-radius: 6px;
    box-shadow: 0 -4px 12px rgba(0, 0, 0, 0.2);
    padding: 4px 0;
  }

  .dropdown-item {
    display: flex;
    align-items: center;
    width: 100%;
    padding: 7px 12px;
    border: none;
    background: transparent;
    color: var(--vscode-foreground);
    cursor: pointer;
    font-size: 12px;
    text-align: left;
  }

  .dropdown-item:hover {
    background: var(--vscode-list-hoverBackground);
  }

  .item-label {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .send-btn {
    width: 28px;
    height: 28px;
    border-radius: 50%;
    border: none;
    cursor: pointer;
    display: grid;
    place-items: center;
    background: transparent;
    color: var(--vscode-foreground);
    transition: background 0.15s;
  }

  .send-btn:hover:not(:disabled) {
    background: var(--vscode-button-hoverBackground, var(--vscode-toolbar-hoverBackground));
  }

  .send-btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  /* ─── 拖拽视觉反馈 ──────────────────────────────── */

  .composer.dragover .input-wrap {
    border-color: var(--vscode-focusBorder);
    box-shadow: 0 0 0 1px var(--vscode-focusBorder);
  }
</style>
