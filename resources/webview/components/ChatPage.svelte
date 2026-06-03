<script lang="ts">
  import { appState } from "../lib/state.svelte";
  import { api } from "../lib/api";
  import ContextMeter from "./ContextMeter.svelte";
  import MessageBoard from "./MessageBoard.svelte";
  import type { PresetMeta } from "../types";

  let promptText = $state("");
  let sessionDropdownOpen = $state(false);

  // ─── 预设选择器状态 ──────────────────────────────

  let presetDropdownOpen = $state(false);
  let presets = $state<PresetMeta[]>([]);

  async function togglePresetDropdown() {
    if (!presetDropdownOpen && presets.length === 0) {
      try {
        presets = await api.request<PresetMeta[]>("listPresets");
      } catch {
        // 静默失败，下拉为空
      }
    }
    presetDropdownOpen = !presetDropdownOpen;
  }

  function selectPreset(name: string) {
    if (name === appState.activePreset) { presetDropdownOpen = false; return; }
    presetDropdownOpen = false;
    api.send("selectPreset", { name });
    appState.activePreset = name;
  }

  // ─── 回退时填入输入框 ───────────────────────────

  $effect(() => {
    const text = appState.pendingPrompt;
    if (text) {
      promptText = text;
      appState.pendingPrompt = "";
    }
  });

  // ─── 发送/中断 ─────────────────────────────────────────

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
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendPrompt();
    }
  }

  // ─── 会话选择器 ────────────────────────────────────────

  function toggleDropdown() {
    sessionDropdownOpen = !sessionDropdownOpen;
  }

  function closeDropdown() {
    sessionDropdownOpen = false;
  }

  function selectSession(sessionId: string) {
    closeDropdown();
    api.send("selectSession", { sessionId });
  }

  function createNewSession() {
    closeDropdown();
    api.send("createNewSession");
  }

  function getCurrentSessionSummary(): string {
    const current = appState.sessions.find((s) => s.id === appState.currentSessionId);
    return current?.summary?.slice(0, 80) || "新对话";
  }

  function formatDate(dateStr: string): string {
    const d = new Date(dateStr);
    const now = new Date();
    const diff = now.getTime() - d.getTime();
    const days = Math.floor(diff / 86400000);
    if (days === 0) return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    if (days === 1) return "昨天";
    return `${d.getMonth() + 1}/${d.getDate()}`;
  }
</script>

