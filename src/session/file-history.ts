/**
 * 文件历史/Checkpoint 管理
 *
 * 通过 GitFileHistory 实现 AI 文件变更的可撤回机制。
 * 从 session.ts 拆分。
 */

import * as path from "path";
import { GitFileHistory } from "../utils/file-history";
import type { SessionMessage, UndoTarget } from "./types";
import type { SessionStorage } from "./storage";

// ─── SessionFileHistory ──────────────────────────────────

export class SessionFileHistory {
  private readonly projectRoot: string;
  private readonly storage: SessionStorage;

  constructor(projectRoot: string, storage: SessionStorage) {
    this.projectRoot = projectRoot;
    this.storage = storage;
  }

  // ─── GitFileHistory 实例 ───────────────────────────────

  private getFileHistory(): GitFileHistory {
    return new GitFileHistory(this.projectRoot, this.getFileHistoryGitDir());
  }

  private getFileHistoryGitDir(): string {
    const projectDir = this.storage.getProjectDir();
    return path.join(projectDir, "file-history", ".git");
  }

  // ─── 会话初始化 ────────────────────────────────────────

  ensureSession(sessionId: string): string | undefined {
    return this.getFileHistory().ensureSession(sessionId);
  }

  getCurrentCheckpointHash(sessionId: string): string | undefined {
    return this.getFileHistory().getCurrentCheckpointHash(sessionId);
  }

  // ─── Checkpoint 操作 ───────────────────────────────────

  prepareMutation(sessionId: string, filePath: string): void {
    const fileHistory = this.getFileHistory();
    const branchHash = fileHistory.ensureSession(sessionId);
    if (!branchHash) {
      return;
    }

    // 读取最新用户消息当前的 checkpointHash，用于后续比较
    const currentMsgHash = this.getLatestUserMessageCheckpoint(sessionId);

    // 仅当消息还没有 checkpointHash 时才初始化（首次 prepareMutation）
    if (!currentMsgHash) {
      this.updateLatestUserCheckpointHash(sessionId, undefined, branchHash);
    }

    const nextHash = fileHistory.recordCheckpoint(sessionId, [filePath], "Pre-mutation checkpoint");
    if (nextHash && nextHash !== branchHash) {
      // 使用消息自身的 hash 作为 previousHash，避免因 recordMutation 导致分支前进后
      // 消息 hash 与分支 hash 不一致而跳过更新（多发于同一 LLM 响应中的多工具调用场景）
      this.updateLatestUserCheckpointHash(sessionId, currentMsgHash || branchHash, nextHash);
    }
  }

  /**
   * 获取最新一条用户可见消息的 checkpointHash。
   * 用于 prepareMutation 中判断消息当前 hash 状态。
   */
  private getLatestUserMessageCheckpoint(sessionId: string): string | undefined {
    const messages = this.storage.listSessionMessages(sessionId);
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const message = messages[index];
      if (message && this.isUndoTargetMessage(message)) {
        return message.checkpointHash;
      }
    }
    return undefined;
  }

  recordMutation(sessionId: string, filePath: string): void {
    const fileHistory = this.getFileHistory();
    fileHistory.ensureSession(sessionId);
    fileHistory.recordCheckpoint(sessionId, [filePath], "File mutation checkpoint");
  }

  canRestore(sessionId: string, checkpointHash: string): boolean {
    return this.getFileHistory().canRestore(sessionId, checkpointHash);
  }

  restore(sessionId: string, checkpointHash: string): void {
    this.getFileHistory().restore(sessionId, checkpointHash);
  }

  // ─── 消息 Checkpoint 关联 ──────────────────────────────

  private updateLatestUserCheckpointHash(sessionId: string, previousHash: string | undefined, nextHash: string): void {
    const messages = this.storage.listSessionMessages(sessionId);
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const message = messages[index];
      if (!message || !this.isUndoTargetMessage(message)) {
        continue;
      }
      if (message.checkpointHash && message.checkpointHash !== previousHash) {
        return;
      }
      messages[index] = {
        ...message,
        checkpointHash: nextHash,
        updateTime: new Date().toISOString(),
      };
      this.storage.saveSessionMessages(sessionId, messages);
      return;
    }
  }

  private isUndoTargetMessage(message: SessionMessage): boolean {
    return message.role === "user" && message.visible;
  }

  // ─── 删除会话（清理 git 分支）────────────────────────

  /**
   * 删除会话对应的 file-history git 分支。
   * 在会话索引条目和消息文件删除后调用，避免 git 数据残留。
   */
  deleteSession(sessionId: string): void {
    this.getFileHistory().deleteSessionBranch(sessionId);
  }

  // ─── Undo 功能 ─────────────────────────────────────────

  listUndoTargets(sessionId: string): UndoTarget[] {
    return this.storage
      .listSessionMessages(sessionId)
      .map((message, index) => ({ message, index }))
      .filter(({ message }) => this.isUndoTargetMessage(message))
      .map(({ message, index }) => ({
        message,
        index,
        canRestoreCode: Boolean(message.checkpointHash && this.canRestore(sessionId, message.checkpointHash)),
      }));
  }

  /**
   * 统一回退到指定消息：先恢复文件 checkpoint，再截断对话。
   * 文件恢复失败不阻塞对话回退。
   */
  rollbackToMessage(
    sessionId: string,
    messageId: string
  ): { keptMessages: SessionMessage[]; checkpointHash?: string; restoreError?: string } {
    const messages = this.storage.listSessionMessages(sessionId);
    let targetIndex = messages.findIndex((message) => message.id === messageId);

    // 如果精确 ID 找不到（前端临时 ID 场景），降级到最后一个用户消息
    if (targetIndex === -1) {
      for (let index = messages.length - 1; index >= 0; index -= 1) {
        if (messages[index]?.role === "user") {
          targetIndex = index;
          break;
        }
      }
    }

    if (targetIndex === -1) {
      throw new Error("Selected message was not found in this session.");
    }

    const targetMessage = messages[targetIndex];
    const checkpointHash = targetMessage?.checkpointHash;
    let restoreError: string | undefined;

    // 先恢复文件（需要在截断对话之前读取 checkpointHash）
    if (checkpointHash) {
      try {
        this.restore(sessionId, checkpointHash);
      } catch (err) {
        restoreError = err instanceof Error ? err.message : String(err);
        console.warn("[CodingMaid] 文件恢复失败，仅回退对话", {
          sessionId,
          messageId,
          checkpointHash,
          error: restoreError,
        });
      }
    } else {
      restoreError = "消息没有关联的 checkpointHash，无法恢复文件";
      console.warn("[CodingMaid] 无 checkpointHash，跳过文件恢复", { sessionId, messageId });
    }

    // 再截断对话消息
    const keptMessages = messages.slice(0, targetIndex);
    this.storage.saveSessionMessages(sessionId, keptMessages);

    return { keptMessages, checkpointHash, restoreError };
  }
}
