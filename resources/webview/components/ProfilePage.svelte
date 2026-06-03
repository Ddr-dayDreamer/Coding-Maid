<script lang="ts">
  import { appState } from "../lib/state.svelte";
  import { api } from "../lib/api";
  import { notify } from "../lib/notification.svelte";
  import { onMount } from "svelte";
  import type { ProfileMeta } from "../types";

  // ─── 状态 ──────────────────────────────────────────

  let profiles = $state<ProfileMeta[]>([]);
  let loading = $state(true);
  let testingProfile = $state<string | null>(null);
  let renamingProfile = $state<string | null>(null);
  let renameInput = $state("");
  let creatingNew = $state(false);
  let newProfileName = $state("");
  let renameInputRef = $state<HTMLInputElement | undefined>();

  // ─── 加载 ──────────────────────────────────────────

  onMount(async () => {
    await loadProfiles();
  });

  async function loadProfiles() {
    loading = true;
    try {
      profiles = await api.request<ProfileMeta[]>("listProfiles");
    } catch {
      notify.error("加载配置列表失败");
    } finally {
      loading = false;
    }
  }

  // ─── 操作 ──────────────────────────────────────────

  function handleSelect(name: string) {
    if (name === appState.activeProfile) return;
    api.send("selectProfile", { name });
    appState.activeProfile = name;
    notify.success(`已切换到配置「${name}」`);
  }

  async function handleEdit(profile: ProfileMeta) {
    api.send("openFile", { filePath: profile.filePath, line: 1 });
  }

  // ─── 新建 ──────────────────────────────────────────

  function startNew() {
    creatingNew = true;
    newProfileName = "";
    // 稍后自动聚焦
    requestAnimationFrame(() => {
      const input = document.querySelector<HTMLInputElement>(".new-profile-input");
      input?.focus();
    });
  }

  async function confirmNew() {
    const name = newProfileName.trim();
    if (!name) { creatingNew = false; return; }
    creatingNew = false;
    try {
      const result = await api.request<ProfileMeta>("createProfile", { name });
      await loadProfiles();
      notify.success(`已创建新配置「${name}」`);
      if (result) handleEdit(result);
    } catch {
      notify.error("创建配置失败");
    }
  }

  function cancelNew() {
    creatingNew = false;
    newProfileName = "";
  }

  function handleNewKeydown(e: KeyboardEvent) {
    if (e.key === "Enter") { e.preventDefault(); confirmNew(); }
    if (e.key === "Escape") { cancelNew(); }
  }

  // ─── 重命名 ────────────────────────────────────────

  function startRename(name: string) {
    renamingProfile = name;
    renameInput = name;
    requestAnimationFrame(() => {
      const input = document.querySelector<HTMLInputElement>(".rename-input");
      input?.focus();
      input?.select();
    });
  }

  async function confirmRename() {
    const oldName = renamingProfile;
    const newName = renameInput.trim();
    renamingProfile = null;
    if (!oldName || !newName || oldName === newName) return;
    try {
      await api.request("renameProfile", { oldName, newName });
      await loadProfiles();
      if (appState.activeProfile === oldName) {
        appState.activeProfile = newName;
      }
      notify.success(`已重命名为「${newName}」`);
    } catch (e) {
      notify.error(`重命名失败: ${String(e).slice(0, 80)}`);
    }
  }

  function cancelRename() {
    renamingProfile = null;
  }

  function handleRenameKeydown(e: KeyboardEvent) {
    if (e.key === "Enter") { e.preventDefault(); confirmRename(); }
    if (e.key === "Escape") { cancelRename(); }
  }

  // ─── 删除 ──────────────────────────────────────────

  async function handleDelete(name: string) {
    try {
      await api.request("deleteProfile", { name });
      if (appState.activeProfile === name) {
        appState.activeProfile = "default";
        notify.success(`已切换到配置「default」`);
      }
      await loadProfiles();
      notify.success(`配置「${name}」已删除`);
    } catch {
      notify.error("删除失败");
    }
  }

  // ─── 测试连接 ──────────────────────────────────────

  async function handleTestConnection(name: string) {
    testingProfile = name;
    try {
      const result = await api.request<{ success: boolean; model: string }>("testConnection", { name });
      if (result.success) {
        notify.success(`连接测试通过 ✓ 模型: ${result.model}`);
      }
    } catch (e) {
      const msg = String(e);
      notify.error(`连接测试失败: ${msg.slice(0, 120)}`);
    } finally {
      testingProfile = null;
    }
  }
</script>

