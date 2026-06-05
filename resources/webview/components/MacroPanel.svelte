<script lang="ts">
  import { BUILTIN_TOOLS } from "../../../src/tools/builtin-tools";

  let {
    oninsert = (_macro: string) => {},
  }: {
    oninsert: (macro: string) => void;
  } = $props();

  let open = $state(false);

  const MACROS = [
    {
      group: "工具文档",
      items: BUILTIN_TOOLS.map((t) => `{{tool.${t}}}`),
    },
    {
      group: "技能系统",
      items: ["{{skill.agent-drift-guard}}", "{{skill.plan-and-execute}}"],
    },
    {
      group: "运行时",
      items: ["{{runtime_context}}","{{workspace}}", "{{editor_selection}}", "{{active_file}}", "{{active_file_path}}", "{{attached_files}}", "{{attached_files_path}}"],
    },
    {
      group: "变量",
      items: ["{{char}}", "{{user}}", "{{model}}", "{{date}}", "{{time}}", "{{lastUserMessage}}", "{{global_memory}}", "{{repo_memory}}"],
    },
  ];
</script>

<div class="macro-inline">
  <button class="macro-toggle" onclick={() => (open = !open)}>
    <svg viewBox="0 0 16 16" width="12" height="12" class:rotated={open}>
      <path fill="currentColor" d="M5.22 3.47a.75.75 0 0 1 1.06 0l4.25 4.25a.75.75 0 0 1 0 1.06l-4.25 4.25a.75.75 0 0 1-1.06-1.06L8.94 8 5.22 4.53a.75.75 0 0 1 0-1.06Z"/>
    </svg>
    插入宏
  </button>

  {#if open}
    <div class="macro-groups">
      {#each MACROS as group}
        <div class="macro-group">
          <span class="macro-group-label">{group.group}</span>
          <div class="macro-items">
            {#each group.items as macro}
              <button class="macro-btn" onmousedown={(e) => { e.preventDefault(); oninsert(macro); }}>
                <code>{macro}</code>
              </button>
            {/each}
          </div>
        </div>
      {/each}
    </div>
  {/if}
</div>

<style>
  .macro-inline {
    border: 1px solid var(--vscode-panel-border);
    border-radius: 6px;
    padding: 6px 8px;
    margin-top: 6px;
    background: var(--vscode-editor-background);
  }

  .macro-toggle {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 2px 4px;
    border: none;
    border-radius: 4px;
    background: transparent;
    color: var(--vscode-foreground);
    font-size: 11px;
    cursor: pointer;
    transition: background 0.1s;
  }

  .macro-toggle:hover {
    background: var(--vscode-list-hoverBackground);
  }

  .macro-toggle svg {
    transition: transform 0.15s;
  }

  .macro-toggle svg.rotated {
    transform: rotate(90deg);
  }

  .macro-groups {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 8px 0 4px;
    max-height: 30vh;
    overflow-y: auto;
  }

  .macro-group {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .macro-group-label {
    font-size: 10px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: var(--vscode-descriptionForeground);
  }

  .macro-items {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }

  .macro-btn {
    padding: 2px 8px;
    border: 1px solid var(--vscode-panel-border);
    border-radius: 4px;
    background: var(--vscode-editor-background);
    cursor: pointer;
    transition: border-color 0.1s, background 0.1s;
  }

  .macro-btn:hover {
    border-color: var(--vscode-focusBorder);
    background: var(--vscode-list-hoverBackground);
  }

  .macro-btn code {
    font-size: 11px;
    color: var(--vscode-textLink-foreground, #58a6ff);
    word-break: break-all;
  }
</style>
