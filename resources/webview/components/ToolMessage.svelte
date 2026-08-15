<script lang="ts">
  import type { SessionMessageData } from "../types";
  import { api } from "../lib/api";
  import { appState } from "../lib/state.svelte";
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
  /** 按"消息ID + 问题索引"存储选择，保证多问题互不干扰 */
  type QuestionSelections = Record<number, string | string[]>;

  let selections = $state<Record<string, QuestionSelections>>({});
  /** 按"消息ID + 问题索引"存储"其他"输入 */
  let otherInputs = $state<Record<string, Record<number, string>>>({});
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

  /** 取某个问题的最终答案（选项 + "其他"），没有答案返回 null */
  function getQuestionAnswer(index: number, multiSelect: boolean | undefined): string | null {
    const selected = selections[msg.id]?.[index];
    const other = otherInputs[msg.id]?.[index]?.trim();
    if (multiSelect) {
      const arr = Array.isArray(selected) ? [...selected] : [];
      if (other) arr.push(other);
      return arr.length > 0 ? arr.join(", ") : null;
    }
    if (other) return other;
    if (typeof selected === "string" && selected) return selected;
    return null;
  }

  function selectOption(index: number, multiSelect: boolean | undefined, value: string) {
    const next = { ...(selections[msg.id] ?? {}) };
    if (multiSelect) {
      const current = Array.isArray(next[index]) ? (next[index] as string[]) : [];
      next[index] = current.includes(value) ? current.filter((v) => v !== value) : [...current, value];
    } else {
      next[index] = value;
    }
    selections = { ...selections, [msg.id]: next };
  }

  function setOther(index: number, value: string) {
    const next = { ...(otherInputs[msg.id] ?? {}) };
    next[index] = value;
    otherInputs = { ...otherInputs, [msg.id]: next };
  }

  function submitAnswer() {
    const questions = getQuestions();
    const answers: string[] = [];
    for (let i = 0; i < questions.length; i += 1) {
      const answer = getQuestionAnswer(i, questions[i].multiSelect);
      if (answer) {
        answers.push(`${questions[i].question}: ${answer}`);
      }
    }
    if (answers.length === 0) return; // 没有任何回答则不发送
    submittedQuestions = new Set([...submittedQuestions, msg.id]);
    api.send("userPrompt", { prompt: answers.join("\n") });
  }

  // ─── 工具审批 ──────────────────────────────

  /** 是否已对该 toolCallId 做出决定（读取全局审批决定，支持多审批项并存） */
  function getApprovalDecision(toolCallId: string): "approve" | "reject" | null {
    return appState.approvalDecisions[toolCallId] ?? null;
  }

  function isToolApproval(): boolean {
    try {
      const data = JSON.parse(msg.content ?? "{}") as Record<string, unknown>;
      const meta = data.metadata as Record<string, unknown> | undefined;
      return meta?.kind === "tool_approval";
    } catch {
      return false;
    }
  }

  function getPendingApprovals(): {
    toolCallId: string;
    toolName: string;
    params: Record<string, unknown>;
    summary: string;
  }[] {
    try {
      const data = JSON.parse(msg.content ?? "{}") as Record<string, unknown>;
      const meta = data.metadata as Record<string, unknown> | undefined;
      return (
        (meta?.pendingApprovals as {
          toolCallId: string;
          toolName: string;
          params: Record<string, unknown>;
          summary: string;
        }[]) ?? []
      );
    } catch {
      return [];
    }
  }

  /** 乐观标记决定并推送后端；每个 toolCallId 独立记录，互不影响 */
  function decideApproval(toolCallId: string, action: "approve" | "reject") {
    appState.approvalDecisions = {
      ...appState.approvalDecisions,
      [toolCallId]: action,
    };
    api.send("approveTool", { toolCallId, action });
  }

  // ─── 工具名称与参数解析 ──────────────────────

  /**
   * 从 meta.function.arguments 中提取指定字段。
   * arguments 是 JSON 字符串，解析后按字段名取值。
   */
  function getToolArg(key: string): string | null {
    const fn = msg.meta?.function;
    if (!fn || typeof fn !== "object") return null;
    try {
      const args = JSON.parse(String((fn as Record<string, unknown>).arguments ?? "{}")) as Record<string, unknown>;
      const val = args[key];
      return typeof val === "string" && val.trim() ? val.trim() : null;
    } catch {
      return null;
    }
  }

  function getToolName(): string {
    const fn = msg.meta?.function;
    if (fn && typeof fn === "object" && "name" in fn) {
      return String((fn as Record<string, unknown>).name ?? "tool");
    }
    return "tool";
  }

  /** bash 工具的命令 */
  function getToolCommand(): string | null {
    return getToolArg("command");
  }

  /** bash 工具的描述（AI 填写的意图说明） */
  function getToolDescription(): string | null {
    return getToolArg("description");
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
    const questions = getQuestions();
    for (let i = 0; i < questions.length; i += 1) {
      if (getQuestionAnswer(i, questions[i].multiSelect)) return true;
    }
    return false;
  }
