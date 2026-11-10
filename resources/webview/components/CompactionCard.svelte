<script lang="ts">
  import { appState } from "../lib/state.svelte";
  import { api } from "../lib/api";
  import type { SessionMessageData } from "../types";

  let { msg }: { msg: SessionMessageData } = $props();

  let expanded = $state(false);

  const stats = $derived(msg.meta?.compaction ?? null);

  function fmt(n: number): string {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
    return String(n);
  }

  function undo() {
    const sessionId = appState.currentSessionId;
    if (!sessionId) return;
    api.send("undoCompaction", { sessionId });
  }
</script>

<div class="compaction-card">
  <div class="card-header">
    <button class="toggle" onclick={() => (expanded = !expanded)} title={expanded ? "收起摘要" : "展开摘要"}>
      <span class="icon">{expanded ? "▼" : "▶"}</span>
      <span class="title">上下文已压缩</span>
    </button>
    {#if stats}
      <span class="stats">{fmt(stats.tokensBefore)} → {fmt(stats.tokensAfter)} tokens</span>
    {/if}
    <button class="undo" onclick={undo} title="撤销压缩，恢复完整上下文">撤销</button>
  </div>

  {#if expanded}
    <div class="card-body">
      {#if msg.html}
        <div class="summary-html">{@html msg.html}</div>
      {:else}
        <div class="summary-text">{msg.content}</div>
      {/if}
    </div>
  {/if}
</div>

<style>
  .compaction-card {
    align-self: stretch;
    margin: 6px 0;
    border: 1px dashed var(--vscode-panel-border);
    border-radius: 6px;
    background: var(--vscode-textBlockQuote-background, transparent);
    font-size: 12px;
  }

  .card-header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 5px 8px;
  }

  .toggle {
    display: flex;
    align-items: center;
    gap: 5px;
    border: none;
    background: transparent;
    color: var(--vscode-foreground);
    cursor: pointer;
    padding: 0;
    font-size: 12px;
  }

  .toggle .icon {
    font-size: 9px;
    opacity: 0.7;
  }

  .title {
    font-weight: 600;
  }

  .stats {
    color: var(--vscode-descriptionForeground);
    font-size: 11px;
  }

  .undo {
    margin-left: auto;
    border: 1px solid var(--vscode-panel-border);
    background: transparent;
    color: var(--vscode-descriptionForeground);
    border-radius: 4px;
    padding: 1px 8px;
    font-size: 11px;
    cursor: pointer;
  }

  .undo:hover {
    color: var(--vscode-foreground);
    border-color: var(--vscode-focusBorder);
  }

  .card-body {
    padding: 0 10px 8px;
    border-top: 1px solid var(--vscode-panel-border);
    max-height: 320px;
    overflow-y: auto;
  }

  .summary-html,
  .summary-text {
    font-size: 12px;
    line-height: 1.6;
    color: var(--vscode-descriptionForeground);
    white-space: pre-wrap;
  }

  .summary-html :global(h2) {
    font-size: 12px;
    margin: 8px 0 4px;
    color: var(--vscode-foreground);
  }
</style>
