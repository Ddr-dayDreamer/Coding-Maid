<script lang="ts">
  import { appState } from "./lib/state.svelte";
  import { api } from "./lib/api";
  import type { AttachedFile } from "./types";
  import TabBar from "./components/TabBar.svelte";
  import ChatPage from "./components/ChatPage.svelte";
  import PresetPage from "./components/PresetPage.svelte";
  import ProfilePage from "./components/ProfilePage.svelte";
  import ToastNotification from "./components/ToastNotification.svelte";

  // ─── 页面级拖放 ────────────────────────────────────

  let dragCounter = $state(0);

  function handleDragEnter(e: DragEvent) {
    e.preventDefault();
    dragCounter++;
    appState.isDragOver = true;
  }

  function handleDragOver(e: DragEvent) {
    e.preventDefault();
    if (e.dataTransfer) {
      e.dataTransfer.dropEffect = "copy";
    }
  }

  function handleDragLeave(e: DragEvent) {
    e.preventDefault();
    dragCounter--;
    if (dragCounter <= 0) {
      dragCounter = 0;
      appState.isDragOver = false;
    }
  }

  async function handleDrop(e: DragEvent) {
    e.preventDefault();
    dragCounter = 0;
    appState.isDragOver = false;

    const dt = e.dataTransfer;
    if (!dt) return;

    try {
      const uriList = dt.getData("text/uri-list");
      if (uriList) {
        const filePaths = parseUriList(uriList);
        if (filePaths.length > 0) {
          await attachFiles(filePaths);
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
        const decoded = decodeURIComponent(uri.slice(7));
        if (decoded.startsWith("/") && /^\/[A-Za-z]:/.test(decoded)) {
          return decoded.slice(1);
        }
        return decoded;
      })
      .filter(Boolean);
  }

  /** 附加文件：前端更新展示 + 通知后端 */
  async function attachFiles(filePaths: string[]) {
    const existing = new Set(appState.attachedFiles.map((f) => f.filePath));
    const newFiles: AttachedFile[] = [];

    for (const fp of filePaths) {
      if (existing.has(fp)) continue;
      existing.add(fp);
      const fileName = fp.split(/[\\/]/).pop() || fp;
      newFiles.push({ filePath: fp, fileName });
    }

    if (newFiles.length === 0) return;

    api.send("attachFiles", {
      filePaths: newFiles.map((f) => f.filePath),
    });

    appState.attachedFiles = [...appState.attachedFiles, ...newFiles];
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="app"
  ondragenter={handleDragEnter}
  ondragover={handleDragOver}
  ondragleave={handleDragLeave}
  ondrop={handleDrop}
>
  <TabBar />

  {#if appState.currentTab === "chat"}
    <ChatPage />
  {:else if appState.currentTab === "presets"}
    <PresetPage />
  {:else if appState.currentTab === "profiles"}
    <ProfilePage />
  {/if}

  <ToastNotification />

  <!-- 全页拖放释放提示 -->
  {#if appState.isDragOver}
    <div class="drop-overlay">
      <div class="drop-hint">
        <svg viewBox="0 0 24 24" width="32" height="32" fill="none" stroke="currentColor" stroke-width="1.5">
          <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
          <polyline points="17,8 12,3 7,8" />
          <line x1="12" y1="3" x2="12" y2="15" />
        </svg>
        <span class="drop-hint-text">按住 Shift 并释放以附加文件</span>
        <span class="drop-hint-sub">从 VS Code 资源管理器拖入文件</span>
      </div>
    </div>
  {/if}
</div>

<style>
  .app {
    flex: 1;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    min-height: 0;
    position: relative;
  }

  /* ─── 全页拖放叠加层 ──────────────────────────── */

  .drop-overlay {
    position: fixed;
    inset: 0;
    z-index: 9999;
    display: flex;
    align-items: center;
    justify-content: center;
    background: color-mix(in srgb, var(--vscode-sideBar-background) 80%, transparent);
    backdrop-filter: blur(2px);
    animation: fadeIn 0.12s ease;
    pointer-events: none;
  }

  .drop-hint {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 10px;
    padding: 32px 48px;
    border-radius: 12px;
    border: 2px dashed var(--vscode-focusBorder);
    background: color-mix(in srgb, var(--vscode-editor-background) 90%, transparent);
  }

  .drop-hint svg {
    color: var(--vscode-focusBorder);
    opacity: 0.7;
  }

  .drop-hint-text {
    font-size: 14px;
    font-weight: 600;
    color: var(--vscode-foreground);
  }

  .drop-hint-sub {
    font-size: 11px;
    color: var(--vscode-descriptionForeground);
    opacity: 0.7;
  }

  @keyframes fadeIn {
    from { opacity: 0; }
    to { opacity: 1; }
  }
</style>
