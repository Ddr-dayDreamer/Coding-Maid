<script lang="ts">
  let { content }: { content: string } = $props();

  // ─── 解析 UpdatePlan 结果 ───────────────────────────

  type PlanData = {
    name: string;
    ok: boolean;
    output?: string;
    metadata?: { plan?: string };
  };

  function parsePlan(text: string): PlanData | null {
    try {
      const data = JSON.parse(text) as PlanData;
      if (data.name === "UpdatePlan" && data.ok === true && data.metadata?.plan) {
        return data;
      }
      return null;
    } catch {
      return null;
    }
  }

  function getTaskItems(markdown: string): { prefix: string; text: string }[] {
    const lines = markdown.split("\n");
    const items: { prefix: string; text: string }[] = [];
    let inCodeBlock = false;

    for (const line of lines) {
      // 跳过代码块内部
      if (line.trimStart().startsWith("```")) {
        inCodeBlock = !inCodeBlock;
        continue;
      }
      if (inCodeBlock) continue;

      // 识别任务列表项: - [ ] xxx, - [>] xxx, - [x] xxx, - [!] xxx
      const taskMatch = line.match(/^(\s*[-*]\s*\[([ >x!])\]\s*)(.*)$/);
      if (taskMatch) {
        items.push({ prefix: taskMatch[2], text: taskMatch[3] });
        continue;
      }

      // 识别普通列表项
      const listMatch = line.match(/^(\s*[-*]\s+)(.*)$/);
      if (listMatch) {
        items.push({ prefix: "", text: line });
        continue;
      }

      // 标题
      const headingMatch = line.match(/^(#{1,6})\s+(.*)$/);
      if (headingMatch) {
        items.push({ prefix: "", text: line });
        continue;
      }

      // 空行
      if (line.trim() === "") {
        items.push({ prefix: "", text: "" });
        continue;
      }

      // 其他文本
      items.push({ prefix: "", text: line });
    }

    return items;
  }

  function getStatusIcon(prefix: string): string {
    switch (prefix) {
      case "x": return "✅";
      case ">": return "🔄";
      case "!": return "⛔";
      case " ": return "⬜";
      default: return "";
    }
  }

  function getStatusClass(prefix: string): string {
    switch (prefix) {
      case "x": return "task-done";
      case ">": return "task-progress";
      case "!": return "task-blocked";
      case " ": return "task-pending";
      default: return "";
    }
  }

  const planData = $derived(parsePlan(content));
  const taskItems = $derived(planData ? getTaskItems(planData.metadata!.plan!) : []);
  const heading = $derived(planData?.metadata?.plan?.split("\n")[0] ?? "");
</script>

{#if planData}
  <div class="plan-display">
    <div class="plan-header">📋 当前计划</div>
    <div class="plan-body">
      {#each taskItems as item}
        {#if item.prefix !== ""}
          <!-- 任务列表项 -->
          <div class="task-item {getStatusClass(item.prefix)}">
            <span class="task-icon">{getStatusIcon(item.prefix)}</span>
            <span class="task-text">{item.text}</span>
          </div>
        {:else if item.text === ""}
          <div class="task-separator"></div>
        {:else if item.text.startsWith("##")}
          <div class="task-heading-2">{item.text.replace(/^##+\s*/, "")}</div>
        {:else if item.text.startsWith("# ")}
          <div class="task-heading-1">{item.text.replace(/^#\s*/, "")}</div>
        {:else}
          <div class="task-text">{item.text}</div>
        {/if}
      {/each}
    </div>
  </div>
{/if}

<style>
  .plan-display {
    font-size: 13px;
    line-height: 1.5;
    background: var(--vscode-editor-background, rgba(128,128,128,0.04));
    border: 1px solid var(--vscode-focusBorder);
    border-radius: 6px;
    overflow: hidden;
  }

  .plan-header {
    font-size: 11px;
    font-weight: 600;
    padding: 4px 8px;
    background: var(--vscode-focusBorder);
    color: var(--vscode-editor-background, #fff);
    opacity: 0.85;
  }

  .plan-body {
    padding: 6px 8px;
  }

  .task-item {
    display: flex;
    align-items: flex-start;
    gap: 4px;
    padding: 1px 0;
  }

  .task-icon {
    flex-shrink: 0;
    width: 18px;
    text-align: center;
    font-size: 12px;
    line-height: 1.6;
  }

  .task-text {
    flex: 1;
    min-width: 0;
    word-break: break-word;
  }

  .task-heading-1 {
    font-weight: 700;
    font-size: 14px;
    margin: 4px 0 2px;
  }

  .task-heading-2 {
    font-weight: 600;
    font-size: 13px;
    margin: 3px 0 1px;
    color: var(--vscode-textLink-foreground);
  }

  .task-separator {
    height: 4px;
  }

  .task-done .task-text {
    text-decoration: line-through;
    opacity: 0.65;
  }

  .task-progress .task-text {
    font-weight: 500;
    color: var(--vscode-charts-orange, #d29922);
  }

  .task-blocked .task-text {
    color: var(--vscode-errorForeground, #f14c4c);
  }

  .task-pending .task-text {
    opacity: 0.85;
  }
</style>
