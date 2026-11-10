/**
 * 上下文压缩器
 *
 * 纯逻辑模块，无 IO 依赖，便于单测。
 *
 * 职责：
 * 1. 把会话消息渲染成供 LLM 生成摘要的纯文本
 * 2. 按压缩记录过滤出真正发送给 LLM 的消息
 * 3. 估算 token 用量
 */

import type { CompactionRecord, SessionMessage } from "./types";

// ─── 常量 ────────────────────────────────────────────────

/** 单条工具结果在摘要输入中的最大字符数 */
const TOOL_RESULT_MAX_CHARS = 2000;
/** 摘要输入的总字符上限（约 200k tokens） */
const MAX_SUMMARY_INPUT_CHARS = 400_000;
/** 超限时工具结果的压缩后长度 */
const TOOL_RESULT_SHRUNK_CHARS = 500;
/** 始终保留的最近轮次（user 消息数） */
const KEEP_RECENT_TURNS = 2;

// ─── SessionCompactor ────────────────────────────────────

export class SessionCompactor {
  /**
   * 按压缩记录过滤消息。
   *
   * 返回：摘要消息 + 边界之后的消息。
   * 边界失效（消息被回退删除）时安全降级为不压缩。
   */
  applyCompaction(messages: SessionMessage[], record: CompactionRecord | null | undefined): SessionMessage[] {
    if (!record) {
      return messages;
    }

    const boundary = messages.findIndex((message) => message.id === record.upToMessageId);
    if (boundary === -1) {
      return messages;
    }

    const summary = messages.find((message) => message.id === record.summaryMessageId);
    const tail = messages.slice(boundary + 1).filter((message) => message.id !== record.summaryMessageId);
    return summary ? [summary, ...tail] : tail;
  }

  /**
   * 把消息渲染成摘要输入文本。
   *
   * 规则：
   * - system 消息跳过（预设不落盘，落盘的 system 是运行时提示）
   * - tool 结果截断到 TOOL_RESULT_MAX_CHARS
   * - 总长度超限时先压缩工具结果，再从最旧轮次开始丢弃
   */
  renderForSummary(messages: SessionMessage[]): string {
    const blocks = messages
      .filter((message) => this.shouldRender(message))
      .map((message) => this.renderMessage(message));

    let text = blocks.join("\n\n");
    if (text.length <= MAX_SUMMARY_INPUT_CHARS) {
      return text;
    }

    // 第一轮：压缩工具结果
    const shrunk = messages
      .filter((message) => this.shouldRender(message))
      .map((message) => this.renderMessage(message, TOOL_RESULT_SHRUNK_CHARS));
    text = shrunk.join("\n\n");
    if (text.length <= MAX_SUMMARY_INPUT_CHARS) {
      return text;
    }

    // 第二轮：从最旧轮次开始丢弃，保留首条 user 消息与最近若干轮
    return this.dropOldestTurns(messages, shrunk);
  }

  /** 估算 token：中文 0.6 / 其他 0.3，与 LlmStreamManager 保持一致 */
  estimateTokens(text: string): number {
    let tokens = 0;
    for (const char of text) {
      tokens += /[\u3400-\u9fff\uf900-\ufaff]/u.test(char) ? 0.6 : 0.3;
    }
    return Math.round(tokens);
  }

  /** 估算一组消息的 token 总量 */
  estimateMessagesTokens(messages: SessionMessage[]): number {
    return this.estimateTokens(this.renderForSummary(messages));
  }

  // ═══════════════════════════════════════════════════════
  //  内部工具
  // ═══════════════════════════════════════════════════════

  private renderMessage(message: SessionMessage, toolLimit = TOOL_RESULT_MAX_CHARS): string {
    switch (message.role) {
      case "user":
        return `## User\n${this.renderUserContent(message)}`;
      case "assistant":
        return `## Assistant\n${this.renderAssistantContent(message)}`;
      case "tool":
        return `## Tool result\n${this.truncate(message.content ?? "", toolLimit)}`;
      case "system":
        // 只有上一次压缩生成的摘要需要参与二次压缩，其余 system 是运行时提示
        return `## 已有摘要\n${message.content ?? ""}`;
      default:
        return "";
    }
  }

  /** 是否参与摘要渲染：跳过普通 system 消息，保留摘要消息 */
  private shouldRender(message: SessionMessage): boolean {
    if (message.role !== "system") {
      return true;
    }
    return message.meta?.isSummary === true;
  }

  private renderUserContent(message: SessionMessage): string {
    const parts: string[] = [];
    const text = (message.content ?? "").trim();
    if (text) {
      parts.push(text);
    }

    const contentParams = message.contentParams;
    if (Array.isArray(contentParams)) {
      for (const raw of contentParams) {
        const part = raw as { type?: unknown; text?: unknown };
        if (part?.type === "image_url") {
          parts.push("[图片]");
        } else if (part?.type === "text" && typeof part.text === "string") {
          parts.push(this.truncate(part.text, TOOL_RESULT_MAX_CHARS));
        }
      }
    }

    return parts.join("\n") || "(空消息)";
  }

  private renderAssistantContent(message: SessionMessage): string {
    const parts: string[] = [];
    const text = (message.content ?? "").trim();
    if (text) {
      parts.push(text);
    }

    const params = message.messageParams as { tool_calls?: unknown[] } | null | undefined;
    const toolCalls = Array.isArray(params?.tool_calls) ? params.tool_calls : [];
    for (const raw of toolCalls) {
      const call = raw as { function?: { name?: unknown; arguments?: unknown } };
      const name = typeof call?.function?.name === "string" ? call.function.name : "tool";
      const args = typeof call?.function?.arguments === "string" ? call.function.arguments : "";
      parts.push(`→ ${name}(${this.truncate(args, 300)})`);
    }

    return parts.join("\n") || "(无内容)";
  }

  private dropOldestTurns(messages: SessionMessage[], renderedBlocks: string[]): string {
    const kept: string[] = [];
    const userIndexes: number[] = [];
    const filtered = messages.filter((message) => this.shouldRender(message));

    filtered.forEach((message, index) => {
      if (message.role === "user") {
        userIndexes.push(index);
      }
    });

    // 保留首条 user 消息 + 最近 KEEP_RECENT_TURNS 轮
    const keepFrom =
      userIndexes.length > KEEP_RECENT_TURNS ? userIndexes[userIndexes.length - KEEP_RECENT_TURNS] : 0;
    const firstUserIndex = userIndexes[0] ?? 0;

    for (let index = 0; index < filtered.length; index += 1) {
      const isFirstUser = index === firstUserIndex;
      const isRecent = index >= keepFrom;
      if (!isFirstUser && !isRecent) {
        continue;
      }
      const block = renderedBlocks[index];
      if (block) {
        kept.push(block);
      }
    }

    const omitted = filtered.length - kept.length;
    const header = omitted > 0 ? `（已省略 ${omitted} 条较早的消息）\n\n` : "";
    return header + kept.join("\n\n");
  }

  private truncate(text: string, limit: number): string {
    if (text.length <= limit) {
      return text;
    }
    return `${text.slice(0, limit)}\n…（已截断 ${text.length - limit} 字符）`;
  }
}
