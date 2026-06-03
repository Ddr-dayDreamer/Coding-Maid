<script lang="ts">
  import { appState } from "../lib/state.svelte";
  import { api } from "../lib/api";
  import type { SessionMessageData } from "../types";

  let messagesContainer: HTMLDivElement | undefined = $state();
  let expandedIds = $state(new Set<string>());

  // ─── AskUserQuestion 表单状态 ─────────────────────

  type QuestionOption = { label: string; description?: string };
  type FormSelections = Record<string, string | string[]>;

  let formValues = $state<FormSelections>({});
  let otherInputs = $state<Record<string, string>>({});
  let submittedQuestions = $state(new Set<string>());

  function isAskUserQuestion(msg: SessionMessageData): boolean {
    if (msg.role !== "tool") return false;
    try {
      const data = JSON.parse(msg.content ?? "{}") as Record<string, unknown>;
      const meta = data.metadata as Record<string, unknown> | undefined;
      return meta?.kind === "ask_user_question";
    } catch {
      return false;
    }
  }

  function getQuestions(msg: SessionMessageData): { question: string; multiSelect?: boolean; options: QuestionOption[] }[] {
    try {
      const data = JSON.parse(msg.content ?? "{}") as Record<string, unknown>;
      const meta = data.metadata as Record<string, unknown> | undefined;
      return (meta?.questions as { question: string; multiSelect?: boolean; options: QuestionOption[] }[]) ?? [];
    } catch {
      return [];
    }
  }

  function selectOption(msgId: string, multiSelect: boolean | undefined, value: string) {
    if (multiSelect) {
      const current = (formValues[msgId] as string[]) ?? [];
      formValues[msgId] = current.includes(value)
        ? current.filter((v) => v !== value)
        : [...current, value];
    } else {
      formValues[msgId] = value;
    }
    formValues = { ...formValues };
  }

  function submitAnswer(msgId: string, questions: { question: string; multiSelect?: boolean; options: QuestionOption[] }[]) {
    const answers: string[] = [];
    for (const q of questions) {
      const val = formValues[msgId];
      if (q.multiSelect) {
        const selected = (val as string[]) ?? [];
        const other = otherInputs[msgId]?.trim();
        if (other) selected.push(other);
        if (selected.length > 0) answers.push(`${q.question}: ${selected.join(", ")}`);
      } else {
        const selected = typeof val === "string" ? val : "";
        const other = otherInputs[msgId]?.trim();
        if (other) answers.push(`${q.question}: ${other}`);
        else if (selected) answers.push(`${q.question}: ${selected}`);
      }
    }
    submittedQuestions = new Set([...submittedQuestions, msgId]);
    api.send("userPrompt", { prompt: answers.join("\n") });
  }

  // ─── 回退 ──────────────────────────────────────────────

  function rollback(msg: SessionMessageData) {
    if (!appState.currentSessionId) return;
    // 把消息内容暂存，供 ChatPage 填入输入框
    appState.pendingPrompt = msg.content ?? "";
    // 处理中先中断，避免与 LLM 循环竞争
    if (appState.isProcessing) {
      api.send("interrupt");
    }
    api.send("restoreSession", {
      sessionId: appState.currentSessionId,
      messageId: msg.id,
    });
  }

  function getToolName(msg: SessionMessageData): string {
    const fn = msg.meta?.function;
    if (fn && typeof fn === "object" && "name" in fn) {
      return String((fn as Record<string, unknown>).name ?? "tool");
    }
    return "tool";
  }

  function isThinking(msg: SessionMessageData): boolean {
    if (msg.role !== "assistant") return false;
    if (msg.meta?.asThinking) return true;
    const mParams = msg.messageParams as { reasoning_content?: unknown } | null | undefined;
    if (mParams && typeof mParams.reasoning_content === "string") {
      return mParams.reasoning_content.length > 0;
    }
    return false;
  }

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
    if (appState.messages.length > 0 || appState.streamingContent) {
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
      <div class="user-row">
        <button class="rollback-btn" title="回退到此" onclick={() => rollback(msg)}>↩</button>
        <div class="bubble bubble-user">
          <div class="bubble-body">
            {#if msg.html}
              <div class="bubble-content html">{@html msg.html}</div>
            {:else}
              <div class="bubble-content">{msg.content}</div>
            {/if}
          </div>
        </div>
      </div>
    {:else}
      <div class="bubble bubble-{msg.role}">
        <div class="bubble-avatar"></div>
        <div class="bubble-body">
          {#if msg.role === "tool"}
            {#if isAskUserQuestion(msg) && !submittedQuestions.has(msg.id)}
              <div class="question-form">
                <div class="question-hint">💬 等待回答</div>
                {#each getQuestions(msg) as q}
                  <div class="question-item">
                    <div class="question-text">{q.question}</div>
                    <div class="question-options">
                      {#each q.options as opt}
                        <button
                          class="question-option"
                          class:selected={q.multiSelect
                            ? (formValues[msg.id] as string[] ?? []).includes(opt.label)
                            : formValues[msg.id] === opt.label}
                          onclick={() => selectOption(msg.id, q.multiSelect, opt.label)}
                        >
                          <span class="option-label">{opt.label}</span>
                          {#if opt.description}
                            <span class="option-desc">{opt.description}</span>
                          {/if}
                        </button>
                      {/each}
                    </div>
                  </div>
                {/each}
                <div class="question-other">
                  <input
                    type="text"
                    placeholder="其他..."
                    bind:value={otherInputs[msg.id]}
                  />
                </div>
                <button
                  class="question-submit"
                  onclick={() => submitAnswer(msg.id, getQuestions(msg))}
                  disabled={!formValues[msg.id] && !otherInputs[msg.id]?.trim()}
                >发送回答</button>
              </div>
            {:else}
              <div class="tool-card">
                <button class="tool-header" onclick={() => toggleExpand(msg.id)}>
                  <span class="collapse-icon">{expandedIds.has(msg.id) ? "▼" : "▶"}</span>
                  <span class="tool-icon">⚙</span>
                  <span class="tool-name">{getToolName(msg)}</span>
                  {#if msg.meta?.paramsMd}
                    <span class="tool-params">{msg.meta.paramsMd}</span>
                  {/if}
                </button>
                {#if expandedIds.has(msg.id)}
                  <div class="tool-result-wrap">
                    {#if msg.meta?.resultMd}
                      <pre class="tool-result">{msg.meta.resultMd}</pre>
                    {:else if msg.content}
                      <pre class="tool-result">{msg.content}</pre>
                    {/if}
                  </div>
                {/if}
              </div>
            {/if}
          {:else if isThinking(msg)}
            <div class="thinking-block">
              <button class="thinking-header" onclick={() => toggleExpand(msg.id)}>
                <span class="collapse-icon">{expandedIds.has(msg.id) ? "▼" : "▶"}</span>
                <span class="thinking-label">思考中...</span>
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
          {:else if msg.html}
            <div class="bubble-content html">{@html msg.html}</div>
          {:else}
            <div class="bubble-content">{msg.content}</div>
          {/if}
        </div>
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
  {#if appState.streamingContent}
    <div class="bubble bubble-assistant">
      <div class="bubble-avatar"></div>
      <div class="bubble-body">
        <div class="bubble-content">{appState.streamingContent}<span class="cursor">▊</span></div>
      </div>
    </div>
  {/if}

  <!-- 加载指示器 -->
  {#if appState.isLoading && !appState.streamingContent}
    <div class="loading-indicator">
      <div class="spinner"></div>
      <span>思考中...</span>
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

  /* ─── 气泡 ─────────────────────────────────────── */
  .bubble {
    display: flex;
    gap: 2px;
    max-width: 96%;
    animation: fadeIn 0.15s ease;
  }

  @keyframes fadeIn {
    from { opacity: 0; transform: translateY(4px); }
    to { opacity: 1; transform: translateY(0); }
  }

  .bubble-user {
    align-self: auto;
    min-width: 0;
    flex: 1;
  }

  .user-row {
    display: flex;
    align-self: flex-end;
    width: 100%;
    gap: 6px;
    flex: 1;
  }

  .user-row .rollback-btn {
    width: 24px;
    flex-shrink: 0;
  }

  .bubble-assistant {
    align-self: flex-start;
  }

  .bubble-system {
    align-self: center;
    max-width: 100%;
    font-size: 12px;
    color: var(--vscode-descriptionForeground);
  }

  .bubble-tool {
    align-self: flex-start;
  }

  /* ─── 圆点连接线 ──────────────────────────── */
  .bubble-assistant,
  .bubble-tool {
    position: relative;
  }

  .bubble-assistant .bubble-avatar,
  .bubble-tool .bubble-avatar {
    position: relative;
    z-index: 1;
  }

  .bubble-assistant::before,
  .bubble-tool::before {
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
  }

  .bubble-user .bubble-avatar {
    display: none;
  }

  .rollback-btn {
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

  .bubble-assistant .bubble-avatar {
    background: var(--vscode-charts-pink, #e05c8b);
  }

  .bubble-system .bubble-avatar {
    display: none;
  }

  .bubble-tool .bubble-avatar {
    display: block;
    background: var(--vscode-charts-green, #3fb950);
  }

  .bubble-body {
    padding: 2px 6px;
    font-size: 13px;
    line-height: 1.6;
    min-width: 0;
    word-break: break-word;
  }

  .bubble-user .bubble-body {
    background: color-mix(in srgb, var(--vscode-editor-background) 88%, var(--vscode-foreground) 12%);
    border-radius: 6px;
    padding: 6px 10px;
    color: var(--vscode-foreground);
  }

  .bubble-assistant .bubble-body {
    color: var(--vscode-foreground);
    border-bottom: 1px solid var(--vscode-focusBorder);
  }

  .bubble-system .bubble-body {
    padding: 1px 6px;
    text-align: center;
    font-size: 12px;
    color: var(--vscode-descriptionForeground);
    border-bottom: 1px solid var(--vscode-focusBorder);
  }

  .bubble-tool .bubble-body {
    padding: 2px 6px;
    font-size: 13px;
    color: var(--vscode-foreground);
    border-bottom: 1px solid var(--vscode-focusBorder);
  }

  /* ─── 提问表单 ──────────────────────────── */
  .question-form {
    font-size: 12px;
    line-height: 1.5;
  }

  .question-hint {
    font-size: 11px;
    color: var(--vscode-descriptionForeground);
    margin-bottom: 6px;
    opacity: 0.7;
  }

  .question-item {
    margin-bottom: 10px;
  }

  .question-text {
    font-weight: 500;
    margin-bottom: 6px;
    color: var(--vscode-foreground);
  }

  .question-options {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .question-option {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 1px;
    width: 100%;
    padding: 6px 10px;
    border: 1px solid var(--vscode-panel-border);
    border-radius: 6px;
    background: transparent;
    color: var(--vscode-foreground);
    cursor: pointer;
    text-align: left;
    font-family: inherit;
    font-size: 12px;
    transition: border-color 0.12s, background 0.12s;
  }

  .question-option:hover {
    border-color: var(--vscode-focusBorder);
    background: var(--vscode-list-hoverBackground);
  }

  .question-option.selected {
    border-color: var(--vscode-focusBorder);
    background: color-mix(in srgb, var(--vscode-focusBorder) 15%, transparent 85%);
  }

  .option-label {
    font-weight: 500;
  }

  .option-desc {
    font-size: 11px;
    color: var(--vscode-descriptionForeground);
    opacity: 0.75;
  }

  .question-other {
    margin-bottom: 8px;
  }

  .question-other input {
    width: 100%;
    padding: 6px 8px;
    border: 1px solid var(--vscode-panel-border);
    border-radius: 4px;
    background: var(--vscode-input-background);
    color: var(--vscode-input-foreground);
    font-family: inherit;
    font-size: 12px;
    outline: none;
    box-sizing: border-box;
  }

  .question-other input:focus {
    border-color: var(--vscode-focusBorder);
  }

  .question-submit {
    padding: 6px 16px;
    border: none;
    border-radius: 4px;
    background: var(--vscode-button-background);
    color: var(--vscode-button-foreground);
    cursor: pointer;
    font-family: inherit;
    font-size: 12px;
    font-weight: 500;
  }

  .question-submit:hover:not(:disabled) {
    background: var(--vscode-button-hoverBackground);
  }

  .question-submit:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  /* ─── 工具调用卡片 ────────────────────────── */
  .tool-card {
    font-size: 12px;
    line-height: 1.5;
  }

  .tool-header,
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

  .tool-icon,
  .thinking-icon {
    flex-shrink: 0;
    font-size: 12px;
  }

  .tool-name {
    font-weight: 600;
    font-family: var(--vscode-editor-font-family, monospace);
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.3px;
    flex-shrink: 0;
  }

  .tool-params {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    opacity: 0.75;
  }

  .thinking-label {
    font-weight: 500;
    opacity: 0.7;
  }

  .tool-result {
    margin: 0;
    padding: 6px 8px;
    font-size: 11px;
    line-height: 1.4;
    border-radius: 4px;
    background: var(--vscode-textPreformat-background, var(--vscode-editor-background));
    overflow-x: auto;
    white-space: pre-wrap;
    word-break: break-all;
  }

  .tool-result-wrap {
    margin-top: 4px;
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
