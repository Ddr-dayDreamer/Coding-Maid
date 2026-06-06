<script lang="ts">
  import { appState } from "../lib/state.svelte";
  import { api } from "../lib/api";
  import { notify } from "../lib/notification.svelte";
  import { onMount } from "svelte";
  import { getBuiltinToolIds } from "../../../src/tools/builtin-tools";

  // ─── 内置工具列表（从 canonical 数据源导入）─

  const BUILTIN_TOOLS = getBuiltinToolIds();

  const TOOL_LABELS: Record<string, string> = {
    bash: "执行命令",
    read: "读取文件",
    write: "写入文件",
    edit: "编辑文件",
    AskUserQuestion: "向用户提问",
    UpdatePlan: "更新计划",
    search: "搜索代码",
    list_dir: "列出目录",
    find_references: "查找引用",
    rename_symbol: "重命名符号",
    get_errors: "获取错误",
    fetch_webpage: "抓取网页",
    memory: "记忆管理",
  };

  // ─── 状态 ──────────────────────────────────

  type ToolEntry = {
    name: string;
    label: string;
    mode: string;
  };

  let tools = $state<ToolEntry[]>([]);
  let loading = $state(true);
  let changed = $state(false);

  // ─── 加载 ──────────────────────────────────

  onMount(async () => {
    await loadConfig();
  });

  async function loadConfig() {
    loading = true;
    try {
      // 先尝试从后端请求
      try {
        const config = await api.request<Record<string, string>>("getApprovalConfig");
        appState.approvalConfig = config;
      } catch {
        // 用已有的 state
      }
      buildToolList();
    } catch {
      notify.error("加载审批配置失败");
    } finally {
      loading = false;
    }
  }

  function buildToolList() {
    tools = BUILTIN_TOOLS.map((name) => ({
      name,
      label: TOOL_LABELS[name] ?? name,
      mode: appState.approvalConfig[name] ?? "require",
    }));
  }

  // ─── 操作 ──────────────────────────────────

  function updateMode(name: string, mode: string) {
    const tool = tools.find((t) => t.name === name);
    if (tool) {
      tool.mode = mode;
      changed = true;
    }
  }

  async function saveConfig() {
    const config: Record<string, string> = {};
    for (const tool of tools) {
      config[tool.name] = tool.mode;
    }
    appState.approvalConfig = config;
    changed = false;

    try {
      await api.request("setApprovalConfig", { config });
      notify.success("审批配置已保存");
    } catch {
      notify.error("保存失败");
    }
  }

  function setAll(mode: string) {
    for (const tool of tools) {
      tool.mode = mode;
    }
    changed = true;
  }

  function getModeLabel(mode: string): string {
    switch (mode) {
      case "none": return "无需审批";
      case "require": return "需要审批";
      default: return mode;
    }
  }

  function getModeColor(mode: string): string {
    switch (mode) {
      case "none": return "var(--vscode-charts-green, #3fb950)";
      case "require": return "var(--vscode-charts-orange, #d29922)";
      default: return "var(--vscode-descriptionForeground)";
    }
  }
</script>

