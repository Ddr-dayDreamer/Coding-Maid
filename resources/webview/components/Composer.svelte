<script lang="ts">
  import { appState } from "../lib/state.svelte";
  import { api } from "../lib/api";
  import type { AttachedFile } from "../types";
  import ContextMeter from "./ContextMeter.svelte";
  import PresetQuickSelector from "./PresetQuickSelector.svelte";
  import ProfileQuickSelector from "./ProfileQuickSelector.svelte";
  import AttachedFilesBar from "./AttachedFilesBar.svelte";

  let promptText = $state("");
  let textareaEl: HTMLTextAreaElement | undefined = $state();

  // ─── 拖入状态 ────────────────────────────────────────

  let isDragOver = $state(false);
  let dragCounter = $state(0);

  // ─── 自动扩展 textarea ──────────────────────────────

  const MAX_HEIGHT_RATIO = 0.5; // 最多占视口高度 50%

  function autoResize() {
    const el = textareaEl;
    if (!el) return;

    el.style.height = "auto";
    const maxH = window.innerHeight * MAX_HEIGHT_RATIO;
    const newH = Math.min(el.scrollHeight, maxH);
    el.style.height = `${newH}px`;
    el.style.overflowY = el.scrollHeight > maxH ? "auto" : "hidden";
  }

  // ─── 窗口 resize 时重算 ──────────────────────────────

  $effect(() => {
    if (!textareaEl) return;
    const onResize = () => autoResize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  });

  // ─── 回退时填入输入框 ───────────────────────────────

  $effect(() => {
    const text = appState.pendingPrompt;
    if (text) {
      promptText = text;
      appState.pendingPrompt = "";
    }
  });

  // ─── 发送 / 中断 ─────────────────────────────────────

  function sendPrompt() {
    if (appState.isProcessing) {
      api.send("interrupt");
      appState.currentSessionStatus = "interrupted";
      appState.isLoading = false;
      return;
    }

    const text = promptText.trim();
    if (!text) return;

    promptText = "";
    api.send("userPrompt", { prompt: text });

    // 重置 textarea 高度
    if (textareaEl) {
      textareaEl.style.height = "auto";
    }
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      const textarea = e.currentTarget as HTMLTextAreaElement;
      promptText = textarea.value;
      sendPrompt();
    }
  }

  function handleInput() {
    autoResize();
  }

  // ═══════════════════════════════════════════════════════
  //  拖放处理
  // ═══════════════════════════════════════════════════════

  function handleDragEnter(e: DragEvent) {
    e.preventDefault();
    dragCounter++;
    isDragOver = true;
  }

  function handleDragOver(e: DragEvent) {
    e.preventDefault();
    // 必须设置 dropEffect 才能接收 drop
    if (e.dataTransfer) {
      e.dataTransfer.dropEffect = "copy";
    }
  }

  function handleDragLeave(e: DragEvent) {
    e.preventDefault();
    dragCounter--;
    if (dragCounter <= 0) {
      dragCounter = 0;
      isDragOver = false;
    }
  }

  async function handleDrop(e: DragEvent) {
    e.preventDefault();
    dragCounter = 0;
    isDragOver = false;

    const dt = e.dataTransfer;
    if (!dt) return;

    const types = dt.types;
    const hasUriList = types?.includes("text/uri-list");
    const hasPlainText = types?.includes("text/plain");

    try {
      if (hasUriList) {
        // ── 拖入文件（来自 VS Code 文件管理器） ──
        const uriList = dt.getData("text/uri-list");
        const filePaths = parseUriList(uriList);
        if (filePaths.length > 0) {
          await attachFiles(filePaths);
          return;
        }
      }

      if (hasPlainText) {
        // ── 拖入代码段 / 文本 ──
        const text = dt.getData("text/plain");
        if (text && text.length > 20) {
          // 只有较长的文本才视为代码段（避免误抓单行路径名）
          await attachSnippet(text);
          return;
        }
      }
    } catch {
      // 静默失败
    }
  }

  /** 解析 text/uri-list 为文件绝对路径列表 */
  function parseUriList(text: string): string[] {
    return text
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#"))
      .map((uri) => {
        if (!uri.startsWith("file://")) return "";
        const decoded = decodeURIComponent(uri.slice(7)); // 去掉 "file://"
        // Windows: file:///C:/path → /C:/path → C:/path
        if (decoded.startsWith("/") && /^\/[A-Za-z]:/.test(decoded)) {
          return decoded.slice(1);
        }
        return decoded;
      })
      .filter(Boolean);
  }

  /** 附加文件：前端更新展示 + 通知后端 */
  async function attachFiles(filePaths: string[]) {
    // 去重
    const existing = new Set(appState.attachedFiles.map((f) => f.filePath));
    const newFiles: AttachedFile[] = [];

    for (const fp of filePaths) {
      if (existing.has(fp)) continue;
      existing.add(fp);
      const fileName = fp.split(/[\\/]/).pop() || fp;
      newFiles.push({ filePath: fp, fileName });
    }

    if (newFiles.length === 0) return;

    // 通知后端
    api.send("attachFiles", {
      filePaths: newFiles.map((f) => f.filePath),
    });

    // 更新前端展示
    appState.attachedFiles = [...appState.attachedFiles, ...newFiles];
  }

  /** 附加代码段：写入临时文件 + 通知后端 */
  async function attachSnippet(content: string) {
    // 用首行生成展示名
    const firstLine = content.split("\n")[0].trim().slice(0, 60);
    const label = firstLine || "代码段";

    try {
      const result = await api.request<{ filePath: string; fileName: string }>("attachSnippet", {
        content,
        fileName: label,
      });

      appState.attachedFiles = [
        ...appState.attachedFiles,
        {
          filePath: result.filePath,
          fileName: result.fileName,
          isSnippet: true,
        },
      ];
    } catch {
      // 静默失败
    }
  }
