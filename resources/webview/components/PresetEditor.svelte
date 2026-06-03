<script lang="ts">
  import type { PresetDefinition, PresetEntry } from "../types";
  import EntryCard from "./EntryCard.svelte";
  import MacroPanel from "./MacroPanel.svelte";

  let {
    definition = {
      name: "", description: "",
      availableTools: ["bash", "read", "write", "edit", "AskUserQuestion", "UpdatePlan", "WebSearch"],
      entries: [],
    } as PresetDefinition,
    presetName = "",
    onsave = (_name: string, _def: PresetDefinition) => {},
    oncancel = () => {},
  }: {
    definition: PresetDefinition;
    presetName: string;
    onsave: (name: string, def: PresetDefinition) => void;
    oncancel: () => void;
  } = $props();

  // ─── 编辑状态 ──────────────────────────────────────

  let editName = $state(presetName);
  let editDef = $state<PresetDefinition>(deepClone(definition));
  let activeEntryIndex = $state<number | null>(null);

  // 当外部 definition 变化时同步（不能用 structuredClone，$state prop 传过来的是 Proxy）
  $effect(() => {
    editName = presetName;
    editDef = deepClone(definition);
  });

  function deepClone<T>(obj: T): T {
    return JSON.parse(JSON.stringify(obj));
  }

  const ALL_TOOLS = [
    { id: "bash", label: "Bash" },
    { id: "read", label: "Read" },
    { id: "write", label: "Write" },
    { id: "edit", label: "Edit" },
    { id: "AskUserQuestion", label: "AskUser" },
    { id: "UpdatePlan", label: "Plan" },
    { id: "WebSearch", label: "Search" },
  ];

  // ─── 条目操作 ──────────────────────────────────────

  function addEntry() {
    editDef.entries = [...editDef.entries, {
      name: "新条目",
      role: "system" as const,
      content: "",
      enabled: true,
    }];
    activeEntryIndex = editDef.entries.length - 1;
  }

  function updateEntry(index: number, entry: PresetEntry) {
    const entries = [...editDef.entries];
    entries[index] = entry;
    editDef.entries = entries;
  }

  function deleteEntry(index: number) {
    editDef.entries = editDef.entries.filter((_, i) => i !== index);
    if (activeEntryIndex === index) activeEntryIndex = null;
  }

  function moveEntry(index: number, direction: -1 | 1) {
    const entries = [...editDef.entries];
    const target = index + direction;
    if (target < 0 || target >= entries.length) return;
    [entries[index], entries[target]] = [entries[target], entries[index]];
    editDef.entries = entries;
    activeEntryIndex = target;
  }

  // ─── 宏操作 ──────────────────────────────────────

  function insertMacro(macro: string) {
    if (activeEntryIndex === null) return;
    const entry = { ...editDef.entries[activeEntryIndex] };
    entry.content += macro;
    updateEntry(activeEntryIndex, entry);
  }

  // ─── 工具切换 ──────────────────────────────────────

  function toggleTool(toolId: string) {
    const current = editDef.availableTools;
    if (current.includes(toolId)) {
      editDef.availableTools = current.filter((t) => t !== toolId);
    } else {
      editDef.availableTools = [...current, toolId];
    }
  }

  // ─── 保存 ──────────────────────────────────────────

  function handleSave() {
    // deepClone 至关重要：editDef 是 $state proxy，
    // 直接传入会被 vscode.postMessage 的 structured clone 拒绝
    onsave(editName, deepClone(editDef));
  }
</script>

