<script lang="ts">
  import { appState } from "../lib/state.svelte";
  import { api } from "../lib/api";

  function removeFile(filePath: string) {
    appState.attachedFiles = appState.attachedFiles.filter((f) => f.filePath !== filePath);
    api.send("removeAttachedFile", { filePath });
  }

  function clearAll() {
    appState.attachedFiles = [];
    api.send("clearAttachedFiles");
  }

  function getDisplayName(file: { fileName: string; filePath: string }): string {
    if (file.fileName.endsWith("-snippet") || file.fileName.includes("snippet")) {
      return file.fileName.replace(/-\d+\.md$/, "");
    }
    return file.fileName;
  }

  function getIcon(file: { isSnippet?: boolean }): string {
    return file.isSnippet ? "✂" : "📄";
  }
</script>

{#if appState.attachedFiles.length > 0}
  <div class="attached-bar">
    <div class="attached-header">
      <span class="attached-label">附加文件</span>
      <button class="clear-btn" onclick={clearAll} title="清空全部">
        清空
      </button>
    </div>
    <div class="attached-chips">
      {#each appState.attachedFiles as file (file.filePath)}
        <span class="chip" title={file.filePath}>
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
  </div>
{/if}

<style>
  .attached-bar {
    flex-shrink: 0;
    padding: 4px 12px 0;
    background: var(--vscode-sideBar-background);
    border-top: 1px solid var(--vscode-panel-border);
  }

  .attached-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 3px;
  }

  .attached-label {
    font-size: 11px;
    color: var(--vscode-descriptionForeground);
    font-weight: 500;
  }

  .clear-btn {
    font-size: 10px;
    padding: 1px 6px;
    border: none;
    background: transparent;
    color: var(--vscode-descriptionForeground);
    cursor: pointer;
    border-radius: 3px;
    opacity: 0.6;
    transition: opacity 0.15s;
    font-family: inherit;
  }

  .clear-btn:hover {
    opacity: 1;
    color: var(--vscode-errorForeground, #e74c3c);
    background: var(--vscode-list-hoverBackground);
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
