// ─── HTML 转义 ───────────────────────────────────────────

export function escapeHtml(text: string): string {
  const div = document.createElement("div");
  div.appendChild(document.createTextNode(text));
  return div.innerHTML;
}

// ─── 路径格式化 ──────────────────────────────────────────

let _workspaceRoot = "";

export function setWorkspaceRoot(root: string): void {
  _workspaceRoot = root;
}

export function formatDisplayPath(filePath: string): string {
  if (!filePath) return "";
  const normalized = normalizePath(filePath);
  if (_workspaceRoot && normalized.startsWith(_workspaceRoot)) {
    const relative = normalized.slice(_workspaceRoot.length).replace(/^[/\\]/, "");
    return relative || normalized;
  }
  return normalized;
}

export function normalizePath(value: string): string {
  if (!value) return value;
  return value.replace(/\\/g, "/");
}

// ─── 日期/时间格式化 ─────────────────────────────────────

export function formatSessionDate(dateString: string): string {
  const date = new Date(dateString);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const startOfWeek = new Date(today);
  startOfWeek.setDate(today.getDate() - today.getDay());

  if (isSameDay(date, today)) return "今天";
  if (isSameDay(date, yesterday)) return "昨天";
  if (date >= startOfWeek) return "本周";
  return "更早";
}

export function formatSessionTime(dateString: string): string {
  const date = new Date(dateString);
  const today = new Date();
  const diffTime = today.getTime() - date.getTime();
  const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));

  if (diffDays === 0) {
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }
  return `${date.getMonth() + 1}/${date.getDate()}`;
}

export function formatElapsedTime(startTimeIso: string): string {
  const elapsedMs = Date.now() - new Date(startTimeIso).getTime();
  const totalSec = Math.floor(elapsedMs / 1000);
  const minutes = Math.floor(totalSec / 60);
  const seconds = totalSec % 60;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}