<div class="editor-panel">
  <div class="editor-header">
    <button class="back-btn" onclick={oncancel}>
      <svg viewBox="0 0 16 16" width="14" height="14">
        <path fill="currentColor" d="M9.78 11.78a.75.75 0 0 1-1.06 0L5.47 8.53a.75.75 0 0 1 0-1.06l3.25-3.25a.75.75 0 0 1 1.06 1.06L7.06 8l2.72 2.72a.75.75 0 0 1 0 1.06Z"/>
      </svg>
      返回
    </button>
    <h2>{presetName ? `编辑: ${presetName}` : "新建预设"}</h2>
  </div>

  <!-- 元信息 -->
  <div class="meta-section">
    <div class="field-row">
      <label class="field-label">标识名称</label>
      <input class="field-input" type="text" value={editName} placeholder="preset-name"
        oninput={(e) => (editName = e.target.value)} />
    </div>
    <div class="field-row">
      <label class="field-label">显示名称</label>
      <input class="field-input" type="text" value={editDef.name} placeholder="我的预设"
        oninput={(e) => (editDef = { ...editDef, name: e.target.value })} />
    </div>
    <div class="field-row">
      <label class="field-label">描述</label>
      <input class="field-input" type="text" value={editDef.description} placeholder="预设用途说明"
        oninput={(e) => (editDef = { ...editDef, description: e.target.value })} />
    </div>
    <div class="field-row half">
      <div class="half-field">
        <label class="field-label">char 变量</label>
        <input class="field-input" type="text" value={editDef.char ?? ""} placeholder="Coding Maid"
          oninput={(e) => (editDef = { ...editDef, char: e.target.value })} />
      </div>
      <div class="half-field">
        <label class="field-label">user 变量</label>
        <input class="field-input" type="text" value={editDef.user ?? ""} placeholder="user"
          oninput={(e) => (editDef = { ...editDef, user: e.target.value })}
        />
      </div>
    </div>

    <!-- 可用工具 -->
    <div class="field-row">
      <label class="field-label">可用工具</label>
      <div class="tool-chips">
        {#each ALL_TOOLS as tool}
          <button
            class="chip"
            class:active={editDef.availableTools.includes(tool.id)}
            onclick={() => toggleTool(tool.id)}
          >
            {tool.label}
          </button>
        {/each}
      </div>
    </div>
  </div>

  <!-- 条目列表 -->
  <div class="entries-section">
    <div class="entries-header">
      <label class="field-label">预设条目（{editDef.entries.length}）</label>
      <button class="add-entry-btn" onclick={addEntry}>
        <svg viewBox="0 0 16 16" width="12" height="12">
          <path fill="currentColor" d="M7.75 2a.75.75 0 0 1 .75.75V7h4.25a.75.75 0 0 1 0 1.5H8.5v4.25a.75.75 0 0 1-1.5 0V8.5H2.75a.75.75 0 0 1 0-1.5H7V2.75A.75.75 0 0 1 7.75 2Z"/>
        </svg>
        添加条目
      </button>
    </div>

    <div class="entries-list">
      {#each editDef.entries as entry, i (i)}
        <EntryCard
          {entry}
          index={i}
          total={editDef.entries.length}
          isActive={activeEntryIndex === i}
          onupdate={(e) => updateEntry(i, e)}
          ondelete={() => deleteEntry(i)}
          onmove={(d) => moveEntry(i, d)}
          onfocus={() => (activeEntryIndex = i)}
        />
      {/each}
      {#if editDef.entries.length === 0}
        <p class="empty-hint">暂无条目，点击"添加条目"开始</p>
      {/if}
    </div>
  </div>

  <!-- 宏插入面板 -->
  <MacroPanel disabled={activeEntryIndex === null} oninsert={insertMacro} />

  <!-- 底部操作 -->
  <div class="editor-footer">
    <button class="action-btn primary" onclick={handleSave}>
      <svg viewBox="0 0 16 16" width="14" height="14">
        <path fill="currentColor" d="M11.28 6.78a.75.75 0 0 0-1.06-1.06L7.25 8.69 5.78 7.22a.75.75 0 0 0-1.06 1.06l2 2a.75.75 0 0 0 1.06 0l3.5-3.5Z"/>
        <path fill="currentColor" d="M0 2.75C0 1.784.784 1 1.75 1H9c.464 0 .91.184 1.24.513l2.247 2.247c.329.33.513.776.513 1.24v8.25A1.75 1.75 0 0 1 11.25 15H1.75A1.75 1.75 0 0 1 0 13.25V2.75Zm1.75-.25a.25.25 0 0 0-.25.25v10.5c0 .138.112.25.25.25h9.5a.25.25 0 0 0 .25-.25V5.704a.25.25 0 0 0-.073-.177l-2.204-2.204a.25.25 0 0 0-.177-.073H1.75Z"/>
      </svg>
      保存
    </button>
    <button class="action-btn" onclick={oncancel}>取消</button>
  </div>
</div>

<style>
  .editor-panel {
    height: 100%;
    overflow-y: auto;
    overflow-x: hidden;
    padding-right: 4px;
    word-break: break-word;
  }

  .editor-header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 0 0 12px;
    flex-shrink: 0;
  }

  .editor-header h2 {
    margin: 0;
    font-size: 14px;
    font-weight: 600;
  }

  .back-btn {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 3px 8px;
    border: none;
    border-radius: 4px;
    background: transparent;
    color: var(--vscode-foreground);
    font-size: 12px;
    cursor: pointer;
    opacity: 0.7;
    transition: opacity 0.1s, background 0.1s;
  }

  .back-btn:hover {
    opacity: 1;
    background: var(--vscode-list-hoverBackground);
  }

  .meta-section {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding-bottom: 8px;
    border-bottom: 1px solid var(--vscode-panel-border);
  }

  .field-row {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .field-row.half {
    flex-direction: row;
    gap: 8px;
  }

  .half-field {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .field-label {
    font-size: 11px;
    font-weight: 500;
    color: var(--vscode-descriptionForeground);
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }

  .field-input {
    width: 100%;
    max-width: 100%;
    padding: 3px 6px;
    border: 1px solid var(--vscode-input-border, var(--vscode-panel-border));
    border-radius: 3px;
    background: var(--vscode-input-background);
    color: var(--vscode-input-foreground);
    font-size: 12px;
    font-family: inherit;
    box-sizing: border-box;
  }

  .field-input:focus {
    outline: none;
    border-color: var(--vscode-focusBorder);
  }

  .tool-chips {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }

  .chip {
    padding: 2px 8px;
    border: 1px solid var(--vscode-input-border, var(--vscode-panel-border));
    border-radius: 10px;
    background: var(--vscode-input-background);
    color: var(--vscode-input-foreground);
    font-size: 10px;
    cursor: pointer;
    transition: all 0.1s;
  }

  .chip:hover {
    border-color: var(--vscode-focusBorder);
  }

  .chip.active {
    background: var(--vscode-button-background);
    color: var(--vscode-button-foreground);
    border-color: transparent;
  }

  .entries-section {
    padding-top: 12px;
  }

  .entries-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 8px;
  }

  .add-entry-btn {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 3px 10px;
    border: 1px solid var(--vscode-panel-border);
    border-radius: 4px;
    background: transparent;
    color: var(--vscode-foreground);
    font-size: 11px;
    cursor: pointer;
    transition: background 0.1s;
  }

  .add-entry-btn:hover {
    background: var(--vscode-list-hoverBackground);
  }

  .entries-list {
    padding-right: 4px;
  }

  .empty-hint {
    text-align: center;
    color: var(--vscode-descriptionForeground);
    font-size: 12px;
    padding: 32px 16px;
    border: 1px dashed var(--vscode-panel-border);
    border-radius: 6px;
    margin: 8px 0;
  }

  .editor-footer {
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
    padding: 5px 14px;
    border: 1px solid var(--vscode-panel-border);
    border-radius: 4px;
    background: transparent;
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
