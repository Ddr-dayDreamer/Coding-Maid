<script lang="ts">
  import type { SessionMessageData } from "../types";
  import { appState } from "../lib/state.svelte";
  import { api } from "../lib/api";

  let { msg }: { msg: SessionMessageData } = $props();

  function rollback() {
    if (!appState.currentSessionId) return;
    appState.pendingPrompt = msg.content ?? "";
    appState.pendingRollback = true;
    api.send("restoreSession", {
      sessionId: appState.currentSessionId,
      messageId: msg.id,
    });
  }
</script>

<div class="user-row">
  <button class="rollback-btn" title="回退到此" onclick={rollback}>↩</button>
  <div class="bubble-user">
    <div class="bubble-body">
      <div class="bubble-content">{msg.content?.trim()}</div>
    </div>
  </div>
</div>

<style>
  .user-row {
    display: flex;
    align-self: flex-end;
    width: 100%;
    gap: 6px;
  }

  .rollback-btn {
    width: 24px;
    flex-shrink: 0;
    padding: 0 4px;
    border: none;
    background: transparent;
    cursor: pointer;
    color: var(--vscode-descriptionForeground);
    font-size: 13px;
    opacity: 0.3;
    transition: opacity 0.15s, background 0.15s;
    border-radius: 4px;
    display: grid;
    place-items: center;
    align-self: stretch;
  }

  .user-row:hover .rollback-btn {
    opacity: 1;
  }

  .user-row .rollback-btn:hover {
    opacity: 1;
    background: var(--vscode-list-hoverBackground);
  }

  .bubble-user {
    min-width: 0;
    flex: 1;
  }

  .bubble-body {
    padding: 6px 10px;
    font-size: 13px;
    line-height: 1.6;
    min-width: 0;
    word-break: break-word;
    background: color-mix(in srgb, var(--vscode-editor-background) 88%, var(--vscode-foreground) 12%);
    border-radius: 6px;
    color: var(--vscode-foreground);
  }

  .bubble-content {
    white-space: pre-wrap;
  }

  .bubble-content :global(pre) {
    overflow-x: auto;
    font-size: 12px;
    padding: 8px;
    border-radius: 4px;
    background: var(--vscode-textPreformat-background, var(--vscode-editor-background));
  }

  .bubble-content :global(code) {
    font-size: 12px;
  }

  .bubble-content :global(p) {
    margin: 4px 0;
  }

  .bubble-content :global(p:first-child) {
    margin-top: 0;
  }

  .bubble-content :global(p:last-child) {
    margin-bottom: 0;
  }
</style>
