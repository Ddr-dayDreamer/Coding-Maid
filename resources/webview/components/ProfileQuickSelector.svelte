<script lang="ts">
  import { appState } from "../lib/state.svelte";
  import { api } from "../lib/api";
  import type { ProfileMeta } from "../types";

  let open = $state(false);
  let items = $state<ProfileMeta[]>([]);

  async function toggle() {
    if (!open && items.length === 0) {
      try {
        items = await api.request<ProfileMeta[]>("listProfiles");
      } catch {
        // 静默失败
      }
    }
    open = !open;
  }

  function select(name: string) {
    if (name === appState.activeProfile) {
      open = false;
      return;
    }
    open = false;
    api.send("selectProfile", { name });
    appState.activeProfile = name;
  }
</script>

<div class="quick-selector">
  <button class="badge-btn" onclick={toggle}>
    配置: {appState.activeProfile}
    <svg class="arrow" class:open={open} viewBox="0 0 1024 1024" width="10" height="10">
      <path d="M884 256h-75c-5.1 0-9.9 2.5-12.9 6.6L512 654.2 227.9 262.6c-3-4.1-7.8-6.6-12.9-6.6h-75c-6.5 0-10.3 7.4-6.5 12.7l352.6 486.1c12.8 17.6 39 17.6 51.7 0l352.6-486.1c3.9-5.3.1-12.7-6.4-12.7z"/>
    </svg>
  </button>
  {#if open}
    <div class="dropdown">
      {#each items as item (item.name)}
        <button
          class="dropdown-item"
          class:active={item.name === appState.activeProfile}
          onclick={() => select(item.name)}
        >
          <span class="item-name">{item.name}</span>
          {#if item.name === appState.activeProfile}
            <span class="check">✓</span>
          {/if}
        </button>
      {:else}
        <div class="empty">暂无配置</div>
      {/each}
    </div>
  {/if}
</div>

<style>
  .quick-selector {
    position: relative;
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

  .arrow {
    fill: currentColor;
    transition: transform 0.15s;
  }

  .arrow.open {
    transform: rotate(180deg);
  }

  .dropdown {
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
    box-shadow: 0 -4px 12px rgba(0, 0, 0, 0.2);
    padding: 4px 0;
  }

  .dropdown-item {
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

  .dropdown-item:hover {
    background: var(--vscode-list-hoverBackground);
  }

  .dropdown-item.active {
    background: var(--vscode-list-activeSelectionBackground);
    color: var(--vscode-list-activeSelectionForeground);
  }

  .item-name {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .check {
    flex-shrink: 0;
    margin-left: 8px;
    font-weight: 600;
  }

  .empty {
    padding: 12px;
    text-align: center;
    color: var(--vscode-descriptionForeground);
    font-size: 12px;
  }
</style>
