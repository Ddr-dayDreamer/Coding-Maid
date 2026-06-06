<script lang="ts">
  import { appState, type TabId } from "../lib/state.svelte";
  import { api } from "../lib/api";

  const tabs: { id: TabId; label: string }[] = [
    { id: "chat", label: "对话" },
    { id: "presets", label: "预设" },
    { id: "profiles", label: "连接" },
    { id: "approvals", label: "审批" },
  ];

  function openSettings() {
    api.send("openSettings");
  }

  function switchTab(tab: TabId) {
    appState.currentTab = tab;
  }
</script>

<div class="tab-bar">
  <div class="tab-nav">
    {#each tabs as tab}
      <button
        class="tab-btn"
        class:active={appState.currentTab === tab.id}
        onclick={() => switchTab(tab.id)}
      >
        <span class="tab-label">{tab.label}</span>
      </button>
    {/each}
  </div>
  <button class="settings-btn" onclick={openSettings} title="打开设置">
    <span>⚙</span>
  </button>
</div>

<style>
  .tab-bar {
    display: flex;
    align-items: center;
    flex-shrink: 0;
    background: var(--vscode-sideBar-background);
    border-bottom: 1px solid var(--vscode-panel-border);
    padding: 0 8px;
  }

  .tab-nav {
    display: flex;
    gap: 0;
    flex: 1;
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

  .tab-label {
    font-size: 13px;
  }

  .settings-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    border: none;
    background: transparent;
    color: var(--vscode-sideBarTitle-foreground);
    cursor: pointer;
    font-size: 15px;
    opacity: 0.7;
    border-radius: 4px;
    transition: all 0.15s ease;
  }

  .settings-btn:hover {
    opacity: 1;
    background: var(--vscode-list-hoverBackground);
    color: var(--vscode-foreground);
  }
</style>
