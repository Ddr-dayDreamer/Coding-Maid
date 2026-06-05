<script lang="ts">
  import { appState } from "../lib/state.svelte";
  import { api } from "../lib/api";
  import { notify } from "../lib/notification.svelte";

  let attaching = $state(false);

  function removeFile(filePath: string) {
    appState.attachedFiles = appState.attachedFiles.filter((f) => f.filePath !== filePath);
    api.send("removeAttachedFile", { filePath });
  }

  function clearAll() {
    appState.attachedFiles = [];
    api.send("clearAttachedFiles");
  }

  function getDisplayName(file: { fileName: string; filePath: string }): string {
    const name = file.fileName;
    if (name.endsWith("-snippet") || name.includes("snippet")) {
      return name.replace(/-\d+\.md$/, "");
    }
    return name;
  }

  function getIcon(file: { isSnippet?: boolean }): string {
    return file.isSnippet ? "✂" : "📄";
  }

  async function attachEditorSelection() {
    if (attaching) return;
    attaching = true;
    try {
      const result = await api.request<{ filePath: string; fileName: string; isSnippet: boolean }>(
        "captureSelectionSnippet",
        {},
        3000,
      );
      appState.attachedFiles = [
        ...appState.attachedFiles,
        {
          filePath: result.filePath,
          fileName: result.fileName,
          isSnippet: true,
        },
      ];
    } catch {
      notify.info("请先在编辑器中选择代码", 2000);
    } finally {
      attaching = false;
    }
  }
</script>

<div class="attached-bar">
  <div class="attached-header">
    <span class="attached-label">
      附加文件-Shift拖入文件
      {#if appState.attachedFiles.length > 0}
        <span class="attached-count">({appState.attachedFiles.length})</span>
      {/if}
    </span>
    <div class="attached-actions">
      <button class="action-btn" onclick={attachEditorSelection} disabled={attaching} title="将编辑器中选中的代码附加为代码段">
        <svg viewBox="0 0 16 16" width="13" height="13" fill="currentColor">
          <path d="M4.5 2C3.12 2 2 3.12 2 4.5v7C2 12.88 3.12 14 4.5 14h7c1.38 0 2.5-1.12 2.5-2.5v-7C14 3.12 12.88 2 11.5 2h-7zM4 4.5C4 3.67 4.67 3 5.5 3h5c.83 0 1.5.67 1.5 1.5v5c0 .83-.67 1.5-1.5 1.5h-5A1.5 1.5 0 014 9.5v-5zm2 .5v5h1V5H6zm3 0v5h1V5H9z"/>
        </svg>
        附加选中代码
      </button>
      {#if appState.attachedFiles.length > 0}
        <button class="action-btn clear" onclick={clearAll} title="清空全部">
          清空
        </button>
      {/if}
    </div>
  </div>
  {#if appState.attachedFiles.length > 0}
    <div class="attached-chips">
      {#each appState.attachedFiles as file (file.filePath)}
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <span
          class="chip"
          title="双击移除：{file.filePath}"
          ondblclick={() => removeFile(file.filePath)}
        >
          <span class="chip-icon">{getIcon(file)}</span>
          <span class="chip-name">{getDisplayName(file)}</span>
          <button
            class="chip-remove"
            onclick={() => removeFile(file.filePath)}
            title="移除"
          >✕</button>
        </span>
      {/each}
    </div>
  {/if}
</div>

<style>
  .attached-bar {
    flex-shrink: 0;
    padding: 6px 12px 0;
  }

  .attached-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 3px;
    gap: 8px;
  }

  .attached-label {
    font-size: 11px;
    color: var(--vscode-descriptionForeground);
    font-weight: 500;
    flex-shrink: 0;
  }

  .attached-count {
    font-weight: 400;
    opacity: 0.7;
  }

  .attached-actions {
    display: flex;
    gap: 4px;
    align-items: center;
    flex-wrap: nowrap;
    justify-content: flex-end;
  }

  .action-btn {
    font-size: 10px;
    padding: 1px 6px;
    border: 1px solid var(--vscode-panel-border);
    background: transparent;
    color: var(--vscode-foreground);
    cursor: pointer;
    border-radius: 4px;
    opacity: 0.7;
    transition: opacity 0.15s, background 0.15s, border-color 0.15s;
    font-family: inherit;
    line-height: 1.6;
    display: inline-flex;
    align-items: center;
    gap: 3px;
    white-space: nowrap;
  }

  .action-btn:hover:not(:disabled) {
    opacity: 1;
    background: var(--vscode-list-hoverBackground);
    border-color: var(--vscode-focusBorder);
  }

  .action-btn:disabled {
    opacity: 0.3;
    cursor: not-allowed;
  }

  .action-btn.clear:hover {
    color: var(--vscode-errorForeground, #e74c3c);
    border-color: var(--vscode-errorForeground, #e74c3c);
  }

  .attached-chips {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    padding-bottom: 4px;
  }

  .chip {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    padding: 2px 6px;
    font-size: 11px;
    line-height: 1.4;
    border-radius: 4px;
    background: var(--vscode-badge-background, var(--vscode-input-background));
    color: var(--vscode-badge-foreground, var(--vscode-foreground));
    border: 1px solid var(--vscode-panel-border);
    max-width: 220px;
    cursor: default;
    transition: border-color 0.15s;
  }

  .chip:hover {
    border-color: var(--vscode-focusBorder);
    cursor: pointer;
  }

  .chip-icon {
    flex-shrink: 0;
    font-size: 11px;
    opacity: 0.7;
  }

  .chip-name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .chip-remove {
    flex-shrink: 0;
    width: 14px;
    height: 14px;
    display: grid;
    place-items: center;
    border: none;
    background: transparent;
    color: var(--vscode-descriptionForeground);
    cursor: pointer;
    padding: 0;
    font-size: 9px;
    line-height: 1;
    border-radius: 3px;
    opacity: 0.5;
    transition: opacity 0.15s;
  }

  .chip-remove:hover {
    opacity: 1;
    color: var(--vscode-errorForeground, #e74c3c);
    background: var(--vscode-list-hoverBackground);
  }
</style>
