<script lang="ts">
  import { appState } from "../lib/state.svelte";
  import { api } from "../lib/api";

  let detailOpen = $state(false);

  function retry() {
    const sessionId = appState.currentSessionId;
    if (!sessionId || appState.isProcessing) return;

    detailOpen = false;
    appState.lastError = null;
    appState.isLoading = true;
    appState.currentSessionStatus = "pending";
    api.send("continueSession", { sessionId });
  }
</script>

{#if appState.lastError}
  <div class="error-card">
    <div class="error-header">
      <span class="error-icon">⚠</span>
      <span class="error-title">{appState.lastError.title}</span>
      {#if appState.lastError.httpStatus}
        <span class="error-badge">HTTP {appState.lastError.httpStatus}</span>
      {/if}
      {#if appState.lastError.code}
        <span class="error-badge code">{appState.lastError.code}</span>
      {/if}
    </div>

    <div class="error-message">{appState.lastError.message}</div>

    {#if appState.lastError.detail}
      <button class="detail-toggle" onclick={() => (detailOpen = !detailOpen)}>
        {detailOpen ? "▼ 收起详情" : "▶ 查看详情"}
      </button>
      {#if detailOpen}
        <pre class="error-detail">{appState.lastError.detail}</pre>
      {/if}
    {/if}

    {#if appState.lastError.retryable !== false}
      <div class="error-actions">
        <button class="retry-button" onclick={retry} disabled={appState.isProcessing}>
          继续
        </button>
        <span class="retry-hint">不追加用户消息，直接重新请求</span>
      </div>
    {/if}
  </div>
{/if}

<style>
  .error-card {
    margin: 4px 6px 8px;
    padding: 8px 10px;
    border: 1px solid var(--vscode-inputValidation-errorBorder, #e33);
    background: var(--vscode-inputValidation-errorBackground, #5a1d1d);
    border-radius: 6px;
    font-size: 12px;
    display: flex;
    flex-direction: column;
    gap: 6px;
    flex-shrink: 0;
  }

  .error-header {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-wrap: wrap;
  }

  .error-icon {
    color: var(--vscode-errorForeground, #f88);
  }

  .error-title {
    color: var(--vscode-errorForeground, #f88);
    font-weight: 600;
  }

  .error-badge {
    padding: 0 5px;
    border-radius: 8px;
    border: 1px solid currentColor;
    color: var(--vscode-descriptionForeground);
    font-size: 10px;
    line-height: 16px;
  }

  .error-badge.code {
    font-family: var(--vscode-editor-font-family, monospace);
  }

  .error-message {
    color: var(--vscode-foreground);
    line-height: 1.5;
    user-select: text;
  }

  .detail-toggle {
    align-self: flex-start;
    background: transparent;
    border: none;
    padding: 0;
    color: var(--vscode-textLink-foreground, #3794ff);
    cursor: pointer;
    font-size: 11px;
  }

  .error-detail {
    margin: 0;
    padding: 6px;
    max-height: 160px;
    overflow: auto;
    white-space: pre-wrap;
    word-break: break-all;
    font-family: var(--vscode-editor-font-family, monospace);
    font-size: 11px;
    color: var(--vscode-descriptionForeground);
    background: var(--vscode-textCodeBlock-background, rgba(0, 0, 0, 0.2));
    border-radius: 4px;
    user-select: text;
  }

  .error-actions {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .retry-button {
    padding: 2px 12px;
    background: var(--vscode-button-background);
    color: var(--vscode-button-foreground);
    border: none;
    border-radius: 3px;
    cursor: pointer;
    font-size: 12px;
  }

  .retry-button:hover:not(:disabled) {
    background: var(--vscode-button-hoverBackground);
  }

  .retry-button:disabled {
    opacity: 0.5;
    cursor: default;
  }

  .retry-hint {
    color: var(--vscode-descriptionForeground);
    font-size: 11px;
  }
</style>
