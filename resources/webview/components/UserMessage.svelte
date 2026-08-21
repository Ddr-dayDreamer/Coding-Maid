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

  type UserContentPart = { type: "text"; text: string } | { type: "image_url"; image_url: { url: string } };

  /** 解析消息 contentParams（text / image_url parts），供附加内容展示 */
  function parseContentParams(params: unknown): UserContentPart[] {
    if (!Array.isArray(params)) return [];
    const result: UserContentPart[] = [];
    for (const raw of params) {
      if (!raw || typeof raw !== "object") continue;
      const part = raw as Record<string, unknown>;
      if (part.type === "text" && typeof part.text === "string") {
        result.push({ type: "text", text: part.text });
      } else if (part.type === "image_url") {
        const img = part.image_url;
        if (img && typeof img === "object" && typeof (img as { url?: unknown }).url === "string") {
          result.push({ type: "image_url", image_url: { url: (img as { url: string }).url } });
        }
      }
    }
    return result;
  }

  let parts = $derived(parseContentParams(msg.contentParams));
</script>

<div class="user-row">
  <button class="rollback-btn" title="回退到此" onclick={rollback}>↩</button>
  <div class="bubble-user">
    <div class="bubble-body">
      <div class="bubble-content">{msg.content?.trim()}</div>
      {#if parts.length > 0}
        <div class="attachments">
          {#each parts as part, i}
            {#if part.type === "image_url"}
              <img class="attach-img" src={part.image_url.url} alt={`附加图片 ${i + 1}`} />
            {:else}
              <details class="attach-text">
                <summary>📎 附加文件</summary>
                <pre>{part.text}</pre>
              </details>
            {/if}
          {/each}
        </div>
      {/if}
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
    transition:
      opacity 0.15s,
      background 0.15s;
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

  .attachments {
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin-top: 6px;
  }

  .attach-img {
    display: block;
    max-width: 100%;
    max-height: 240px;
    border-radius: 6px;
    border: 1px solid color-mix(in srgb, var(--vscode-foreground) 20%, transparent);
    object-fit: contain;
    background: var(--vscode-editor-background);
  }

  .attach-text {
    font-size: 12px;
  }

  .attach-text summary {
    cursor: pointer;
    user-select: none;
    opacity: 0.85;
  }

  .attach-text summary:hover {
    opacity: 1;
  }

  .attach-text pre {
    margin: 6px 0 0;
    padding: 8px;
    overflow-x: auto;
    font-size: 12px;
    border-radius: 4px;
    background: var(--vscode-textPreformat-background, var(--vscode-editor-background));
    white-space: pre-wrap;
    word-break: break-word;
  }
</style>
