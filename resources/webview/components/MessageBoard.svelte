<script lang="ts">
  import { appState } from "../lib/state.svelte";
  import UserMessage from "./UserMessage.svelte";
  import AssistantMessage from "./AssistantMessage.svelte";
  import ToolMessage from "./ToolMessage.svelte";

  let messagesContainer: HTMLDivElement | undefined = $state();
  let expandedIds = $state(new Set<string>());

  function toggleExpand(id: string) {
    if (expandedIds.has(id)) {
      expandedIds.delete(id);
    } else {
      expandedIds.add(id);
    }
    expandedIds = new Set(expandedIds);
  }

  // ─── 自动滚动 ──────────────────────────────────────────

  $effect(() => {
    if (appState.messages.length > 0 || appState.isStreaming) {
      requestAnimationFrame(() => {
        if (messagesContainer) {
          messagesContainer.scrollTop = messagesContainer.scrollHeight;
        }
      });
    }
  });
</script>

<div class="messages" bind:this={messagesContainer}>
  {#each appState.messages as msg}
    {#if msg.role === "user"}
      <UserMessage {msg} />
    {:else if msg.role === "tool"}
      <ToolMessage {msg} {expandedIds} onToggleExpand={toggleExpand} />
    {:else if msg.role === "assistant"}
      <AssistantMessage {msg} {expandedIds} onToggleExpand={toggleExpand} />
    {:else}
      <div class="bubble-system">
        <div class="bubble-body">{msg.content}</div>
      </div>
    {/if}
  {:else}
    {#if !appState.isLoading && !appState.streamingContent}
      <div class="empty-state">
        <div class="empty-icon">💬</div>
        <p>开始新的对话</p>
        <p class="empty-hint">输入消息并按 Enter 发送</p>
      </div>
    {/if}
  {/each}

  <!-- 流式输出气泡 -->
  {#if appState.streamingReasoning || appState.streamingContent}
    <div class="bubble-streaming">
      <div class="bubble-avatar"></div>
      <div class="bubble-body">
        {#if appState.streamingReasoning}
          <div class="streaming-thinking">
            <span class="thinking-label">{appState.streamingReasoning.split("\n").find(l => l.trim().length > 0)?.trim().slice(0, 80) ?? "思考中…"}</span>
            <div class="streaming-reasoning">{appState.streamingReasoning}</div>
          </div>
        {/if}
        {#if appState.streamingContent}
          <div class="streaming-answer">
            <div class="bubble-content">{appState.streamingContent}<span class="cursor">▊</span></div>
          </div>
        {/if}
      </div>
    </div>
  {/if}

  <!-- 加载指示器 -->
  {#if appState.isLoading && !appState.isStreaming}
    <div class="loading-indicator">
      <div class="spinner"></div>
      <span>等待响应…</span>
    </div>
  {/if}
</div>

<style>
  /* ─── 消息列表 ─────────────────────────────────── */
  .messages {
    flex: 1 1 0;
    overflow-y: auto;
    padding: 4px 6px 4px 6px;
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-height: 0;
    height: 0;
  }

  .empty-state {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    color: var(--vscode-descriptionForeground);
    gap: 6px;
  }

  .empty-icon {
    font-size: 36px;
    opacity: 0.4;
  }

  .empty-state p {
    margin: 0;
    font-size: 14px;
  }

  .empty-hint {
    font-size: 12px !important;
    opacity: 0.5;
  }

  /* ─── system 消息 ──────────────────────────── */
  .bubble-system {
    align-self: center;
    max-width: 100%;
    font-size: 12px;
    color: var(--vscode-descriptionForeground);
  }

  .bubble-system .bubble-body {
    padding: 1px 6px;
    text-align: center;
    font-size: 12px;
    color: var(--vscode-descriptionForeground);
    border-bottom: 1px solid var(--vscode-focusBorder);
  }

  /* ─── 流式输出 ──────────────────────────────── */
  .bubble-streaming {
    display: flex;
    gap: 2px;
    max-width: 96%;
    animation: fadeIn 0.15s ease;
    align-self: flex-start;
    position: relative;
  }

  @keyframes fadeIn {
    from { opacity: 0; transform: translateY(4px); }
    to { opacity: 1; transform: translateY(0); }
  }

  .bubble-streaming::before {
    content: '';
    position: absolute;
    left: 2px;
    top: -4px;
    width: 2px;
    height: calc(100% + 8px);
    background: var(--vscode-focusBorder);
    opacity: 0.35;
    pointer-events: none;
  }

  .bubble-streaming .bubble-avatar {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    flex-shrink: 0;
    margin-top: 7px;
    background: var(--vscode-charts-pink, #e05c8b);
    position: relative;
    z-index: 1;
  }

  .bubble-streaming .bubble-body {
    padding: 2px 6px;
    font-size: 13px;
    line-height: 1.6;
    min-width: 0;
    word-break: break-word;
    color: var(--vscode-foreground);
    border-bottom: 1px solid var(--vscode-focusBorder);
  }

  .bubble-streaming .bubble-content {
    white-space: pre-wrap;
  }

  /* ─── 流式思维链 ──────────────────────────── */
  .streaming-thinking {
    margin-bottom: 6px;
  }

  .streaming-thinking .thinking-label {
    font-size: 11px;
    font-weight: 500;
    color: var(--vscode-descriptionForeground);
    opacity: 0.7;
    display: block;
    margin-bottom: 4px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .streaming-reasoning {
    font-size: 11px;
    line-height: 1.5;
    color: var(--vscode-descriptionForeground);
    white-space: pre-wrap;
    padding: 4px 8px;
    border-radius: 4px;
    background: var(--vscode-textPreformat-background, var(--vscode-editor-background));
    max-height: 200px;
    overflow-y: auto;
  }

  .streaming-answer {
    margin-top: 2px;
  }

  /* 流式输出光标 */
  .cursor {
    animation: blink 1s step-end infinite;
    opacity: 0.7;
  }

  @keyframes blink {
    50% { opacity: 0; }
  }

  /* ─── 加载指示器 ──────────────────────────────── */
  .loading-indicator {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 0;
    color: var(--vscode-descriptionForeground);
    font-size: 12px;
    margin-left: 38px;
  }

  .spinner {
    width: 14px;
    height: 14px;
    border-radius: 50%;
    border: 2px solid var(--vscode-progressBar-background);
    border-top-color: var(--vscode-focusBorder);
    animation: spin 0.8s linear infinite;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }
</style>
