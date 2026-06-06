<script lang="ts">
  import type { SessionMessageData } from "../types";
  import { api } from "../lib/api";
  import PlanDisplay from "./PlanDisplay.svelte";

  let {
    msg,
    expandedIds,
    onToggleExpand,
  }: {
    msg: SessionMessageData;
    expandedIds: Set<string>;
    onToggleExpand: (id: string) => void;
  } = $props();

  // ─── AskUserQuestion 表单状态 ──────────────

  type QuestionOption = { label: string; description?: string };
  type FormSelections = Record<string, string | string[]>;

  let formValues = $state<FormSelections>({});
  let otherInputs = $state<Record<string, string>>({});
  let submittedQuestions = $state(new Set<string>());

  function isAskUserQuestion(): boolean {
    try {
      const data = JSON.parse(msg.content ?? "{}") as Record<string, unknown>;
      const meta = data.metadata as Record<string, unknown> | undefined;
      return meta?.kind === "ask_user_question";
    } catch {
      return false;
    }
  }

  function getQuestions(): { question: string; multiSelect?: boolean; options: QuestionOption[] }[] {
    try {
      const data = JSON.parse(msg.content ?? "{}") as Record<string, unknown>;
      const meta = data.metadata as Record<string, unknown> | undefined;
      return (meta?.questions as { question: string; multiSelect?: boolean; options: QuestionOption[] }[]) ?? [];
    } catch {
      return [];
    }
  }

  function selectOption(multiSelect: boolean | undefined, value: string) {
    if (multiSelect) {
      const current = (formValues[msg.id] as string[]) ?? [];
      formValues[msg.id] = current.includes(value)
        ? current.filter((v) => v !== value)
        : [...current, value];
    } else {
      formValues[msg.id] = value;
    }
    formValues = { ...formValues };
  }

  function submitAnswer() {
    const questions = getQuestions();
    const answers: string[] = [];
    for (const q of questions) {
      const val = formValues[msg.id];
      if (q.multiSelect) {
        const selected = (val as string[]) ?? [];
        const other = otherInputs[msg.id]?.trim();
        if (other) selected.push(other);
        if (selected.length > 0) answers.push(`${q.question}: ${selected.join(", ")}`);
      } else {
        const selected = typeof val === "string" ? val : "";
        const other = otherInputs[msg.id]?.trim();
        if (other) answers.push(`${q.question}: ${other}`);
        else if (selected) answers.push(`${q.question}: ${selected}`);
      }
    }
    submittedQuestions = new Set([...submittedQuestions, msg.id]);
    api.send("userPrompt", { prompt: answers.join("\n") });
  }

  // ─── 工具审批 ──────────────────────────────

  let approving = $state<string | null>(null);

  function isToolApproval(): boolean {
    try {
      const data = JSON.parse(msg.content ?? "{}") as Record<string, unknown>;
      const meta = data.metadata as Record<string, unknown> | undefined;
      return meta?.kind === "tool_approval";
    } catch {
      return false;
    }
  }

  function getPendingApprovals(): { toolCallId: string; toolName: string; params: Record<string, unknown>; summary: string }[] {
    try {
      const data = JSON.parse(msg.content ?? "{}") as Record<string, unknown>;
      const meta = data.metadata as Record<string, unknown> | undefined;
      return (meta?.pendingApprovals as { toolCallId: string; toolName: string; params: Record<string, unknown>; summary: string }[]) ?? [];
    } catch {
      return [];
    }
  }

  function approveTool(toolCallId: string) {
    approving = toolCallId;
    api.send("approveTool", { toolCallId, action: "approve" });
  }

  function rejectTool(toolCallId: string) {
    approving = toolCallId;
    api.send("approveTool", { toolCallId, action: "reject" });
  }

  // ─── 工具名称 ──────────────────────────────

  function getToolName(): string {
    const fn = msg.meta?.function;
    if (fn && typeof fn === "object" && "name" in fn) {
      return String((fn as Record<string, unknown>).name ?? "tool");
    }
    return "tool";
  }

  function isUpdatePlan(): boolean {
    return getToolName() === "UpdatePlan" && isSuccessfulUpdatePlan();
  }

  function isSuccessfulUpdatePlan(): boolean {
    if (!msg.content) return false;
    try {
      const data = JSON.parse(msg.content) as { ok?: unknown; name?: unknown };
      return data.name === "UpdatePlan" && data.ok === true;
    } catch {
      return false;
    }
  }

  function toggle() {
    onToggleExpand(msg.id);
  }

  function hasAnswer() {
    return formValues[msg.id] || otherInputs[msg.id]?.trim();
  }
</script>

