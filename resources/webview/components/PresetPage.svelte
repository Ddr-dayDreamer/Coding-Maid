<script lang="ts">
  import { appState } from "../lib/state.svelte";
  import { api } from "../lib/api";
  import { onMount } from "svelte";
  import { notify } from "../lib/notification.svelte";
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

  // ─── 加载 ──────────────────────────────────────────

  onMount(async () => {
    await loadPresets();
  });

  async function loadPresets() {
    loading = true;
    try {
      presets = await api.request<PresetMeta[]>("listPresets");
    } catch (e) {
      notify.error("加载预设列表失败");
    } finally {
      loading = false;
    }
  }

  // ─── 操作 ──────────────────────────────────────────

  function handleSelect(name: string) {
    if (name === appState.activePreset) return;
    api.send("selectPreset", { name });
    appState.activePreset = name;
    notify.success(`已切换到预设「${name}」`);
  }

  async function handleEdit(name: string) {
    try {
      const def = await api.request<PresetDefinition>("getPreset", { name });
      editName = name;
      editDefinition = def;
      mode = "edit";
    } catch (e) {
      notify.error("加载预设失败");
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
      notify.success(`预设「${def.name}」已保存`);
    } catch (e) {
      notify.error("保存预设失败");
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
        notify.error("导出失败");
      }
    }
  }

  async function handleDelete(name: string) {
    try {
      await api.request("deletePreset", { name });
      if (appState.activePreset === name) {
        appState.activePreset = "default";
        notify.success(`已切换到预设「default」`);
      }
      await loadPresets();
      notify.success(`预设「${name}」已删除`);
    } catch (e) {
      notify.error("删除失败");
    }
  }

  async function handleImport() {
    try {
      const result = await api.request<PresetMeta>("importPreset");
      await loadPresets();
      notify.success(`预设「${result.displayName}」已导入`);
    } catch (e) {
      const msg = String(e);
      if (!msg.includes("取消") && !msg.includes("cancelled")) {
        notify.error("导入失败");
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

<style>
  .page {
    flex: 1;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    min-height: 0;
    padding: 16px;
  }
</style>
