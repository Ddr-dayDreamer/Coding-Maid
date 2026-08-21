<script lang="ts">
  import { appState } from "./lib/state.svelte";
  import { api } from "./lib/api";
  import type { AttachedFile } from "./types";
  import TabBar from "./components/TabBar.svelte";
  import ChatPage from "./components/ChatPage.svelte";
  import PresetPage from "./components/PresetPage.svelte";
  import ProfilePage from "./components/ProfilePage.svelte";
  import ApprovalPage from "./components/ApprovalPage.svelte";
  import ToastNotification from "./components/ToastNotification.svelte";

  // ─── 页面级拖放 ────────────────────────────────────

  let dragCounter = $state(0);

  function isChatTab(): boolean {
    return appState.currentTab === "chat";
  }

  function handleDragEnter(e: DragEvent) {
    if (!isChatTab()) return;
    e.preventDefault();
    dragCounter++;
    appState.isDragOver = true;
  }

  function handleDragOver(e: DragEvent) {
    if (!isChatTab()) return;
    e.preventDefault();
    if (e.dataTransfer) {
      e.dataTransfer.dropEffect = "copy";
    }
  }

  function handleDragLeave(e: DragEvent) {
    if (!isChatTab()) return;
    e.preventDefault();
    dragCounter--;
    if (dragCounter <= 0) {
      dragCounter = 0;
      appState.isDragOver = false;
    }
  }

  async function handleDrop(e: DragEvent) {
    if (!isChatTab()) return;
    e.preventDefault();
    dragCounter = 0;
    appState.isDragOver = false;

    const dt = e.dataTransfer;
    if (!dt) return;

    const paths: string[] = [];

    // 1. text/uri-list（VS Code 资源管理器 + Shift、部分系统文件拖拽）
    try {
      const uriList = dt.getData("text/uri-list");
      if (uriList) paths.push(...parseUriList(uriList));
    } catch {
      // 某些环境 getData 会抛异常，忽略
    }

    // 2. text/plain（可能是纯路径/文件列表）
    if (paths.length === 0) {
      try {
        const plain = dt.getData("text/plain");
        if (plain) paths.push(...parsePlainPaths(plain));
      } catch {
        // ignore
      }
    }

    // 3. dataTransfer.files（Windows 文件管理器等）
    // 优先尝试 webUtils 解析路径；拿不到路径的文件把内容发给主进程写临时文件
    if (paths.length === 0 && dt.files && dt.files.length > 0) {
      const withoutPath: File[] = [];
      for (const file of Array.from(dt.files)) {
        const p = getFilePathFromFile(file);
        if (p) paths.push(p);
        else withoutPath.push(file);
      }
      if (withoutPath.length > 0) {
        const contentPaths = await attachFilesFromContent(withoutPath);
        paths.push(...contentPaths);
      }
    }

    const unique = [...new Set(paths.filter(Boolean))];
    if (unique.length > 0) {
      await attachFiles(unique);
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

  /** 解析 text/plain 为文件绝对路径列表（支持 file:// 前缀或裸路径） */
  function parsePlainPaths(text: string): string[] {
    return text
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#"))
      .map((line) => {
        if (!line.startsWith("file://")) return line;
        const decoded = decodeURIComponent(line.slice(7));
        if (decoded.startsWith("/") && /^\/[A-Za-z]:/.test(decoded)) {
          return decoded.slice(1);
        }
        return decoded;
      })
      .filter(Boolean);
  }

  /** 从拖入的 File 对象获取绝对路径（尽力而为，webview 隔离下可能拿不到） */
  function getFilePathFromFile(file: File): string | undefined {
    // VS Code 在某些渲染环境注入的 webUtils（有则用）
    try {
      const w = (globalThis as { vscode?: { webUtils?: { getPathForFile(f: File): string } } }).vscode?.webUtils;
      if (w && typeof w.getPathForFile === "function") {
        const p = w.getPathForFile(file);
        if (p) return p;
      }
    } catch {
      // ignore
    }
    // 回退：旧 Electron 非标准 File.path 属性
    const legacy = (file as File & { path?: string }).path;
    return typeof legacy === "string" && legacy ? legacy : undefined;
  }

  /** 单文件内容搬运上限（避免超大文件阻塞） */
  const DND_MAX_BYTES = 100 * 1024 * 1024;

  /** 把拖入但无路径的文件内容发给主进程写临时文件，返回绝对路径列表 */
  async function attachFilesFromContent(files: File[]): Promise<string[]> {
    const items: { name: string; mime: string; data: Uint8Array }[] = [];
    for (const file of files) {
      if (file.size > DND_MAX_BYTES) continue;
      try {
        const buf = await file.arrayBuffer();
        items.push({ name: file.name, mime: file.type, data: new Uint8Array(buf) });
      } catch {
        // 读取失败跳过
      }
    }
    if (items.length === 0) return [];
    try {
      const res = await api.request<{ filePaths: string[] }>("attachFileContents", { files: items });
      return res.filePaths ?? [];
    } catch {
      return [];
    }
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
  {:else if appState.currentTab === "approvals"}
    <ApprovalPage />
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
    from {
      opacity: 0;
    }
    to {
      opacity: 1;
    }
  }
</style>
