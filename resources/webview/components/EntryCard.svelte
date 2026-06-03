<script lang="ts">
  import type { PresetEntry, PresetEntryRole } from "../types";

  let {
    entry = { name: "", role: "system" as PresetEntryRole, content: "", enabled: true } as PresetEntry,
    index = 0,
    total = 1,
    isActive = false,
    onupdate = (_entry: PresetEntry) => {},
    ondelete = () => {},
    onmove = (_dir: -1 | 1) => {},
    onfocus = () => {},
  }: {
    entry: PresetEntry;
    index: number;
    total: number;
    isActive: boolean;
    onupdate: (entry: PresetEntry) => void;
    ondelete: () => void;
    onmove: (dir: -1 | 1) => void;
    onfocus: () => void;
  } = $props();

  const ROLE_OPTIONS: { value: PresetEntryRole; label: string }[] = [
    { value: "system", label: "system" },
    { value: "user", label: "user" },
    { value: "assistant", label: "assistant" },
    { value: "chat_history", label: "chat_history" },
  ];
</script>

<div class="entry-card" class:active={isActive}>
  <div class="entry-header">
    <div class="entry-drag-order">
      <button class="move-btn" title="上移" disabled={index === 0} onclick={() => onmove(-1)}>
        <svg viewBox="0 0 16 16" width="12" height="12">
          <path fill="currentColor" d="M3.47 9.78a.75.75 0 0 1 0-1.06l4.25-4.25a.75.75 0 0 1 1.06 0l4.25 4.25a.75.75 0 0 1-1.06 1.06L8 6.06l-3.47 3.47a.75.75 0 0 1-1.06 0Z"/>
        </svg>
      </button>
      <span class="entry-index">{index + 1}</span>
      <button class="move-btn" title="下移" disabled={index === total - 1} onclick={() => onmove(1)}>
        <svg viewBox="0 0 16 16" width="12" height="12">
          <path fill="currentColor" d="M3.47 5.22a.75.75 0 0 1 1.06 0L8 8.69l3.47-3.47a.75.75 0 0 1 1.06 1.06l-4.25 4.25a.75.75 0 0 1-1.06 0L3.47 6.28a.75.75 0 0 1 0-1.06Z"/>
        </svg>
      </button>
    </div>
    <div class="entry-meta">
      <input
        class="entry-name-input"
        type="text"
        value={entry.name ?? ""}
        placeholder="条目名称"
        oninput={(e) => onupdate({ ...entry, name: e.target.value })}
      />
      <select
        class="entry-role-select"
        value={entry.role}
        onchange={(e) => onupdate({ ...entry, role: e.target.value as PresetEntryRole })}
      >
        {#each ROLE_OPTIONS as opt}
          <option value={opt.value}>{opt.label}</option>
        {/each}
      </select>
      <label class="toggle-label" title="启用/禁用">
        <input
          type="checkbox"
          checked={entry.enabled}
          onchange={(e) => onupdate({ ...entry, enabled: e.target.checked })}
        />
        <span class="toggle-switch"></span>
      </label>
    </div>
    <button class="icon-btn danger" title="删除条目" onclick={ondelete}>
      <svg viewBox="0 0 16 16" width="12" height="12">
        <path fill="currentColor" d="M6.5 1.75a.25.25 0 0 1 .25-.25h2.5a.25.25 0 0 1 .25.25V3h-3V1.75Zm4.5 0V3h2.25a.75.75 0 0 1 0 1.5h-.12l-.66 8.69a1.75 1.75 0 0 1-1.74 1.56H4.27a1.75 1.75 0 0 1-1.74-1.56L1.87 4.5h-.12a.75.75 0 0 1 0-1.5H4V1.75C4 .784 4.784 0 5.75 0h4.5C11.216 0 12 .784 12 1.75Z"/>
      </svg>
    </button>
  </div>

  <div class="entry-content">
    <textarea
      class="entry-textarea"
      value={entry.content ?? ""}
      placeholder="输入提示词内容，支持 tool.xxx、char 等宏"
      rows={4}
      oninput={(e) => onupdate({ ...entry, content: e.target.value })}
      onfocus={onfocus}
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
    align-items: center;
    gap: 6px;
    padding: 6px 8px;
    background: var(--vscode-sideBar-background);
    border-bottom: 1px solid var(--vscode-panel-border);
  }

  .entry-drag-order {
    display: flex;
    align-items: center;
    gap: 2px;
    flex-shrink: 0;
  }

  .move-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 20px;
    height: 20px;
    padding: 0;
    border: none;
    border-radius: 3px;
    background: transparent;
    color: var(--vscode-foreground);
    cursor: pointer;
    opacity: 0.4;
    transition: opacity 0.1s, background 0.1s;
  }

  .move-btn:hover:not(:disabled) {
    opacity: 0.8;
    background: var(--vscode-toolbar-hoverBackground);
  }

  .move-btn:disabled {
    opacity: 0.15;
    cursor: not-allowed;
  }

  .entry-index {
    font-size: 10px;
    font-weight: 600;
    color: var(--vscode-descriptionForeground);
    min-width: 14px;
    text-align: center;
  }

  .entry-meta {
    flex: 1;
    display: flex;
    align-items: center;
    gap: 6px;
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
