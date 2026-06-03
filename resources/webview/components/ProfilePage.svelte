<script lang="ts">
  import { appState } from "../lib/state.svelte";
  import { api } from "../lib/api";
  import { onMount } from "svelte";

  let profiles = $state<string[]>([]);
  let loading = $state(true);
  let error = $state("");

  onMount(async () => {
    try {
      profiles = await api.request("listProfiles");
    } catch (e) {
      error = String(e);
    } finally {
      loading = false;
    }
  });
</script>

<div class="page">
  <div class="page-header">
    <h2>连接配置</h2>
    <span class="badge">即将推出</span>
  </div>

  {#if loading}
    <p class="hint">加载中...</p>
  {:else if error}
    <p class="hint error">{error}</p>
  {:else}
    <div class="profile-list">
      {#each profiles as profile}
        <div class="profile-card">
          <strong class:active={profile === appState.activeProfile}>
            {profile}
            {#if profile === appState.activeProfile}
              <span class="current">(当前)</span>
            {/if}
          </strong>
        </div>
      {:else}
        <p class="hint">暂无配置</p>
      {/each}
    </div>
  {/if}
</div>

<style>
  .page {
    flex: 1;
    overflow-y: auto;
    padding: 16px;
  }

  .page-header {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-bottom: 16px;
  }

  h2 {
    margin: 0;
    font-size: 16px;
    font-weight: 600;
  }

  .badge {
    font-size: 11px;
    padding: 2px 8px;
    border-radius: 4px;
    background: var(--vscode-badge-background);
    color: var(--vscode-badge-foreground);
  }

  .hint {
    color: var(--vscode-descriptionForeground);
    font-size: 13px;
  }

  .hint.error {
    color: var(--vscode-errorForeground);
  }

  .profile-list {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .profile-card {
    padding: 12px;
    border-radius: 6px;
    border: 1px solid var(--vscode-panel-border);
    background: var(--vscode-editor-background);
  }

  .current {
    font-size: 11px;
    color: var(--vscode-descriptionForeground);
    margin-left: 6px;
  }
</style>