<div class="page">
  <div class="page-header">
    <h2>连接配置</h2>
    <span class="badge">{profiles.length}</span>
  </div>

  {#if creatingNew}
    <div class="new-profile-bar">
      <input
        class="new-profile-input"
        type="text"
        placeholder="输入配置名称..."
        bind:value={newProfileName}
        onkeydown={handleNewKeydown}
        onblur={confirmNew}
      />
      <button class="action-btn primary" onclick={confirmNew}>创建</button>
      <button class="action-btn" onclick={cancelNew}>取消</button>
    </div>
  {/if}

  {#if loading}
    <p class="hint">加载中...</p>
  {:else if profiles.length === 0}
    <p class="hint">暂无配置，点击下方按钮新建</p>
  {:else}
    <div class="profile-list">
      {#each profiles as profile (profile.name)}
        <div
          class="profile-card"
          class:active={profile.name === appState.activeProfile}
          onclick={() => handleSelect(profile.name)}
          role="button"
          tabindex="0"
          onkeydown={(e) => e.key === "Enter" && handleSelect(profile.name)}
        >
          <div class="card-info">
            {#if renamingProfile === profile.name}
              <input
                class="rename-input"
                type="text"
                bind:value={renameInput}
                onkeydown={handleRenameKeydown}
                onblur={confirmRename}
                onclick={(e) => e.stopPropagation()}
              />
            {:else}
              <div class="card-name" onclick={() => handleSelect(profile.name)}>
                {#if profile.name === appState.activeProfile}
                  <span class="indicator">●</span>
                {/if}
                <strong>{profile.name}</strong>
                {#if profile.name === appState.activeProfile}
                  <span class="current-tag">当前</span>
                {/if}
              </div>
            {/if}
          </div>
          <div class="card-actions" onclick={(e) => e.stopPropagation()}>
            <button class="icon-btn" title="重命名" onclick={() => startRename(profile.name)}>
              <svg viewBox="0 0 16 16" width="14" height="14">
                <path fill="currentColor" d="M7.75 2a.75.75 0 0 1 .75.75V7h4.25a.75.75 0 0 1 0 1.5H8.5v4.25a.75.75 0 0 1-1.5 0V8.5H2.75a.75.75 0 0 1 0-1.5H7V2.75A.75.75 0 0 1 7.75 2Z"/>
              </svg>
            </button>
            <button class="icon-btn" title="编辑配置文件" onclick={() => handleEdit(profile)}>
              <svg viewBox="0 0 16 16" width="14" height="14">
                <path fill="currentColor" d="M11.013 1.427a1.75 1.75 0 0 1 2.474 0l1.086 1.086a1.75 1.75 0 0 1 0 2.474l-8.61 8.61c-.21.21-.47.364-.756.445l-3.251.93a.75.75 0 0 1-.927-.928l.929-3.25a1.75 1.75 0 0 1 .445-.758l8.61-8.61Zm1.414 1.06a.25.25 0 0 0-.354 0L3.103 11.46a.25.25 0 0 0-.064.108l-.558 1.953 1.953-.558a.25.25 0 0 0 .108-.064l8.97-8.97a.25.25 0 0 0 0-.354l-1.086-1.086Z"/>
              </svg>
            </button>
            <button
              class="icon-btn test"
              title="测试连接"
              disabled={testingProfile === profile.name}
              onclick={() => handleTestConnection(profile.name)}
            >
              {#if testingProfile === profile.name}
                <svg viewBox="0 0 16 16" width="14" height="14" class="spin">
                  <path fill="currentColor" d="M8 1.5a6.5 6.5 0 1 0 6.5 6.5.75.75 0 0 0-1.5 0 5 5 0 1 1-5-5 .75.75 0 0 0 0-1.5Z"/>
                </svg>
              {:else}
                <svg viewBox="0 0 16 16" width="14" height="14">
                  <path fill="currentColor" d="M8 1.5a6.5 6.5 0 1 0 6.5 6.5.75.75 0 0 0-1.5 0 5 5 0 1 1-5-5 .75.75 0 0 0 0-1.5Zm2.5 4.15a.75.75 0 0 1 .1 1.06l-3 3.5a.75.75 0 0 1-1.1.04l-1.5-1.5a.75.75 0 1 1 1.06-1.06l.97.97 2.47-2.88a.75.75 0 0 1 1-.13Z"/>
                </svg>
              {/if}
            </button>
            <button
              class="icon-btn danger"
              title="删除"
              onclick={() => handleDelete(profile.name)}
            >
              <svg viewBox="0 0 16 16" width="14" height="14">
                <path fill="currentColor" d="M6.5 1.75a.25.25 0 0 1 .25-.25h2.5a.25.25 0 0 1 .25.25V3h-3V1.75Zm4.5 0V3h2.25a.75.75 0 0 1 0 1.5h-.12l-.66 8.69a1.75 1.75 0 0 1-1.74 1.56H4.27a1.75 1.75 0 0 1-1.74-1.56L1.87 4.5h-.12a.75.75 0 0 1 0-1.5H4V1.75C4 .784 4.784 0 5.75 0h4.5C11.216 0 12 .784 12 1.75Zm-6.5 5.5v4.5a.75.75 0 0 0 1.5 0v-4.5a.75.75 0 0 0-1.5 0Zm4.5 0v4.5a.75.75 0 0 0 1.5 0v-4.5a.75.75 0 0 0-1.5 0Z"/>
              </svg>
            </button>
          </div>
        </div>
      {/each}
    </div>
  {/if}

  <div class="list-actions">
    <button class="action-btn primary" onclick={startNew}>
      <svg viewBox="0 0 16 16" width="14" height="14">
        <path fill="currentColor" d="M7.75 2a.75.75 0 0 1 .75.75V7h4.25a.75.75 0 0 1 0 1.5H8.5v4.25a.75.75 0 0 1-1.5 0V8.5H2.75a.75.75 0 0 1 0-1.5H7V2.75A.75.75 0 0 1 7.75 2Z"/>
      </svg>
      新建配置
    </button>
  </div>
</div>

<style>
  .page {
    flex: 1;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    min-height: 0;
    padding: 16px;
  }

  .page-header {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 0 0 12px;
  }

  .page-header h2 {
    margin: 0;
    font-size: 14px;
    font-weight: 600;
  }

  .badge {
    font-size: 11px;
    padding: 1px 7px;
    border-radius: 10px;
    background: var(--vscode-badge-background);
    color: var(--vscode-badge-foreground);
  }

  .hint {
    color: var(--vscode-descriptionForeground);
    font-size: 13px;
    padding: 24px 0;
    text-align: center;
  }

  .profile-list {
    flex: 1;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .profile-card {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 10px;
    border-radius: 6px;
    cursor: pointer;
    border: 1px solid transparent;
    transition: background 0.1s, border-color 0.1s;
  }

  .profile-card:hover {
    background: var(--vscode-list-hoverBackground);
  }

  .profile-card.active {
    background: var(--vscode-list-activeSelectionBackground);
    color: var(--vscode-list-activeSelectionForeground);
    border-color: var(--vscode-focusBorder);
  }

  .card-info {
    flex: 1;
    min-width: 0;
  }

  .card-name {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 13px;
  }

  .indicator {
    color: var(--vscode-charts-green);
    font-size: 10px;
  }

  .current-tag {
    font-size: 10px;
    padding: 1px 5px;
    border-radius: 3px;
    background: var(--vscode-badge-background);
    color: var(--vscode-badge-foreground);
  }

  .card-actions {
    display: flex;
    gap: 2px;
    flex-shrink: 0;
    margin-left: 8px;
  }

  .icon-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 26px;
    height: 26px;
    padding: 0;
    border: none;
    border-radius: 4px;
    background: transparent;
    color: var(--vscode-foreground);
    cursor: pointer;
    opacity: 0.5;
    transition: opacity 0.1s, background 0.1s;
  }

  .icon-btn:hover:not(:disabled) {
    opacity: 1;
    background: var(--vscode-toolbar-hoverBackground);
  }

  .icon-btn.danger:hover:not(:disabled) {
    color: var(--vscode-errorForeground);
  }

  .icon-btn.test:hover:not(:disabled) {
    color: var(--vscode-charts-green);
  }

  .icon-btn:disabled {
    opacity: 0.2;
    cursor: not-allowed;
  }

  /* ─── 重命名输入框 ─────────────────────── */

  .rename-input {
    width: 100%;
    padding: 2px 6px;
    border: 1px solid var(--vscode-focusBorder);
    border-radius: 3px;
    background: var(--vscode-input-background);
    color: var(--vscode-input-foreground);
    font-size: 13px;
    font-family: inherit;
    outline: none;
    box-sizing: border-box;
  }

  /* ─── 新建配置栏 ─────────────────────── */

  .new-profile-bar {
    display: flex;
    gap: 6px;
    padding: 8px 0;
    align-items: center;
  }

  .new-profile-input {
    flex: 1;
    padding: 4px 8px;
    border: 1px solid var(--vscode-focusBorder);
    border-radius: 4px;
    background: var(--vscode-input-background);
    color: var(--vscode-input-foreground);
    font-size: 12px;
    font-family: inherit;
    outline: none;
    min-width: 0;
  }

  .spin {
    animation: spin 1s linear infinite;
  }

  @keyframes spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
  }

  .list-actions {
    display: flex;
    gap: 8px;
    padding: 12px 0 0;
    border-top: 1px solid var(--vscode-panel-border);
    margin-top: 8px;
  }

  .action-btn {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 5px 12px;
    border: 1px solid var(--vscode-panel-border);
    border-radius: 4px;
    background: var(--vscode-button-secondaryBackground, transparent);
    color: var(--vscode-foreground);
    font-size: 12px;
    cursor: pointer;
    transition: background 0.1s;
  }

  .action-btn:hover {
    background: var(--vscode-list-hoverBackground);
  }

  .action-btn.primary {
    background: var(--vscode-button-background);
    color: var(--vscode-button-foreground);
    border-color: transparent;
  }

  .action-btn.primary:hover {
    background: var(--vscode-button-hoverBackground);
  }
</style>