<div class="chat-page">
  <!-- 会话选择器 -->
  <div class="session-bar">
    <button class="session-btn" onclick={toggleDropdown}>
      <span class="session-title">{getCurrentSessionSummary()}</span>
      <svg class="session-arrow" class:open={sessionDropdownOpen} viewBox="0 0 1024 1024" width="12" height="12">
        <path d="M884 256h-75c-5.1 0-9.9 2.5-12.9 6.6L512 654.2 227.9 262.6c-3-4.1-7.8-6.6-12.9-6.6h-75c-6.5 0-10.3 7.4-6.5 12.7l352.6 486.1c12.8 17.6 39 17.6 51.7 0l352.6-486.1c3.9-5.3.1-12.7-6.4-12.7z"/>
      </svg>
    </button>
    <button class="new-chat-btn" onclick={createNewSession} title="新对话">+</button>

    {#if sessionDropdownOpen}
      <!-- eslint-disable-next-line svelte/no-at-html-tags -->
      <!-- svelte-ignore a11y_click_events_have_key_events -->
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div class="session-dropdown" role="listbox" onclick={() => {}} onkeydown={() => {}}>
        {#each appState.sessions as session (session.id)}
          <button
            class="session-item"
            class:active={session.id === appState.currentSessionId}
            onclick={() => selectSession(session.id)}
            role="option"
          >
            <span class="session-item-title">{session.summary?.slice(0, 50) || "空对话"}</span>
            <span class="session-item-time">{formatDate(session.createTime)}</span>
          </button>
        {:else}
          <div class="session-empty">暂无历史对话</div>
        {/each}
      </div>
    {/if}
  </div>

  <!-- 消息列表 -->
  <MessageBoard />

  <!-- 输入区 -->
  <div class="composer">
    <div class="input-wrap">
      <textarea
        bind:value={promptText}
        onkeydown={handleKeydown}
        placeholder="输入消息... (Shift+Enter 换行)"
        rows="3"
      ></textarea>
      <div class="composer-footer">
        <div class="footer-left">
          <ContextMeter />
          <!-- 预设快捷选择器 -->
          <div class="preset-selector">
            <button class="badge-btn" onclick={togglePresetDropdown}>
              预设: {appState.activePreset}
              <svg class="preset-arrow" class:open={presetDropdownOpen} viewBox="0 0 1024 1024" width="10" height="10">
                <path d="M884 256h-75c-5.1 0-9.9 2.5-12.9 6.6L512 654.2 227.9 262.6c-3-4.1-7.8-6.6-12.9-6.6h-75c-6.5 0-10.3 7.4-6.5 12.7l352.6 486.1c12.8 17.6 39 17.6 51.7 0l352.6-486.1c3.9-5.3.1-12.7-6.4-12.7z"/>
              </svg>
            </button>
            {#if presetDropdownOpen}
              <div class="preset-dropdown">
                {#each presets as preset (preset.name)}
                  <button
                    class="preset-item"
                    class:active={preset.name === appState.activePreset}
                    onclick={() => selectPreset(preset.name)}
                  >
                    <span class="preset-item-name">{preset.displayName}</span>
                    {#if preset.name === appState.activePreset}
                      <span class="preset-check">✓</span>
                    {/if}
                  </button>
                {:else}
                  <div class="preset-empty">暂无预设</div>
                {/each}
              </div>
            {/if}
          </div>
          <button class="badge-btn" onclick={() => (appState.currentTab = "profiles")}>
            配置: {appState.activeProfile}
          </button>
        </div>
        <div class="footer-right">
          <button
            class="send-btn"
            onclick={sendPrompt}
            disabled={!promptText.trim() && !appState.isProcessing}
            title={appState.isProcessing ? "中断" : "发送"}
          >
            {#if appState.isProcessing}
              <svg viewBox="0 0 16 16" width="16" height="16">
                <rect x="3" y="3" width="10" height="10" rx="2" fill="currentColor"/>
              </svg>
            {:else}
              <svg viewBox="0 0 16 16" width="16" height="16">
                <path d="M1.5 1.5L14.5 8L1.5 14.5V1.5z" fill="currentColor"/>
              </svg>
            {/if}
          </button>
        </div>
      </div>
    </div>
  </div>
</div>

<style>
  .chat-page {
    flex: 1;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    min-height: 0;
  }

  /* ─── 会话选择器 ───────────────────────────────── */
  .session-bar {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 6px 10px;
    border-bottom: 1px solid var(--vscode-panel-border);
    flex-shrink: 0;
    position: relative;
    z-index: 10;
    background: var(--vscode-sideBar-background);
  }

  .session-btn {
    flex: 1;
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px 8px;
    border: none;
    background: transparent;
    color: var(--vscode-foreground);
    cursor: pointer;
    font-size: 13px;
    font-weight: 500;
    border-radius: 4px;
    text-align: left;
    min-width: 0;
  }

  .session-btn:hover {
    background: var(--vscode-list-hoverBackground);
  }

  .session-title {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .session-arrow {
    flex-shrink: 0;
    transition: transform 0.15s;
    fill: var(--vscode-descriptionForeground);
  }

  .session-arrow.open {
    transform: rotate(180deg);
  }

  .new-chat-btn {
    width: 26px;
    height: 26px;
    border-radius: 4px;
    border: none;
    background: transparent;
    color: var(--vscode-foreground);
    cursor: pointer;
    font-size: 18px;
    line-height: 1;
    display: grid;
    place-items: center;
    flex-shrink: 0;
  }

  .new-chat-btn:hover {
    background: var(--vscode-list-hoverBackground);
  }

  .session-dropdown {
    position: absolute;
    top: 100%;
    left: 6px;
    right: 6px;
    z-index: 100;
    background: var(--vscode-dropdown-background, var(--vscode-sideBar-background));
    border: 1px solid var(--vscode-panel-border);
    border-radius: 6px;
    box-shadow: 0 4px 12px rgba(0,0,0,0.2);
    max-height: 300px;
    overflow-y: auto;
    padding: 4px 0;
  }

  .session-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    width: 100%;
    padding: 8px 12px;
    border: none;
    background: transparent;
    color: var(--vscode-foreground);
    cursor: pointer;
    font-size: 12px;
    text-align: left;
  }

  .session-item:hover {
    background: var(--vscode-list-hoverBackground);
  }

  .session-item.active {
    background: var(--vscode-list-activeSelectionBackground);
    color: var(--vscode-list-activeSelectionForeground);
  }

  .session-item-title {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .session-item-time {
    flex-shrink: 0;
    font-size: 11px;
    color: var(--vscode-descriptionForeground);
    margin-left: 8px;
  }

  .session-empty {
    padding: 16px;
    text-align: center;
    color: var(--vscode-descriptionForeground);
    font-size: 12px;
  }

  /* ─── 输入区 ──────────────────────────────────── */
  .composer {
    flex-shrink: 0;
    padding: 6px 12px 12px;
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
    min-height: 56px;
    max-height: 200px;
    resize: none;
    border: none;
    background: transparent;
    color: var(--vscode-input-foreground);
    padding: 10px 12px 4px;
    font-size: 13px;
    line-height: 18px;
    outline: none;
    font-family: var(--vscode-font-family);
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

  .badge-btn {
    font-size: 11px;
    padding: 2px 8px;
    border-radius: 4px;
    background: transparent;
    color: var(--vscode-foreground);
    border: 1px solid var(--vscode-panel-border);
    cursor: pointer;
    transition: border-color 0.15s, background 0.15s;
    font-family: inherit;
    line-height: 1.6;
    display: flex;
    align-items: center;
    gap: 3px;
  }

  .badge-btn:hover {
    border-color: var(--vscode-focusBorder);
    background: var(--vscode-list-hoverBackground);
  }

  /* ─── 预设快捷选择器 ─────────────────────────── */
  .preset-selector {
    position: relative;
  }

  .preset-arrow {
    fill: currentColor;
    transition: transform 0.15s;
  }

  .preset-arrow.open {
    transform: rotate(180deg);
  }

  .preset-dropdown {
    position: absolute;
    bottom: calc(100% + 4px);
    left: 0;
    z-index: 100;
    min-width: 180px;
    max-height: 240px;
    overflow-y: auto;
    background: var(--vscode-dropdown-background, var(--vscode-sideBar-background));
    border: 1px solid var(--vscode-panel-border);
    border-radius: 6px;
    box-shadow: 0 -4px 12px rgba(0,0,0,0.2);
    padding: 4px 0;
  }

  .preset-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    width: 100%;
    padding: 6px 12px;
    border: none;
    background: transparent;
    color: var(--vscode-foreground);
    cursor: pointer;
    font-size: 12px;
    text-align: left;
  }

  .preset-item:hover {
    background: var(--vscode-list-hoverBackground);
  }

  .preset-item.active {
    background: var(--vscode-list-activeSelectionBackground);
    color: var(--vscode-list-activeSelectionForeground);
  }

  .preset-item-name {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .preset-check {
    flex-shrink: 0;
    margin-left: 8px;
    font-weight: 600;
  }

  .preset-empty {
    padding: 12px;
    text-align: center;
    color: var(--vscode-descriptionForeground);
    font-size: 12px;
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
</style>