<div class="bubble-tool">
  <div class="bubble-avatar"></div>
  <div class="bubble-body">
    {#if isAskUserQuestion() && !submittedQuestions.has(msg.id)}
      <div class="question-form">
        <div class="question-hint">💬 等待回答</div>
        {#each getQuestions() as q}
          <div class="question-item">
            <div class="question-text">{q.question}</div>
            <div class="question-options">
              {#each q.options as opt}
                <button
                  class="question-option"
                  class:selected={q.multiSelect
                    ? (formValues[msg.id] as string[] ?? []).includes(opt.label)
                    : formValues[msg.id] === opt.label}
                  onclick={() => selectOption(q.multiSelect, opt.label)}
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
          <input type="text" placeholder="其他…" bind:value={otherInputs[msg.id]} />
        </div>
        <button
          class="question-submit"
          onclick={submitAnswer}
          disabled={!hasAnswer()}
        >发送回答</button>
      </div>
    {:else if isToolApproval()}
      <div class="approval-card">
        <div class="approval-header">🔐 工具调用待审批</div>
        {#each getPendingApprovals() as item}
          <div class="approval-item">
            <div class="approval-tool-name">
              <span class="tool-icon">⚙</span>
              {item.toolName}
            </div>
            <pre class="approval-params">{item.summary}</pre>
            <div class="approval-actions">
              <button
                class="btn-approve"
                onclick={() => approveTool(item.toolCallId)}
                disabled={approving === item.toolCallId}
              >✅ 批准</button>
              <button
                class="btn-reject"
                onclick={() => rejectTool(item.toolCallId)}
                disabled={approving === item.toolCallId}
              >❌ 拒绝</button>
              {#if approving === item.toolCallId}
                <span class="approving-hint">处理中…</span>
              {/if}
            </div>
          </div>
        {/each}
      </div>
    {:else if isUpdatePlan()}
      <div class="plan-wrap">
        <PlanDisplay content={msg.content ?? ""} />
      </div>
    {:else}
      <div class="tool-card">
        <button class="tool-header" onclick={toggle}>
          <span class="collapse-icon">{expandedIds.has(msg.id) ? "▼" : "▶"}</span>
          <span class="tool-icon">⚙</span>
          <span class="tool-name">{getToolName()}</span>
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
  </div>
</div>

<style>
  .bubble-tool {
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
    background: var(--vscode-charts-green, #3fb950);
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

  /* ─── 审批卡片 ──────────────────────────── */

  .approval-card {
    font-size: 12px;
    line-height: 1.5;
  }

  .plan-wrap {
    margin: 2px 0;
  }

  .approval-header {
    font-size: 11px;
    font-weight: 600;
    color: var(--vscode-charts-orange, #d29922);
    margin-bottom: 6px;
    padding-bottom: 4px;
    border-bottom: 1px solid var(--vscode-panel-border);
  }

  .approval-item {
    margin-bottom: 8px;
    padding: 6px 8px;
    background: var(--vscode-input-background, rgba(128,128,128,0.05));
    border-radius: 4px;
    border: 1px solid var(--vscode-focusBorder);
  }

  .approval-tool-name {
    font-weight: 600;
    font-family: var(--vscode-editor-font-family, monospace);
    font-size: 12px;
    margin-bottom: 4px;
    display: flex;
    align-items: center;
    gap: 4px;
  }

  .approval-params {
    font-family: var(--vscode-editor-font-family, monospace);
    font-size: 11px;
    white-space: pre-wrap;
    word-break: break-all;
    margin: 4px 0;
    padding: 4px 6px;
    background: var(--vscode-textCodeBlock-background, rgba(128,128,128,0.1));
    border-radius: 3px;
    max-height: 120px;
    overflow-y: auto;
  }

  .approval-actions {
    display: flex;
    gap: 6px;
    align-items: center;
    margin-top: 6px;
  }

  .btn-approve,
  .btn-reject {
    padding: 4px 12px;
    border: none;
    border-radius: 3px;
    font-size: 11px;
    cursor: pointer;
    transition: opacity 0.15s;
  }

  .btn-approve {
    background: var(--vscode-charts-green, #3fb950);
    color: #fff;
  }

  .btn-reject {
    background: var(--vscode-charts-red, #f85149);
    color: #fff;
  }

  .btn-approve:hover,
  .btn-reject:hover {
    opacity: 0.85;
  }

  .btn-approve:disabled,
  .btn-reject:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .approving-hint {
    font-size: 11px;
    color: var(--vscode-descriptionForeground);
    font-style: italic;
  }

  /* ─── 工具调用卡片 ──────────────────────── */

  .tool-card {
    font-size: 12px;
    line-height: 1.5;
  }

  .tool-header {
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

  .tool-icon {
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
</style>