<div class="approval-page">
  <div class="page-header">
    <h3>🔐 工具审批设置</h3>
    <p class="page-hint">设置各工具是否需要用户审批后才执行。未设置的工具默认<span class="badge-require">需要审批</span>。</p>
  </div>

  {#if loading}
    <div class="loading-indicator">
      <div class="spinner"></div>
      <span>加载中…</span>
    </div>
  {:else}
    <div class="batch-actions">
      <button class="btn-batch" onclick={() => setAll("require")}>🔒 全部需要审批</button>
      <button class="btn-batch" onclick={() => setAll("none")}>🔓 全部无需审批</button>
    </div>

    <div class="tool-list">
      {#each tools as tool (tool.name)}
        <div class="tool-row">
          <div class="tool-info">
            <span class="tool-name">{tool.name}</span>
            <span class="tool-label">{tool.label}</span>
          </div>
          <div class="tool-control">
            <div class="mode-indicator" style="background: {getModeColor(tool.mode)}"></div>
            <select
              class="mode-select"
              value={tool.mode}
              onchange={(e) => updateMode(tool.name, (e.target as HTMLSelectElement).value)}
            >
              <option value="none">无需审批</option>
              <option value="require">需要审批</option>
            </select>
          </div>
        </div>
      {/each}
    </div>

    {#if changed}
      <div class="save-bar">
        <button class="btn-save" onclick={saveConfig}>💾 保存更改</button>
        <span class="save-hint">有未保存的更改</span>
      </div>
    {/if}
  {/if}
</div>

<style>
  .approval-page {
    flex: 1;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    padding: 8px 12px;
    gap: 8px;
  }

  .page-header {
    flex-shrink: 0;
  }

  .page-header h3 {
    margin: 0;
    font-size: 14px;
    font-weight: 600;
    color: var(--vscode-foreground);
  }

  .page-hint {
    margin: 4px 0 0 0;
    font-size: 11px;
    color: var(--vscode-descriptionForeground);
  }

  .badge-require {
    display: inline-block;
    padding: 1px 6px;
    border-radius: 3px;
    font-size: 10px;
    background: var(--vscode-charts-orange, #d29922);
    color: #fff;
    font-weight: 600;
  }

  .loading-indicator {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    color: var(--vscode-descriptionForeground);
    font-size: 13px;
  }

  .spinner {
    width: 16px;
    height: 16px;
    border: 2px solid var(--vscode-focusBorder);
    border-top-color: transparent;
    border-radius: 50%;
    animation: spin 0.6s linear infinite;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  .batch-actions {
    display: flex;
    gap: 8px;
    flex-shrink: 0;
  }

  .btn-batch {
    flex: 1;
    padding: 6px 12px;
    border: 1px solid var(--vscode-focusBorder);
    background: var(--vscode-button-secondaryBackground, transparent);
    color: var(--vscode-foreground);
    cursor: pointer;
    font-size: 12px;
    border-radius: 3px;
    text-align: center;
  }

  .btn-batch:hover {
    background: var(--vscode-button-secondaryHoverBackground, var(--vscode-list-hoverBackground));
  }

  .tool-list {
    flex: 1;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .tool-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 6px 8px;
    border-radius: 3px;
    transition: background 0.15s;
  }

  .tool-row:hover {
    background: var(--vscode-list-hoverBackground);
  }

  .tool-info {
    display: flex;
    flex-direction: column;
    gap: 1px;
    min-width: 0;
  }

  .tool-name {
    font-family: var(--vscode-editor-font-family, monospace);
    font-size: 12px;
    font-weight: 600;
    color: var(--vscode-foreground);
  }

  .tool-label {
    font-size: 11px;
    color: var(--vscode-descriptionForeground);
  }

  .tool-control {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-shrink: 0;
  }

  .mode-indicator {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    flex-shrink: 0;
  }

  .mode-select {
    padding: 3px 6px;
    border: 1px solid var(--vscode-dropdown-border, #444);
    background: var(--vscode-dropdown-background);
    color: var(--vscode-dropdown-foreground);
    font-size: 11px;
    border-radius: 3px;
    cursor: pointer;
    outline: none;
  }

  .mode-select:focus {
    border-color: var(--vscode-focusBorder);
  }

  .save-bar {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 0;
    flex-shrink: 0;
    border-top: 1px solid var(--vscode-panel-border);
  }

  .btn-save {
    padding: 6px 16px;
    border: none;
    background: var(--vscode-button-background);
    color: var(--vscode-button-foreground);
    cursor: pointer;
    font-size: 12px;
    border-radius: 3px;
  }

  .btn-save:hover {
    background: var(--vscode-button-hoverBackground);
  }

  .save-hint {
    font-size: 11px;
    color: var(--vscode-charts-orange, #d29922);
  }
</style>
