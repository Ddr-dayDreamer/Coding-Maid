<script lang="ts">
  import { notify, type NotificationItem } from "../lib/notification.svelte";

  let items = $derived(notify.items);

  const ICONS: Record<string, string> = {
    error:
      `<svg viewBox="0 0 16 16" width="14" height="14"><path fill="currentColor" d="M4.47 3.47a.75.75 0 0 1 1.06 0L8 5.94l2.47-2.47a.75.75 0 1 1 1.06 1.06L9.06 7l2.47 2.47a.75.75 0 1 1-1.06 1.06L8 8.06l-2.47 2.47a.75.75 0 0 1-1.06-1.06L6.94 7 4.47 4.53a.75.75 0 0 1 0-1.06Z"/></svg>`,
    success:
      `<svg viewBox="0 0 16 16" width="14" height="14"><path fill="currentColor" d="M13.78 4.22a.75.75 0 0 1 0 1.06l-7.25 7.25a.75.75 0 0 1-1.06 0L2.22 9.28a.75.75 0 0 1 1.06-1.06L6 10.94l6.72-6.72a.75.75 0 0 1 1.06 0Z"/></svg>`,
    warning:
      `<svg viewBox="0 0 16 16" width="14" height="14"><path fill="currentColor" d="M8 1.5a.75.75 0 0 1 .65.375l6.3 10.9a.75.75 0 0 1-.65 1.125H1.7a.75.75 0 0 1-.65-1.125l6.3-10.9A.75.75 0 0 1 8 1.5ZM8 5a.75.75 0 0 0-.75.75v2.5a.75.75 0 0 0 1.5 0v-2.5A.75.75 0 0 0 8 5Zm0 5.5a1 1 0 1 0 0 2 1 1 0 0 0 0-2Z"/></svg>`,
    info:
      `<svg viewBox="0 0 16 16" width="14" height="14"><path fill="currentColor" d="M8 1.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13ZM6.5 7.75A.75.75 0 0 1 7.25 7h1a.75.75 0 0 1 .75.75v2.5h.25a.75.75 0 0 1 0 1.5h-2.5a.75.75 0 0 1 0-1.5H7V8.5h-.75a.75.75 0 0 1-.75-.75ZM8 4.5a1 1 0 1 0 0 2 1 1 0 0 0 0-2Z"/></svg>`,
  };

  function handleDismiss(id: string) {
    notify.dismiss(id);
  }
</script>

{#if items.length > 0}
  <div class="toast-container">
    {#each items as item (item.id)}
      <div
        class="toast toast-{item.type}"
        role="alert"
      >
        <span class="toast-icon">{@html ICONS[item.type]}</span>
        <span class="toast-text">{item.text}</span>
        <button class="toast-close" onclick={() => handleDismiss(item.id)} aria-label="关闭">
          <svg viewBox="0 0 16 16" width="12" height="12">
            <path fill="currentColor" d="M3.72 3.72a.75.75 0 0 1 1.06 0L8 6.94l3.22-3.22a.75.75 0 1 1 1.06 1.06L9.06 8l3.22 3.22a.75.75 0 1 1-1.06 1.06L8 9.06l-3.22 3.22a.75.75 0 0 1-1.06-1.06L6.94 8 3.72 4.78a.75.75 0 0 1 0-1.06Z"/>
          </svg>
        </button>
      </div>
    {/each}
  </div>
{/if}

<style>
  .toast-container {
    position: fixed;
    bottom: 12px;
    left: 50%;
    transform: translateX(-50%);
    display: flex;
    flex-direction: column;
    gap: 6px;
    z-index: 1000;
    pointer-events: none;
    max-width: 90%;
  }

  .toast {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 10px 6px 14px;
    border-radius: 6px;
    font-size: 12px;
    box-shadow: 0 2px 8px rgba(0,0,0,0.25);
    pointer-events: auto;
    animation: toast-in 0.2s ease;
    white-space: nowrap;
  }

  .toast-icon {
    flex-shrink: 0;
    display: flex;
    align-items: center;
  }

  .toast-text {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .toast-close {
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 18px;
    height: 18px;
    padding: 0;
    border: none;
    border-radius: 3px;
    background: transparent;
    color: inherit;
    cursor: pointer;
    opacity: 0.6;
    transition: opacity 0.1s, background 0.1s;
  }

  .toast-close:hover {
    opacity: 1;
    background: rgba(255,255,255,0.1);
  }

  /* ─── 类型主题 ─────────────────────── */

  .toast-error {
    background: var(--vscode-inputValidation-errorBackground, #5a1d1d);
    border: 1px solid var(--vscode-inputValidation-errorBorder, #e33);
    color: var(--vscode-errorForeground, #f88);
  }

  .toast-success {
    background: var(--vscode-inputValidation-infoBackground, #1d3a5a);
    border: 1px solid var(--vscode-inputValidation-infoBorder, #3b8);
    color: var(--vscode-foreground);
  }

  .toast-warning {
    background: #5a4a1d;
    border: 1px solid #b8a030;
    color: var(--vscode-foreground);
  }

  .toast-info {
    background: var(--vscode-inputValidation-infoBackground, #1d3a5a);
    border: 1px solid var(--vscode-focusBorder);
    color: var(--vscode-foreground);
  }

  @keyframes toast-in {
    from {
      opacity: 0;
      transform: translateY(8px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }
</style>
