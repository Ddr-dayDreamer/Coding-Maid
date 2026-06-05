<script lang="ts">
  import type { PresetEntry, PresetEntryRole } from "../types";

  let {
    entry = { name: "", role: "system" as PresetEntryRole, content: "", enabled: true } as PresetEntry,
    index = 0,
    isActive = false,
    onupdate = (_entry: PresetEntry) => {},
    ondelete = () => {},
    onfocus = () => {},
  }: {
    entry: PresetEntry;
    index: number;
    isActive: boolean;
    onupdate: (entry: PresetEntry) => void;
    ondelete: () => void;
    onfocus: () => void;
  } = $props();

  let textareaEl: HTMLTextAreaElement | undefined = $state();

  const ROLE_OPTIONS: { value: PresetEntryRole; label: string }[] = [
    { value: "system", label: "system" },
    { value: "user", label: "user" },
    { value: "assistant", label: "assistant" },
    { value: "chat_history", label: "chat_history" },
  ];
</script>

<div class="entry-card" class:active={isActive} class:disabled={!entry.enabled}
  role="listitem"
>
  <div class="entry-header">
    <div class="entry-drag-order">
      <span class="drag-handle" title="拖拽排序"
        draggable={true}
        ondragstart={(e) => {
          e.dataTransfer.setData("text/plain", String(index));
          e.dataTransfer.effectAllowed = "move";
          e.stopPropagation();
        }}
      >
        <svg viewBox="0 0 16 16" width="14" height="14">
          <path fill="currentColor" d="M5 3a1 1 0 1 1-2 0 1 1 0 0 1 2 0Zm4 0a1 1 0 1 1-2 0 1 1 0 0 1 2 0Zm3 1a1 1 0 1 0 0-2 1 1 0 0 0 0 2ZM5 8a1 1 0 1 1-2 0 1 1 0 0 1 2 0Zm4 0a1 1 0 1 1-2 0 1 1 0 0 1 2 0Zm3 1a1 1 0 1 0 0-2 1 1 0 0 0 0 2ZM5 13a1 1 0 1 1-2 0 1 1 0 0 1 2 0Zm4 0a1 1 0 1 1-2 0 1 1 0 0 1 2 0Zm3 1a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z"/>
        </svg>
      </span>
      <span class="entry-index">{index + 1}</span>
    </div>
    <input
      class="entry-name-input"
      type="text"
      value={entry.name ?? ""}
      placeholder="条目名称"
      oninput={(e) => onupdate({ ...entry, name: e.target.value })}
    />
    <div class="entry-actions">
      <select
        class="entry-role-select"
        value={entry.role}
        onchange={(e) => onupdate({ ...entry, role: e.target.value as PresetEntryRole })}
      >
        {#each ROLE_OPTIONS as opt}
          <option value={opt.value}>{opt.label}</option>
        {/each}
      </select>
      <div class="action-divider"></div>
      <label class="toggle-label" title="启用/禁用">
        <input
          type="checkbox"
          checked={entry.enabled}
          onchange={(e) => onupdate({ ...entry, enabled: e.target.checked })}
        />
        <span class="toggle-switch"></span>
      </label>
      <button class="icon-btn danger" title="删除条目" onclick={ondelete}>
        <svg viewBox="0 0 16 16" width="12" height="12">
          <path fill="currentColor" d="M6.5 1.75a.25.25 0 0 1 .25-.25h2.5a.25.25 0 0 1 .25.25V3h-3V1.75Zm4.5 0V3h2.25a.75.75 0 0 1 0 1.5h-.12l-.66 8.69a1.75 1.75 0 0 1-1.74 1.56H4.27a1.75 1.75 0 0 1-1.74-1.56L1.87 4.5h-.12a.75.75 0 0 1 0-1.5H4V1.75C4 .784 4.784 0 5.75 0h4.5C11.216 0 12 .784 12 1.75Z"/>
        </svg>
      </button>
    </div>
  </div>

  <div class="entry-content">
    <textarea
      bind:this={textareaEl}
      class="entry-textarea"
      value={entry.content ?? ""}
      placeholder="输入提示词内容，支持 tool.xxx、char 等宏"
      rows={4}
      oninput={(e) => onupdate({ ...entry, content: e.target.value })}
      onfocus={() => {
        if (textareaEl) onfocus(textareaEl);
      }}
    ></textarea>
  </div>
</div>

<style>
  .entry-card {
    border: 1px solid var(--vscode-panel-border);
    border-radius: 6px;
    background: var(--vscode-editor-background);
    overflow: hidden;
    transition: border-color 0.1s;
    margin-bottom: 8px;
  }

  .entry-card.active {
    border-color: var(--vscode-focusBorder);
  }

  .entry-header {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 4px 6px;
    padding: 6px 8px;
    background: var(--vscode-sideBar-background);
    border-bottom: 1px solid var(--vscode-panel-border);
  }

  .entry-card.disabled {
    opacity: 0.5;
  }

  .entry-card.disabled .entry-textarea {
    opacity: 0.55;
  }

  .entry-drag-order {
    display: flex;
    align-items: center;
    gap: 2px;
    flex-shrink: 0;
  }

  .drag-handle {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 18px;
    height: 20px;
    padding: 0;
    border: none;
    border-radius: 3px;
    background: transparent;
    color: var(--vscode-foreground);
    opacity: 0.3;
    transition: opacity 0.1s;
    cursor: grab;
  }

  .drag-handle:active {
    cursor: grabbing;
  }

  .entry-card:hover .drag-handle {
    opacity: 0.6;
  }

  .drag-handle:hover {
    opacity: 0.9 !important;
    background: var(--vscode-toolbar-hoverBackground);
  }

  .entry-index {
    font-size: 10px;
    font-weight: 600;
    color: var(--vscode-descriptionForeground);
    min-width: 14px;
    text-align: center;
  }

  .entry-name-input {
    flex: 1;
    min-width: 80px;
    padding: 2px 6px;
    border: 1px solid var(--vscode-input-border, var(--vscode-panel-border));
    border-radius: 3px;
    background: var(--vscode-input-background);
    color: var(--vscode-input-foreground);
    font-size: 12px;
    font-family: inherit;
  }

  .entry-name-input:focus {
    outline: none;
    border-color: var(--vscode-focusBorder);
  }

  .entry-actions {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-shrink: 0;
  }

  .action-divider {
    width: 1px;
    height: 16px;
    background: var(--vscode-panel-border);
    flex-shrink: 0;
  }

  .entry-role-select {
    padding: 1px 4px;
    border: 1px solid var(--vscode-panel-border);
    border-radius: 3px;
    background: var(--vscode-dropdown-background);
    color: var(--vscode-dropdown-foreground);
    font-size: 11px;
    font-family: inherit;
  }

  .toggle-label {
    position: relative;
    display: inline-flex;
    align-items: center;
    cursor: pointer;
  }

  .toggle-label input {
    position: absolute;
    opacity: 0;
    width: 0;
    height: 0;
  }

  .toggle-switch {
    width: 26px;
    height: 14px;
    border-radius: 7px;
    background: var(--vscode-input-border, #ccc);
    transition: background 0.15s;
    position: relative;
  }

  .toggle-switch::after {
    content: "";
    position: absolute;
    top: 2px;
    left: 2px;
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: var(--vscode-foreground);
    transition: transform 0.15s;
  }

  .toggle-label input:checked + .toggle-switch {
    background: var(--vscode-button-background);
  }

  .toggle-label input:checked + .toggle-switch::after {
    transform: translateX(12px);
    background: var(--vscode-button-foreground);
  }

  .icon-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    padding: 0;
    border: none;
    border-radius: 3px;
    background: transparent;
    color: var(--vscode-foreground);
    cursor: pointer;
    opacity: 0.4;
    transition: opacity 0.1s, background 0.1s;
    flex-shrink: 0;
  }

  .icon-btn:hover {
    opacity: 1;
    background: var(--vscode-toolbar-hoverBackground);
  }

  .icon-btn.danger:hover {
    color: var(--vscode-errorForeground);
  }

  .entry-content {
    padding: 6px 8px;
  }

  .entry-textarea {
    width: 100%;
    min-height: 60px;
    padding: 6px 8px;
    border: 1px solid var(--vscode-input-border, var(--vscode-panel-border));
    border-radius: 4px;
    background: var(--vscode-input-background);
    color: var(--vscode-input-foreground);
    font-size: 12px;
    font-family: var(--vscode-editor-font-family, monospace);
    resize: vertical;
    line-height: 1.5;
    tab-size: 2;
  }

  .entry-textarea:focus {
    outline: none;
    border-color: var(--vscode-focusBorder);
  }
</style>
