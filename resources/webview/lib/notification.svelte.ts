/**
 * 全局通知/报错系统
 *
 * 可复用的前端通知机制，支持多类型通知和自动关闭。
 * 使用 Svelte 5 $state rune，需 .svelte.ts 后缀。
 *
 * 用法：
 *   import { notify } from "../lib/notification.svelte";
 *   notify.success("保存成功");
 *   notify.error("操作失败", 0);          // 不自动关闭
 *   notify.warning("即将过期", 6000);     // 6 秒后关闭
 *   notify.info("加载完成");
 *   notify.dismiss(id);                   // 手动关闭
 */

export type NotificationType = "success" | "error" | "warning" | "info";

export interface NotificationItem {
  id: string;
  type: NotificationType;
  text: string;
  /** 自动关闭延时（ms），0 表示不自动关闭 */
  duration: number;
  createdAt: number;
}

// ─── 全局通知列表 ───────────────────────────────────────

const items = $state<NotificationItem[]>([]);

// ─── 默认延时 ───────────────────────────────────────────

const DEFAULT_DURATION = 4000;

// ─── 工具 ───────────────────────────────────────────────

let counter = 0;

function add(type: NotificationType, text: string, duration = DEFAULT_DURATION): string {
  const id = `notif-${++counter}-${Date.now()}`;
  items.push({ id, type, text, duration, createdAt: Date.now() });

  if (duration > 0) {
    setTimeout(() => dismiss(id), duration);
  }

  return id;
}

function dismiss(id: string): void {
  const idx = items.findIndex((n) => n.id === id);
  if (idx >= 0) {
    items.splice(idx, 1);
  }
}

function clearAll(): void {
  items.length = 0;
}

// ─── 导出 ───────────────────────────────────────────────

export const notify = {
  /** 获取响应式通知列表（供组件绑定） */
  get items(): NotificationItem[] {
    return items;
  },

  success(text: string, duration?: number): string {
    return add("success", text, duration);
  },

  error(text: string, duration?: number): string {
    return add("error", text, duration);
  },

  warning(text: string, duration?: number): string {
    return add("warning", text, duration);
  },

  info(text: string, duration?: number): string {
    return add("info", text, duration);
  },

  dismiss,
  clearAll,
};
