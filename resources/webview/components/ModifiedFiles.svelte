<script lang="ts">
  import { appState } from "../lib/state.svelte";
  import { api } from "../lib/api";

  let collapsed = $state(false);

  function getFileName(filePath: string): string {
    const parts = filePath.split(/[\\/]/);
    return parts[parts.length - 1] || filePath;
  }

  function getDirName(filePath: string): string {
    const idx = Math.max(filePath.lastIndexOf("\\"), filePath.lastIndexOf("/"));
    return idx > 0 ? filePath.slice(0, idx) : "";
  }

  /** 左键单击：在编辑器中打开文件 */
  function openFile(filePath: string) {
    api.send("openFile", { filePath, line: 1 });
  }

  /** 右键：打开 git diff 视图（vs code 原生 diff） */
  function openDiff(e: MouseEvent, filePath: string) {
    e.preventDefault();
    api.send("openFileDiff", { filePath });
  }

  /** 清除：清除修改文件列表 + 编辑器高亮装饰 */
  function handleClear(e: MouseEvent) {
    e.stopPropagation();
    appState.modifiedFiles = [];
    api.send("clearFileChanges");
  }
</script>

{#if appState.modifiedFiles.length > 0}
  <div class="modified-files">
    <div class="header" role="button" tabindex="0" onclick={() => (collapsed = !collapsed)} onkeydown={(e) => e.key === "Enter" && (collapsed = !collapsed)}>
      <svg class="chevron" class:rotated={!collapsed} viewBox="0 0 16 16" width="12" height="12">
        <path d="M6 4l4 4-4 4" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
      </svg>
      <span class="header-label">修改的文件</span>
      <span class="header-count">{appState.modifiedFiles.length}</span>
      <button class="clear-btn" onclick={handleClear} title="清除修改文件列表与编辑器高亮">&times;</button>
    </div>

    {#if !collapsed}
      <div class="file-list">
        {#each appState.modifiedFiles as file (file.filePath)}
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <div
            class="file-item"
            onclick={() => openFile(file.filePath)}
            oncontextmenu={(e) => openDiff(e, file.filePath)}
            role="button"
            tabindex="0"
            title="左键打开 ｜ 右键 Diff"
          >
            <svg class="file-icon" viewBox="0 0 16 16" width="12" height="12">
              <path d="M2 1.5C2 .67 2.67 0 3.5 0h5.59c.4 0 .78.16 1.06.44l3.41 3.41c.28.28.44.66.44 1.06V14.5c0 .83-.67 1.5-1.5 1.5h-9A1.5 1.5 0 012 14.5V1.5z" fill="currentColor" opacity="0.3"/>
              <path d="M9 0v3c0 .55.45 1 1 1h3" fill="none" stroke="currentColor" stroke-width="1.2"/>
            </svg>
            <span class="file-name">{getFileName(file.filePath)}</span>
            <span class="file-dir">{getDirName(file.filePath)}</span>
          </div>
        {/each}
      </div>
    {/if}
  </div>
{/if}

<style>
  .modified-files {
    border-top: 1px solid var(--vscode-panel-border);
    background: var(--vscode-sideBar-background);
    flex-shrink: 0;
  }

  .header {
    display: flex;
    align-items: center;
    gap: 6px;
    width: 100%;
    padding: 4px 8px 4px 12px;
    border: none;
    background: transparent;
    color: var(--vscode-sideBarTitle-foreground);
    cursor: pointer;
    font-size: 11px;
    font-weight: 500;
    opacity: 0.8;
    transition: background 0.15s;
    box-sizing: border-box;
  }
  .header:hover {
    opacity: 1;
    background: var(--vscode-list-hoverBackground);
  }

  .chevron {
    transition: transform 0.15s ease;
    flex-shrink: 0;
  }
  .chevron.rotated {
    transform: rotate(90deg);
  }

  .header-label {
    flex: 1;
    text-align: left;
  }

  .header-count {
    font-size: 10px;
    opacity: 0.6;
    background: var(--vscode-badge-background);
    color: var(--vscode-badge-foreground);
    padding: 0 5px;
    border-radius: 7px;
    line-height: 14px;
  }

  .clear-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 18px;
    height: 18px;
    border: none;
    background: transparent;
    color: var(--vscode-sideBarTitle-foreground);
    cursor: pointer;
    font-size: 14px;
    line-height: 1;
    opacity: 0.4;
    border-radius: 3px;
    padding: 0;
    transition: opacity 0.15s, background 0.15s;
  }
  .clear-btn:hover {
    opacity: 1;
    background: var(--vscode-list-hoverBackground);
  }

  .file-list {
    max-height: 160px;
    overflow-y: auto;
  }

  .file-item {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 2px 8px 2px 20px;
    cursor: pointer;
    transition: background 0.1s;
    user-select: none;
    line-height: 18px;
  }
  .file-item:hover {
    background: var(--vscode-list-hoverBackground);
  }

  .file-icon {
    flex-shrink: 0;
    opacity: 0.5;
  }

  .file-name {
    font-size: 12px;
    color: var(--vscode-foreground);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    flex-shrink: 0;
    max-width: 40%;
  }

  .file-dir {
    font-size: 11px;
    color: var(--vscode-descriptionForeground);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    opacity: 0.6;
    min-width: 0;
  }
</style>
