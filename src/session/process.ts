/**
 * 会话进程管理
 *
 * 追踪子进程、处理超时控制、中断时终结进程。
 * 从 session.ts 拆分。
 */

import type { ProcessTimeoutControl, ProcessTimeoutInfo } from "../tools/types";
import type { SessionProcessEntry, BashTimeoutAdjustment } from "./types";

// ─── SessionProcessManager ───────────────────────────────

export class SessionProcessManager {
  private readonly processTimeoutControls = new Map<string, ProcessTimeoutControl>();

  // ─── 进程操作 ──────────────────────────────────────────

  addProcess(
    processes: Map<string, SessionProcessEntry> | null,
    processId: string | number,
    command: string
  ): Map<string, SessionProcessEntry> {
    const now = new Date().toISOString();
    const next = new Map(processes ?? []);
    next.set(String(processId), { startTime: now, command });
    return next;
  }

  removeProcess(
    processes: Map<string, SessionProcessEntry> | null,
    processId: string | number
  ): Map<string, SessionProcessEntry> | null {
    const next = new Map(processes ?? []);
    next.delete(String(processId));
    this.processTimeoutControls.delete(this.getControlKey("", processId));
    return next.size > 0 ? next : null;
  }

  // ─── 超时控制 ──────────────────────────────────────────

  setControl(sessionId: string, processId: string | number, control: ProcessTimeoutControl | null): void {
    const key = this.getControlKey(sessionId, processId);
    if (!control) {
      this.processTimeoutControls.delete(key);
      return;
    }
    this.processTimeoutControls.set(key, control);
  }

  getControl(sessionId: string, processId: string | number): ProcessTimeoutControl | undefined {
    return this.processTimeoutControls.get(this.getControlKey(sessionId, processId));
  }

  updateProcessTimeout(
    processes: Map<string, SessionProcessEntry> | null,
    sessionId: string,
    processId: string | number,
    info: ProcessTimeoutInfo
  ): Map<string, SessionProcessEntry> | null {
    const next = new Map(processes ?? []);
    const pid = String(processId);
    const processInfo = next.get(pid);
    if (!processInfo) {
      return processes;
    }
    next.set(pid, {
      ...processInfo,
      timeoutMs: info.timeoutMs,
      deadlineAt: new Date(info.deadlineAtMs).toISOString(),
      timedOut: info.timedOut,
    });
    return next;
  }

  adjustTimeout(
    sessionId: string,
    processId: string,
    deltaMs: number
  ): { control: ProcessTimeoutControl; info: ProcessTimeoutInfo } | null {
    const control = this.processTimeoutControls.get(this.getControlKey(sessionId, processId));
    if (!control) {
      return null;
    }

    const current = control.getInfo();
    const next = control.setTimeoutMs(current.timeoutMs + deltaMs);
    return { control, info: next };
  }

  buildAdjustment(processId: string, info: ProcessTimeoutInfo): BashTimeoutAdjustment {
    return {
      processId,
      timeoutMs: info.timeoutMs,
      deadlineAt: new Date(info.deadlineAtMs).toISOString(),
      timedOut: info.timedOut,
    };
  }

  // ─── 查询 ──────────────────────────────────────────────

  getActivePids(processes: Map<string, SessionProcessEntry> | null): number[] {
    if (!processes) {
      return [];
    }
    const ids: number[] = [];
    for (const pid of processes.keys()) {
      const parsed = Number(pid);
      if (Number.isInteger(parsed) && parsed > 0) {
        ids.push(parsed);
      }
    }
    return ids;
  }

  /** 返回当前会话中注册了超时控制的进程 ID 列表 */
  getControlledPids(sessionId: string, processes: Map<string, SessionProcessEntry> | null): string[] {
    if (!processes) {
      return [];
    }
    const result: string[] = [];
    for (const pid of processes.keys()) {
      if (this.processTimeoutControls.has(this.getControlKey(sessionId, pid))) {
        result.push(pid);
      }
    }
    return result;
  }

  clearSessionControls(sessionId: string): void {
    for (const [key] of this.processTimeoutControls) {
      if (key.startsWith(`${sessionId}:`)) {
        this.processTimeoutControls.delete(key);
      }
    }
  }

  // ─── 工具 ──────────────────────────────────────────────

  private getControlKey(sessionId: string, processId: string | number): string {
    return `${sessionId}:${String(processId)}`;
  }
}