</script>

<div
  class="composer"
  class:dragover={isDragOver}
  ondragenter={handleDragEnter}
  ondragover={handleDragOver}
  ondragleave={handleDragLeave}
  ondrop={handleDrop}
>
  <AttachedFilesBar />
  <div class="input-wrap">
    <textarea
      bind:this={textareaEl}
      bind:value={promptText}
      onkeydown={handleKeydown}
      oninput={handleInput}
      placeholder="输入消息... (Shift+Enter 换行)"
      rows="1"
    ></textarea>
    <div class="composer-footer">
      <div class="footer-left">
        <ContextMeter />
        <PresetQuickSelector />
        <ProfileQuickSelector />
      </div>
      <div class="footer-right">
        <button
          class="send-btn"
          onclick={sendPrompt}
          disabled={!promptText.trim() && !appState.isProcessing}
          title={appState.isProcessing ? "中断" : "发送"}
        >
          {#if appState.isProcessing}
            <svg viewBox="0 0 16 16" width="16" height="16">
              <rect x="3" y="3" width="10" height="10" rx="2" fill="currentColor" />
            </svg>
          {:else}
            <svg viewBox="0 0 16 16" width="16" height="16">
              <path d="M1.5 1.5L14.5 8L1.5 14.5V1.5z" fill="currentColor" />
            </svg>
          {/if}
        </button>
      </div>
    </div>
  </div>

  <!-- 拖拽释放提示 -->
  {#if isDragOver}
    <div class="drop-overlay">
      <div class="drop-hint">
        <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="1.5">
          <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
          <polyline points="17,8 12,3 7,8" />
          <line x1="12" y1="3" x2="12" y2="15" />
        </svg>
        <span>释放以附加文件</span>
      </div>
    </div>
  {/if}
</div>

<style>
  .composer {
    flex-shrink: 0;
    padding: 6px 12px 12px;
    background: var(--vscode-sideBar-background);
    border-top: 1px solid var(--vscode-panel-border);
  }

  .input-wrap {
    display: flex;
    flex-direction: column;
    border-radius: 8px;
    border: 1px solid var(--vscode-panel-border);
    background: var(--vscode-input-background);
    transition: border-color 0.15s;
  }

  .input-wrap:focus-within {
    border-color: var(--vscode-focusBorder);
  }

  textarea {
    width: 100%;
    min-height: 28px;
    max-height: 50vh;
    resize: none;
    border: none;
    background: transparent;
    color: var(--vscode-input-foreground);
    padding: 10px 12px 4px;
    font-size: 13px;
    line-height: 18px;
    outline: none;
    font-family: var(--vscode-font-family);
    overflow-y: hidden;
    box-sizing: border-box;
  }

  textarea::placeholder {
    color: var(--vscode-input-placeholderForeground);
  }

  .composer-footer {
    display: flex;
    height: 34px;
    align-items: center;
    justify-content: space-between;
    padding: 0 8px 4px;
  }

  .footer-left {
    display: flex;
    gap: 6px;
    align-items: center;
  }

  .send-btn {
    width: 28px;
    height: 28px;
    border-radius: 50%;
    border: none;
    cursor: pointer;
    display: grid;
    place-items: center;
    background: transparent;
    color: var(--vscode-foreground);
    transition: background 0.15s;
  }

  .send-btn:hover:not(:disabled) {
    background: var(--vscode-button-hoverBackground, var(--vscode-toolbar-hoverBackground));
  }

  .send-btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  /* ─── 拖拽视觉反馈 ──────────────────────────────── */

  .composer.dragover .input-wrap {
    border-color: var(--vscode-focusBorder);
    box-shadow: 0 0 0 1px var(--vscode-focusBorder);
  }

  .drop-overlay {
    position: absolute;
    inset: 0;
    z-index: 50;
    display: flex;
    align-items: center;
    justify-content: center;
    background: color-mix(in srgb, var(--vscode-sideBar-background) 85%, transparent);
    border-radius: 8px;
    pointer-events: none;
    animation: fadeIn 0.12s ease;
  }

  .drop-hint {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    color: var(--vscode-focusBorder);
    font-size: 13px;
    font-weight: 500;
    opacity: 0.9;
  }

  .drop-hint svg {
    opacity: 0.6;
  }

  @keyframes fadeIn {
    from { opacity: 0; }
    to { opacity: 1; }
  }
</style>
