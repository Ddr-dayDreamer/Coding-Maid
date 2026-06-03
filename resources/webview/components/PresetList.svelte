<script lang="ts">
  import type { PresetMeta } from "../types";

  let {
    presets = [] as PresetMeta[],
    activePreset = "",
    loading = false,
    onselect = (_name: string) => {},
    onedit = (_name: string) => {},
    onexport = (_name: string) => {},
    ondelete = (_name: string) => {},
    onnew = () => {},
    onimport = () => {},
  }: {
    presets: PresetMeta[];
    activePreset: string;
    loading: boolean;
    onselect: (name: string) => void;
    onedit: (name: string) => void;
    onexport: (name: string) => void;
    ondelete: (name: string) => void;
    onnew: () => void;
    onimport: () => void;
  } = $props();
</script>

<div class="preset-list-panel">
  <div class="list-header">
    <h2>预设管理</h2>
    <span class="badge">{presets.length}</span>
  </div>

  {#if loading}
    <p class="hint">加载中...</p>
  {:else if presets.length === 0}
    <p class="hint">暂无预设，点击下方按钮新建</p>
  {:else}
    <div class="list-items">
      {#each presets as preset (preset.name)}
        <div
          class="list-item"
          class:active={preset.name === activePreset}
          onclick={() => onselect(preset.name)}
          role="button"
          tabindex="0"
          onkeydown={(e) => e.key === "Enter" && onselect(preset.name)}
        >
          <div class="item-info">
            <div class="item-name">
              {#if preset.name === activePreset}
                <span class="indicator">●</span>
              {/if}
              <strong>{preset.displayName}</strong>
              {#if preset.name === activePreset}
                <span class="current-tag">当前</span>
              {/if}
            </div>
            <p class="item-desc">{preset.description || "无描述"}</p>
          </div>
          <div class="item-actions" onclick={(e) => e.stopPropagation()}>
            <button class="icon-btn" title="编辑" onclick={() => onedit(preset.name)}>
              <svg viewBox="0 0 16 16" width="14" height="14">
                <path fill="currentColor" d="M11.013 1.427a1.75 1.75 0 0 1 2.474 0l1.086 1.086a1.75 1.75 0 0 1 0 2.474l-8.61 8.61c-.21.21-.47.364-.756.445l-3.251.93a.75.75 0 0 1-.927-.928l.929-3.25a1.75 1.75 0 0 1 .445-.758l8.61-8.61Zm1.414 1.06a.25.25 0 0 0-.354 0L3.103 11.46a.25.25 0 0 0-.064.108l-.558 1.953 1.953-.558a.25.25 0 0 0 .108-.064l8.97-8.97a.25.25 0 0 0 0-.354l-1.086-1.086Z"/>
              </svg>
            </button>
            <button class="icon-btn" title="导出" onclick={() => onexport(preset.name)}>
              <svg viewBox="0 0 16 16" width="14" height="14">
                <path fill="currentColor" d="M7.47 10.78a.75.75 0 0 0 1.06 0l3.75-3.75a.75.75 0 0 0-1.06-1.06L8.5 8.44V1.75a.75.75 0 0 0-1.5 0v6.69L4.78 5.97a.75.75 0 0 0-1.06 1.06l3.75 3.75ZM2 12.25v1.5c0 .966.784 1.75 1.75 1.75h8.5A1.75 1.75 0 0 0 14 13.75v-1.5a.75.75 0 0 0-1.5 0v1.5c0 .138-.112.25-.25.25h-8.5a.25.25 0 0 1-.25-.25v-1.5a.75.75 0 0 0-1.5 0Z"/>
              </svg>
            </button>
            <button
              class="icon-btn danger"
              title="删除"
              onclick={() => ondelete(preset.name)}
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
    <button class="action-btn primary" onclick={onnew}>
      <svg viewBox="0 0 16 16" width="14" height="14">
        <path fill="currentColor" d="M7.75 2a.75.75 0 0 1 .75.75V7h4.25a.75.75 0 0 1 0 1.5H8.5v4.25a.75.75 0 0 1-1.5 0V8.5H2.75a.75.75 0 0 1 0-1.5H7V2.75A.75.75 0 0 1 7.75 2Z"/>
      </svg>
      新建预设
    </button>
    <button class="action-btn" onclick={onimport}>
      <svg viewBox="0 0 16 16" width="14" height="14">
        <path fill="currentColor" d="M2.5 7.25a.75.75 0 0 1 1.5 0v4.5c0 .138.112.25.25.25h7.5a.25.25 0 0 0 .25-.25v-4.5a.75.75 0 0 1 1.5 0v4.5A1.75 1.75 0 0 1 11.75 13h-7.5A1.75 1.75 0 0 1 2.5 11.75v-4.5Zm6.78-4.97a.75.75 0 0 1 0 1.06L7.81 4.81a.75.75 0 0 1-1.06 0L5.28 3.34a.75.75 0 0 1 1.06-1.06l.66.66V.75a.75.75 0 0 1 1.5 0v2.19l.66-.66a.75.75 0 0 1 .72-.22Z"/>
      </svg>
      导入
    </button>
  </div>
</div>

<style>
  .preset-list-panel {
    flex: 1;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .list-header {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 0 0 12px;
  }

  .list-header h2 {
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

  .list-items {
    flex: 1;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .list-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 10px;
    border-radius: 6px;
    cursor: pointer;
    border: 1px solid transparent;
    transition: background 0.1s, border-color 0.1s;
  }

  .list-item:hover {
    background: var(--vscode-list-hoverBackground);
  }

  .list-item.active {
    background: var(--vscode-list-activeSelectionBackground);
    color: var(--vscode-list-activeSelectionForeground);
    border-color: var(--vscode-focusBorder);
  }

  .item-info {
    flex: 1;
    min-width: 0;
  }

  .item-name {
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

  .item-desc {
    margin: 2px 0 0;
    font-size: 11px;
    color: var(--vscode-descriptionForeground);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .list-item.active .item-desc {
    color: inherit;
    opacity: 0.8;
  }

  .item-actions {
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

  .icon-btn:hover {
    opacity: 1;
    background: var(--vscode-toolbar-hoverBackground);
  }

  .icon-btn.danger:hover {
    color: var(--vscode-errorForeground);
  }

  .icon-btn:disabled {
    opacity: 0.2;
    cursor: not-allowed;
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
