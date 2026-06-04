<script lang="ts">
  import type { SessionMessageData } from "../types";

  let {
    msg,
    expandedIds,
    onToggleExpand,
  }: {
    msg: SessionMessageData;
    expandedIds: Set<string>;
    onToggleExpand: (id: string) => void;
  } = $props();

  /**
   * 获取消息的思维链内容（messageParams 中的 reasoning_content）
   */
  function getReasoning(): string | null {
    const mParams = msg.messageParams as { reasoning_content?: unknown } | null | undefined;
    if (mParams && typeof mParams.reasoning_content === "string" && mParams.reasoning_content.length > 0) {
      return mParams.reasoning_content;
    }
    return null;
  }

  /**
   * 判断是否纯思维链消息（应折叠展示）：
   * - meta.asThinking = true：显式标记（如 tool call 前的思考）
   * - 有 reasoning_content 但无实际 content：纯 thinking 消息
   * 如果既有 reasoning_content 又有 content，以 content 为主，不折叠。
   */
  function isThinkingOnly(): boolean {
    if (msg.meta?.asThinking) return true;
    return !!getReasoning() && !msg.content;
  }

  /**
   * 取思维链的第一行作为折叠标题
   */
  function reasoningLabel(): string {
    const text = getReasoning();
    if (!text) return "思考过程";
    const firstLine = text.split("\n").find((l) => l.trim().length > 0);
    return firstLine?.trim().slice(0, 80) ?? "思考过程";
  }

  function toggle() {
    onToggleExpand(msg.id);
  }
</script>

<div class="bubble-assistant">
  <div class="bubble-avatar"></div>
  <div class="bubble-body">
    {#if isThinkingOnly()}
      <!-- 纯思维链 → 折叠展示 -->
      <div class="thinking-block">
        <button class="thinking-header" onclick={toggle}>
          <span class="collapse-icon">{expandedIds.has(msg.id) ? "▼" : "▶"}</span>
          <span class="thinking-label">{reasoningLabel()}</span>
        </button>
        {#if expandedIds.has(msg.id)}
          <div class="thinking-content">
            {#if msg.html}
              <div class="bubble-content html">{@html msg.html}</div>
            {:else}
              <div class="bubble-content">{msg.content}</div>
            {/if}
          </div>
        {/if}
      </div>
    {:else}
      <!-- 如果同时有思维链内容，在回答上方显示查看入口 -->
      {#if getReasoning()}
        <div class="reasoning-toggle">
          <button class="thinking-header" onclick={toggle}>
            <span class="collapse-icon">{expandedIds.has(msg.id) ? "▼" : "▶"}</span>
            <span class="thinking-label">{reasoningLabel()}</span>
          </button>
          {#if expandedIds.has(msg.id)}
            <div class="thinking-content">
              <div class="bubble-content">{getReasoning()}</div>
            </div>
          {/if}
        </div>
      {/if}
      <!-- 正常回答 -->
      {#if msg.html}
        <div class="bubble-content html">{@html msg.html}</div>
      {:else}
        <div class="bubble-content">{msg.content}</div>
      {/if}
    {/if}
  </div>
</div>

<style>
  .bubble-assistant {
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

  .bubble-assistant::before {
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

  .bubble-avatar {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    flex-shrink: 0;
    margin-top: 7px;
    background: var(--vscode-charts-pink, #e05c8b);
    position: relative;
    z-index: 1;
  }

  .bubble-body {
    padding: 2px 6px;
    font-size: 13px;
    line-height: 1.6;
    min-width: 0;
    word-break: break-word;
    color: var(--vscode-foreground);
    border-bottom: 1px solid var(--vscode-focusBorder);
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

  /* ─── 思维链折叠 ──────────────────────── */

  .thinking-header {
    display: flex;
    align-items: center;
    gap: 5px;
    width: 100%;
    padding: 0;
    border: none;
    background: none;
    color: var(--vscode-descriptionForeground);
    font-size: 11px;
    cursor: pointer;
    text-align: left;
    font-family: inherit;
    white-space: nowrap;
  }

  .collapse-icon {
    flex-shrink: 0;
    font-size: 8px;
    width: 12px;
    text-align: center;
  }

  .thinking-label {
    font-weight: 500;
    opacity: 0.7;
    font-size: 11px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .thinking-content {
    margin-top: 4px;
    padding: 6px 8px;
    font-size: 11px;
    line-height: 1.4;
    border-radius: 4px;
    background: var(--vscode-textPreformat-background, var(--vscode-editor-background));
    color: var(--vscode-descriptionForeground);
  }

  /* ─── 回答上方查看思维链入口 ────────────── */

  .reasoning-toggle {
    margin-bottom: 6px;
    padding-bottom: 4px;
    border-bottom: 1px solid var(--vscode-panel-border);
  }
</style>
