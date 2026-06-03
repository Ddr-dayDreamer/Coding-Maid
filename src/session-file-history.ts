/**
 * 文件历史/Checkpoint 管理
 *
 * 通过 GitFileHistory 实现 AI 文件变更的可撤回机制。
 * 从 session.ts 拆分。
 */

import * as path from "path";
import { GitFileHistory } from "./common/file-history";
import type { SessionMessage, UndoTarget } from "./session-types";
import type { SessionStorage } from "./session-storage";

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
    const previousHash = fileHistory.ensureSession(sessionId);
    if (!previousHash) {
      return;
    }
    this.updateLatestUserCheckpointHash(sessionId, undefined, previousHash);
    const nextHash = fileHistory.recordCheckpoint(sessionId, [filePath], "Pre-mutation checkpoint");
    if (nextHash && nextHash !== previousHash) {
      this.updateLatestUserCheckpointHash(sessionId, previousHash, nextHash);
    }
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

  // ─── 删除会话（清理 git 分支） ────────────────────────

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

  restoreConversation(sessionId: string, messageId: string): SessionMessage[] {
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

    const keptMessages = messages.slice(0, targetIndex);
    this.storage.saveSessionMessages(sessionId, keptMessages);
    return keptMessages;
  }

  restoreCode(sessionId: string, messageId: string): void {
    const message = this.storage.listSessionMessages(sessionId).find((item) => item.id === messageId);
    if (!message) {
      throw new Error("Selected message was not found in this session.");
    }
    if (!message.checkpointHash) {
      throw new Error("Selected message has no code checkpoint.");
    }
    this.restore(sessionId, message.checkpointHash);
  }
}
