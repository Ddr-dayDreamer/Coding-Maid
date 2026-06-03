/**
 * 统一前后端通信层
 *
 * 职责：
 * 1. send() — 单向推送消息（大部分场景用这个）
 * 2. request() — 请求-响应模式（预设编辑器等交互场景）
 * 3. onMessage() — 注册后端消息处理器
 */

import type { BackendMessage } from "../types";

// ─── VS Code API ─────────────────────────────────────────

declare function acquireVsCodeApi(): {
  postMessage(msg: unknown): void;
  getState(): Record<string, unknown> | undefined;
  setState(state: Record<string, unknown> | undefined): void;
};

const vscode = acquireVsCodeApi();

// ─── 请求-响应 ───────────────────────────────────────────

interface PendingRequest {
  resolve: (data: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

const pendingRequests = new Map<string, PendingRequest>();

// ─── API 层 ──────────────────────────────────────────────

export const api = {
  /** 单向推送（不期待响应） */
  send(type: string, payload?: Record<string, unknown>): void {
    vscode.postMessage({ type, ...(payload ?? {}) });
  },

  /** 请求-响应（等待后端返回对应 requestId 的响应） */
  request<T = unknown>(type: string, payload?: Record<string, unknown>, timeoutMs = 10000): Promise<T> {
    return new Promise((resolve, reject) => {
      const requestId = crypto.randomUUID();
      const timer = setTimeout(() => {
        pendingRequests.delete(requestId);
        reject(new Error(`Request "${type}" timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      pendingRequests.set(requestId, { resolve, reject, timer });
      vscode.postMessage({ type, requestId, ...(payload ?? {}) });
    }) as Promise<T>;
  },

  /** 处理后端消息（由 main.ts 中 window.addEventListener("message") 调用） */
  handleMessage(event: MessageEvent): BackendMessage | null {
    const msg = event.data as Record<string, unknown>;

    // 如果是 requestId 响应，路由到对应的 Promise
    if (msg.requestId && typeof msg.requestId === "string") {
      const pending = pendingRequests.get(msg.requestId);
      if (pending) {
        clearTimeout(pending.timer);
        pendingRequests.delete(msg.requestId);
        if (msg.ok === true) {
          pending.resolve(msg.data);
        } else {
          pending.reject(new Error(String(msg.error ?? "Unknown error")));
        }
      }
      return null; // 已消费，不继续传播
    }

    return msg as unknown as BackendMessage;
  },

  /** 保存/恢复 VS Code webview 持久化状态 */
  getState<T>(): T | undefined {
    return vscode.getState() as T | undefined;
  },

  setState(state: Record<string, unknown>): void {
    vscode.setState(state);
  },
};
