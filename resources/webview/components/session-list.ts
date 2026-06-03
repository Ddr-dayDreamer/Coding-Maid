import { $, state, vscode } from "../state";
import type { SessionSummary } from "../types";
import { formatSessionDate, formatSessionTime } from "../utils/formatting";

// ─── 初始化 ──────────────────────────────────────────────

export function initSessionList(): void {
  $.sessionSelector.addEventListener("click", (e) => {
    e.stopPropagation();
    toggleDropdown();
  });

  $.newSessionBtn.addEventListener("click", () => {
    closeDropdown();
    vscode.postMessage({ type: "createNewSession" });
    $.promptInput.value = "";
    // 清空输入历史
    // inputHistory 在 state 中
    updateSendIconState?.();
  });

  // 点击外部关闭
  document.addEventListener("click", () => closeDropdown());

  // Escape 关闭
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && $.sessionDropdown.classList.contains("show")) {
      closeDropdown();
    }
  });
}

// 避免循环引用 — 从 composer 导入
declare function updateSendIconState(): void;

// ─── 下拉框 ──────────────────────────────────────────────

function toggleDropdown(): void {
  const isOpen = $.sessionDropdown.classList.toggle("show");
  $.sessionSelector.classList.toggle("open", isOpen);
}

function closeDropdown(): void {
  $.sessionDropdown.classList.remove("show");
  $.sessionSelector.classList.remove("open");
}

// ─── 渲染会话列表 ────────────────────────────────────────

export function updateSessionDropdown(sessions: SessionSummary[]): void {
  state.allSessions = sessions;

  const searchHtml = `<div class="session-search"><input type="text" id="sessionSearch" placeholder="搜索会话..." /></div>`;
  const listHtml = renderFilteredSessions(sessions, "");
  $.sessionDropdown.innerHTML = searchHtml + listHtml;

  const searchInput = document.getElementById("sessionSearch") as HTMLInputElement;
  if (searchInput) {
    searchInput.addEventListener("input", () => {
      const query = searchInput.value;
      const listEl = $.sessionDropdown.querySelector(".session-list-wrap");
      if (listEl) {
        listEl.innerHTML = renderFilteredSessions(sessions, query);
        bindSessionClickHandlers();
      }
    });

    // 自动聚焦
    $.sessionSelector.addEventListener("click", () => {
      setTimeout(() => searchInput?.focus(), 50);
    });
  }

  bindSessionClickHandlers();
}

function renderFilteredSessions(sessions: SessionSummary[], query: string): string {
  const filtered = sessions.filter((s) => {
    if (!query) return true;
    const q = query.toLowerCase();
    return s.summary.toLowerCase().includes(q);
  });

  // 按日期分组
  const groups: Record<string, SessionSummary[]> = {};
  for (const s of filtered) {
    const label = formatSessionDate(s.createTime);
    if (!groups[label]) groups[label] = [];
    groups[label].push(s);
  }

  const order = ["今天", "昨天", "本周", "更早"];
  const escaped = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  let html = '<div class="session-list-wrap">';
  for (const label of order) {
    const items = groups[label];
    if (!items) continue;
    html += `<div class="session-group-label">${label}</div>`;
    for (const s of items) {
      const isActive = s.id === state.currentSessionId;
      const highlighted = query
        ? escaped(s.summary).replace(new RegExp(escapeRegExp(query), "gi"), (m) => `<mark>${m}</mark>`)
        : escaped(s.summary);
      html += `<div class="session-item ${isActive ? "active" : ""}" data-session-id="${s.id}">
        <div class="session-item-summary">${highlighted || "空对话"}</div>
        <div class="session-item-right">
          <span class="session-item-time">${formatSessionTime(s.createTime)}</span>
          <button class="session-item-delete" title="删除会话" data-session-id="${s.id}">
            <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
              <path d="M6.5 1.5h3a.5.5 0 0 1 .5.5v1H6V2a.5.5 0 0 1 .5-.5zM5 2v1H2.5a.5.5 0 0 0 0 1h.55l.66 8.25a1.5 1.5 0 0 0 1.5 1.35h5.58a1.5 1.5 0 0 0 1.5-1.35l.66-8.25h.55a.5.5 0 0 0 0-1H11V2a1.5 1.5 0 0 0-1.5-1.5h-3A1.5 1.5 0 0 0 5 2zm.72 10.5a.5.5 0 0 1-.5-.44L4.62 5h6.76l-.6 7.06a.5.5 0 0 1-.5.44H5.72z"/>
            </svg>
          </button>
        </div>
      </div>`;
    }
  }
  html += "</div>";
  return html;
}

function bindSessionClickHandlers(): void {
  $.sessionDropdown.querySelectorAll(".session-item").forEach((el) => {
    el.addEventListener("click", (e) => {
      // 如果点击的是删除按钮或其子元素，不触发选中
      const target = e.target as HTMLElement;
      if (target.closest(".session-item-delete")) return;

      e.stopPropagation();
      const sessionId = (el as HTMLElement).dataset.sessionId;
      if (sessionId) {
        closeDropdown();
        vscode.postMessage({ type: "selectSession", sessionId });
      }
    });
  });

  // 删除按钮事件 — 内联确认
  $.sessionDropdown.querySelectorAll(".session-item-delete").forEach((btn) => {
    let resetTimer: ReturnType<typeof setTimeout> | null = null;

    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const el = btn as HTMLElement;
      const sessionId = el.dataset.sessionId;
      if (!sessionId) return;

      // 已处于确认状态 → 真的删除
      if (el.dataset.confirming === "true") {
        if (resetTimer) clearTimeout(resetTimer);
        el.dataset.confirming = "false";
        el.classList.remove("confirming");
        restoreDeleteIcon(el);
        // 关闭下拉、发送删除请求
        closeDropdown();
        vscode.postMessage({ type: "deleteSession", sessionId });
        return;
      }

      // 第一次点击 → 进入确认状态
      el.dataset.confirming = "true";
      el.classList.add("confirming");
      el.innerHTML = "确认删除？";

      // 3 秒无操作自动复原
      if (resetTimer) clearTimeout(resetTimer);
      resetTimer = setTimeout(() => {
        el.dataset.confirming = "false";
        el.classList.remove("confirming");
        restoreDeleteIcon(el);
        resetTimer = null;
      }, 3000);
    });
  });
}

/** 恢复删除按钮的垃圾桶图标 */
function restoreDeleteIcon(el: HTMLElement): void {
  el.innerHTML = `<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
    <path d="M6.5 1.5h3a.5.5 0 0 1 .5.5v1H6V2a.5.5 0 0 1 .5-.5zM5 2v1H2.5a.5.5 0 0 0 0 1h.55l.66 8.25a1.5 1.5 0 0 0 1.5 1.35h5.58a1.5 1.5 0 0 0 1.5-1.35l.66-8.25h.55a.5.5 0 0 0 0-1H11V2a1.5 1.5 0 0 0-1.5-1.5h-3A1.5 1.5 0 0 0 5 2zm.72 10.5a.5.5 0 0 1-.5-.44L4.62 5h6.76l-.6 7.06a.5.5 0 0 1-.5.44H5.72z"/>
  </svg>`;
}

function escapeRegExp(string: string): string {
  return string.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ─── 更新标题 ────────────────────────────────────────────

export function updateSessionTitle(summary: string): void {
  $.sessionSelectorTitleText.textContent = summary?.slice(0, 100) || "New Chat";
}
