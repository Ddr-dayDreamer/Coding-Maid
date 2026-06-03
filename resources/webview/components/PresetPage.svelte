<script lang="ts">
  import { appState } from "../lib/state.svelte";
  import { api } from "../lib/api";
  import { onMount } from "svelte";
  import PresetList from "./PresetList.svelte";
  import PresetEditor from "./PresetEditor.svelte";
  import type { PresetMeta, PresetDefinition } from "../types";

  // ─── 状态 ──────────────────────────────────────────

  type PageMode = "list" | "edit" | "new";

  let presets = $state<PresetMeta[]>([]);
  let loading = $state(true);
  let mode = $state<PageMode>("list");
  let editName = $state("");
  let editDefinition = $state<PresetDefinition | null>(null);
  let notification = $state<{ type: "error" | "success"; text: string } | null>(null);
  let notifTimer: ReturnType<typeof setTimeout> | null = null;

  // ─── 通知 ──────────────────────────────────────────

  function showNotif(type: "error" | "success", text: string) {
    notification = { type, text };
    if (notifTimer) clearTimeout(notifTimer);
    notifTimer = setTimeout(() => { notification = null; }, 4000);
  }

  // ─── 加载 ──────────────────────────────────────────

  onMount(async () => {
    await loadPresets();
  });

  async function loadPresets() {
    loading = true;
    try {
      presets = await api.request<PresetMeta[]>("listPresets");
    } catch (e) {
      showNotif("error", "加载预设列表失败");
    } finally {
      loading = false;
    }
  }

  // ─── 操作 ──────────────────────────────────────────

  function handleSelect(name: string) {
    if (name === appState.activePreset) return;
    api.send("selectPreset", { name });
    appState.activePreset = name;
    showNotif("success", `已切换到预设「${name}」`);
  }

  async function handleEdit(name: string) {
    try {
      const def = await api.request<PresetDefinition>("getPreset", { name });
      editName = name;
      editDefinition = def;
      mode = "edit";
    } catch (e) {
      showNotif("error", "加载预设失败");
    }
  }

  function handleNew() {
    editName = "";
    editDefinition = {
      name: "新预设",
      description: "",
      char: "",
      user: "",
      availableTools: ["bash", "read", "write", "edit", "AskUserQuestion", "UpdatePlan", "WebSearch"],
      entries: [],
    };
    mode = "new";
  }

  async function handleSave(name: string, def: PresetDefinition) {
    try {
      // 如果标识名为空，用显示名 sanitize 后作为标识名
      const saveName = name.trim() || def.name.trim().replace(/[^a-zA-Z0-9_\-\u4e00-\u9fff]/g, "_") || "untitled";
      await api.request("savePreset", { name: saveName, definition: def });
      await loadPresets();
      mode = "list";
      showNotif("success", `预设「${def.name}」已保存`);
    } catch (e) {
      showNotif("error", "保存预设失败");
    }
  }

  function handleCancel() {
    mode = "list";
  }

  async function handleExport(name: string) {
    try {
      await api.request("exportPreset", { name });
    } catch (e) {
      // 用户取消对话框不算错误
      const msg = String(e);
      if (!msg.includes("取消") && !msg.includes("cancelled")) {
        showNotif("error", "导出失败");
      }
    }
  }

  async function handleDelete(name: string) {
    try {
      await api.request("deletePreset", { name });
      if (appState.activePreset === name) {
        appState.activePreset = "default";
        showNotif("success", `已切换到预设「default」`);
      }
      await loadPresets();
      showNotif("success", `预设「${name}」已删除`);
    } catch (e) {
      showNotif("error", "删除失败");
    }
  }

  async function handleImport() {
    try {
      const result = await api.request<PresetMeta>("importPreset");
      await loadPresets();
      showNotif("success", `预设「${result.displayName}」已导入`);
    } catch (e) {
      const msg = String(e);
      if (!msg.includes("取消") && !msg.includes("cancelled")) {
        showNotif("error", "导入失败");
      }
    }
  }
</script>

<div class="page">
  {#if mode === "list"}
    <PresetList
      {presets}
      activePreset={appState.activePreset}
      {loading}
      onselect={handleSelect}
      onedit={handleEdit}
      onexport={handleExport}
      ondelete={handleDelete}
      onnew={handleNew}
      onimport={handleImport}
    />
  {:else if editDefinition}
    <PresetEditor
      definition={editDefinition}
      presetName={editName}
      onsave={handleSave}
      oncancel={handleCancel}
    />
  {/if}
</div>

{#if notification}
  <div class="notification" class:error={notification.type === "error"} class:success={notification.type === "success"}>
    {#if notification.type === "error"}
      <svg viewBox="0 0 16 16" width="14" height="14"><path fill="currentColor" d="M4.47 3.47a.75.75 0 0 1 1.06 0L8 5.94l2.47-2.47a.75.75 0 1 1 1.06 1.06L9.06 7l2.47 2.47a.75.75 0 1 1-1.06 1.06L8 8.06l-2.47 2.47a.75.75 0 0 1-1.06-1.06L6.94 7 4.47 4.53a.75.75 0 0 1 0-1.06Z"/></svg>
    {:else}
      <svg viewBox="0 0 16 16" width="14" height="14"><path fill="currentColor" d="M13.78 4.22a.75.75 0 0 1 0 1.06l-7.25 7.25a.75.75 0 0 1-1.06 0L2.22 9.28a.75.75 0 0 1 1.06-1.06L6 10.94l6.72-6.72a.75.75 0 0 1 1.06 0Z"/></svg>
    {/if}
    {notification.text}
  </div>
{/if}

<style>
  .page {
    flex: 1;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    min-height: 0;
    padding: 16px;
  }

  .notification {
    position: fixed;
    bottom: 12px;
    left: 50%;
    transform: translateX(-50%);
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 14px;
    border-radius: 6px;
    font-size: 12px;
    z-index: 100;
    box-shadow: 0 2px 8px rgba(0,0,0,0.25);
    pointer-events: none;
    animation: notif-in 0.2s ease;
  }

  .notification.error {
    background: var(--vscode-inputValidation-errorBackground, #5a1d1d);
    border: 1px solid var(--vscode-inputValidation-errorBorder, #e33);
    color: var(--vscode-errorForeground, #f88);
  }

  .notification.success {
    background: var(--vscode-inputValidation-infoBackground, #1d3a5a);
    border: 1px solid var(--vscode-inputValidation-infoBorder, #3b8);
    color: var(--vscode-foreground);
  }

  @keyframes notif-in {
    from { opacity: 0; transform: translateX(-50%) translateY(8px); }
    to { opacity: 1; transform: translateX(-50%) translateY(0); }
  }
</style>