</script>

<div class="bubble-tool">
  <div class="bubble-avatar"></div>
  <div class="bubble-body">
    {#if isAskUserQuestion() && !submittedQuestions.has(msg.id)}
      <div class="question-form">
        <div class="question-hint">💬 等待回答</div>
        {#each getQuestions() as q, i}
          <div class="question-item">
            <div class="question-text">{q.question}</div>
            <div class="question-options">
              {#each q.options as opt}
                <button
                  class="question-option"
                  class:selected={q.multiSelect
                    ? ((selections[msg.id]?.[i] as string[]) ?? []).includes(opt.label)
                    : selections[msg.id]?.[i] === opt.label}
                  onclick={() => selectOption(i, q.multiSelect, opt.label)}
                >
                  <span class="option-label">{opt.label}</span>
                  {#if opt.description}
                    <span class="option-desc">{opt.description}</span>
                  {/if}
                </button>
              {/each}
            </div>
            <div class="question-other">
              <input
                type="text"
                placeholder="其他…"
                value={otherInputs[msg.id]?.[i] ?? ""}
                oninput={(e) => setOther(i, (e.target as HTMLInputElement).value)}
              />
            </div>
          </div>
        {/each}
        <button class="question-submit" onclick={submitAnswer} disabled={!hasAnswer()}>发送回答</button>
      </div>
    {:else if isToolApproval()}
      <div class="approval-card">
        <div class="approval-header">🔐 工具调用待审批</div>
        {#each getPendingApprovals() as item}
          {@const decision = getApprovalDecision(item.toolCallId)}
          <div class="approval-item">
            <div class="approval-tool-name">
              <span class="tool-icon">⚙</span>
              {item.toolName}
            </div>
            {#if item.params?.description}
              <div class="approval-description">{String(item.params.description)}</div>
            {/if}
            <pre class="approval-params">{item.summary}</pre>
            {#if decision}
              <div class="approval-decided">
                {#if decision === "approve"}
                  <span class="approval-decided-ok">✅ 已批准</span>
                {:else}
                  <span class="approval-decided-no">❌ 已拒绝</span>
                {/if}
              </div>
            {:else}
              <div class="approval-actions">
                <button class="btn-approve" onclick={() => decideApproval(item.toolCallId, "approve")}>✅ 批准</button>
                <button class="btn-reject" onclick={() => decideApproval(item.toolCallId, "reject")}>❌ 拒绝</button>
              </div>
            {/if}
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
        </button>
        <div class="tool-summary">
          {#if getToolDescription()}
            <div class="tool-description">{getToolDescription()}</div>
          {/if}
          {#if getToolCommand()}
            <div class="tool-command-line"><span class="tool-prompt">$</span> {getToolCommand()}</div>
          {:else if msg.meta?.paramsMd}
            <div class="tool-command-line">{msg.meta.paramsMd}</div>
          {/if}
        </div>
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
    from {
      opacity: 0;
      transform: translateY(4px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  .bubble-tool::before {
    content: "";
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
    background: var(--vscode-input-background, rgba(128, 128, 128, 0.05));
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

  .approval-description {
    font-size: 11px;
    color: var(--vscode-descriptionForeground);
    opacity: 0.85;
    margin: 2px 0 4px;
    line-height: 1.4;
  }

  .approval-params {
    font-family: var(--vscode-editor-font-family, monospace);
    font-size: 11px;
    white-space: pre-wrap;
    word-break: break-all;
    margin: 4px 0;
    padding: 4px 6px;
    background: var(--vscode-textCodeBlock-background, rgba(128, 128, 128, 0.1));
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

  .approval-decided {
    margin-top: 6px;
    font-size: 11px;
    font-weight: 600;
  }

  .approval-decided-ok {
    color: var(--vscode-charts-green, #3fb950);
  }

  .approval-decided-no {
    color: var(--vscode-charts-red, #f85149);
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

  .tool-summary {
    margin-left: 17px;
    margin-top: 2px;
  }

  .tool-description {
    font-size: 11px;
    color: var(--vscode-descriptionForeground);
    opacity: 0.85;
    line-height: 1.4;
  }

  .tool-command-line {
    font-family: var(--vscode-editor-font-family, monospace);
    font-size: 11px;
    color: var(--vscode-foreground);
    opacity: 0.65;
    line-height: 1.4;
  }

  .tool-prompt {
    opacity: 0.5;
    margin-right: 4px;
    user-select: none;
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
    transition:
      border-color 0.12s,
      background 0.12s;
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
