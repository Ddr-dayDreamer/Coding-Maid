<script lang="ts">
  import { appState, type TabId } from "../lib/state.svelte";

  const tabs: { id: TabId; label: string; icon: string }[] = [
    { id: "chat", label: "对话", icon: "💬" },
    { id: "presets", label: "预设", icon: "📋" },
    { id: "profiles", label: "连接", icon: "🔌" },
  ];

  function switchTab(tab: TabId) {
    appState.currentTab = tab;
  }
</script>

<div class="tab-bar">
  <div class="tab-header">
    <span class="tab-title">Coding Maid</span>
  </div>
  <div class="tab-nav">
    {#each tabs as tab}
      <button
        class="tab-btn"
        class:active={appState.currentTab === tab.id}
        onclick={() => switchTab(tab.id)}
      >
        <span class="tab-icon">{tab.icon}</span>
        <span class="tab-label">{tab.label}</span>
      </button>
    {/each}
  </div>
</div>

<style>
  .tab-bar {
    flex-shrink: 0;
    background: var(--vscode-sideBar-background);
    border-bottom: 1px solid var(--vscode-panel-border);
  }

  .tab-header {
    display: flex;
    align-items: center;
    padding: 8px 12px 4px;
  }

  .tab-title {
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: var(--vscode-descriptionForeground);
  }

  .tab-nav {
    display: flex;
    gap: 0;
    padding: 0 8px;
  }

  .tab-btn {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 8px 16px;
    border: none;
    background: transparent;
    color: var(--vscode-sideBarTitle-foreground);
    cursor: pointer;
    font-size: 13px;
    border-bottom: 2px solid transparent;
    transition: all 0.15s ease;
    opacity: 0.7;
  }

  .tab-btn:hover {
    opacity: 1;
    background: var(--vscode-list-hoverBackground);
  }

  .tab-btn.active {
    opacity: 1;
    border-bottom-color: var(--vscode-focusBorder);
    color: var(--vscode-foreground);
  }

  .tab-icon {
    font-size: 14px;
  }

  .tab-label {
    font-size: 13px;
  }
</style>
