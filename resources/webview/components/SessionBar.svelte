<script lang="ts">
  import { appState } from "../lib/state.svelte";
  import { api } from "../lib/api";

  let dropdownOpen = $state(false);
  let pendingDeleteId = $state<string | null>(null);
  let pendingDeleteTimer: ReturnType<typeof setTimeout> | undefined;

  // ─── 自动隐藏 ──────────────────────────────────────────

  let isVisible = $state(false);
  let hideTimer: ReturnType<typeof setTimeout> | undefined;

  function show() {
    if (hideTimer) clearTimeout(hideTimer);
    hideTimer = undefined;
    isVisible = true;
  }

  function hideWithDelay() {
    // 下拉打开时不隐藏
    if (dropdownOpen) return;
    hideTimer = setTimeout(() => {
      isVisible = false;
      clearPendingDelete();
    }, 400);
  }

  function cancelHide() {
    if (hideTimer) {
      clearTimeout(hideTimer);
      hideTimer = undefined;
    }
  }

  // ─── 会话选择 ──────────────────────────────────────────

  function toggleDropdown() {
    dropdownOpen = !dropdownOpen;
    if (!dropdownOpen) clearPendingDelete();
  }

  function closeDropdown() {
    dropdownOpen = false;
    clearPendingDelete();
  }

  function selectSession(sessionId: string) {
    closeDropdown();
    api.send("selectSession", { sessionId });
  }

  function createNewSession() {
    closeDropdown();
    api.send("createNewSession");
  }

  function clearPendingDelete() {
    pendingDeleteId = null;
    if (pendingDeleteTimer) {
      clearTimeout(pendingDeleteTimer);
      pendingDeleteTimer = undefined;
    }
  }

  function handleDeleteClick(e: MouseEvent, sessionId: string) {
    e.stopPropagation();
    if (pendingDeleteId === sessionId) {
      // 第二次点击，确认删除
      clearPendingDelete();
      api.send("deleteSession", { sessionId });
    } else {
      // 第一次点击，进入待确认状态
      clearPendingDelete();
      pendingDeleteId = sessionId;
      pendingDeleteTimer = setTimeout(() => {
        pendingDeleteId = null;
      }, 3000);
    }
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

<div class="session-area">
  <!-- 触发条（始终可见） -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="trigger-strip"
    class:active={isVisible}
    onmouseenter={show}
    onmouseleave={hideWithDelay}
    role="button"
    tabindex="0"
    aria-label="会话选择器"
    title="点击或悬停以显示会话列表"
  >
    <svg viewBox="0 0 16 16" width="12" height="12" class="strip-icon">
      <path d="M3 3h10v1H3zm0 4h10v1H3zm0 4h7v1H3z" fill="currentColor" />
    </svg>
  </div>

  <!-- 会话栏（悬停时展开） -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="session-bar"
    class:visible={isVisible}
    onmouseenter={cancelHide}
    onmouseleave={hideWithDelay}
    role="region"
    aria-label="会话选择"
  >
    <button class="session-btn" onclick={toggleDropdown}>
      <span class="session-title">{getCurrentSessionSummary()}</span>
      <svg class="session-arrow" class:open={dropdownOpen} viewBox="0 0 1024 1024" width="12" height="12">
        <path d="M884 256h-75c-5.1 0-9.9 2.5-12.9 6.6L512 654.2 227.9 262.6c-3-4.1-7.8-6.6-12.9-6.6h-75c-6.5 0-10.3 7.4-6.5 12.7l352.6 486.1c12.8 17.6 39 17.6 51.7 0l352.6-486.1c3.9-5.3.1-12.7-6.4-12.7z"/>
      </svg>
    </button>
    <button class="new-chat-btn" onclick={createNewSession} title="新对话">+</button>

    {#if dropdownOpen}
      <div class="session-dropdown">
        {#each appState.sessions as session (session.id)}
          <!-- svelte-ignore a11y_click_events_have_key_events -->
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <div
            class="session-item"
            class:active={session.id === appState.currentSessionId}
            onclick={() => selectSession(session.id)}
            role="option"
            tabindex="-1"
            aria-selected={session.id === appState.currentSessionId}
          >
            <span class="session-item-title">{session.summary?.slice(0, 50) || "空对话"}</span>
            <span class="session-item-time">{formatDate(session.createTime)}</span>
            {#if pendingDeleteId === session.id}
              <button
                class="session-delete-btn confirm"
                onclick={(e) => handleDeleteClick(e, session.id)}
                title="确认删除"
              >确认?</button>
            {:else}
              <button
                class="session-delete-btn"
                onclick={(e) => handleDeleteClick(e, session.id)}
                title="删除会话"
              >✕</button>
            {/if}
          </div>
        {:else}
          <div class="session-empty">暂无历史对话</div>
        {/each}
      </div>
    {/if}
  </div>
</div>

<style>
  /* ─── 会话区域容器 ─────────────────────────────── */
  .session-area {
    position: relative;
    z-index: 10;
    flex-shrink: 0;
  }

  /* ─── 触发条 ──────────────────────────────────── */
  .trigger-strip {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 6px;
    cursor: pointer;
    background: transparent;
    transition: height 0.15s ease, background 0.15s ease;
    position: relative;
  }

  .trigger-strip:hover,
  .trigger-strip.active {
    height: 10px;
    background: var(--vscode-list-hoverBackground);
  }

  .strip-icon {
    opacity: 0.3;
    transition: opacity 0.15s;
  }

  .trigger-strip:hover .strip-icon,
  .trigger-strip.active .strip-icon {
    opacity: 0.7;
  }

  /* ─── 会话栏 ──────────────────────────────────── */
  .session-bar {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 0 10px;
    height: 0;
    overflow: hidden;
    opacity: 0;
    transition: height 0.2s ease, opacity 0.2s ease, padding 0.2s ease;
    background: var(--vscode-sideBar-background);
    border-bottom: 1px solid transparent;
  }

  .session-bar.visible {
    height: 36px;
    padding: 6px 10px;
    opacity: 1;
    border-bottom-color: var(--vscode-panel-border);
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

  /* ─── 下拉列表 ────────────────────────────────── */
  .session-dropdown {
    position: absolute;
    top: calc(100% + 4px);
    left: 6px;
    right: 6px;
    z-index: 100;
    background: var(--vscode-dropdown-background, var(--vscode-sideBar-background));
    border: 1px solid var(--vscode-panel-border);
    border-radius: 6px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
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

  .session-delete-btn {
    flex-shrink: 0;
    width: 20px;
    height: 20px;
    margin-left: 4px;
    border: none;
    background: transparent;
    color: var(--vscode-descriptionForeground);
    cursor: pointer;
    border-radius: 4px;
    font-size: 12px;
    line-height: 1;
    display: none;
    place-items: center;
    padding: 0;
    opacity: 0.6;
    transition: opacity 0.15s;
  }

  .session-item:hover .session-delete-btn {
    display: grid;
  }

  .session-delete-btn:hover {
    opacity: 1;
    color: var(--vscode-errorForeground, #e74c3c);
    background: var(--vscode-list-hoverBackground);
  }

  .session-delete-btn.confirm {
    display: grid;
    font-size: 11px;
    width: auto;
    padding: 0 6px;
    color: var(--vscode-errorForeground, #e74c3c);
    opacity: 1;
    font-weight: 500;
  }

  .session-empty {
    padding: 16px;
    text-align: center;
    color: var(--vscode-descriptionForeground);
    font-size: 12px;
  }
</style>
