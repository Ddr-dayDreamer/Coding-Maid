import assert from "node:assert/strict";
import { test } from "node:test";
import { SessionCompactor } from "../session/compactor";
import type { CompactionRecord, SessionMessage } from "../session/types";

function msg(
  id: string,
  role: SessionMessage["role"],
  content: string,
  extra: Partial<SessionMessage> = {}
): SessionMessage {
  return {
    id,
    sessionId: "s",
    role,
    content,
    contentParams: null,
    messageParams: null,
    visible: true,
    createTime: "2026-01-01T00:00:00.000Z",
    updateTime: "2026-01-01T00:00:00.000Z",
    ...extra,
  };
}

function record(upToMessageId: string, summaryMessageId: string): CompactionRecord {
  return {
    upToMessageId,
    summaryMessageId,
    summary: "summary",
    createdAt: "2026-01-01T00:00:00.000Z",
    messagesBefore: 4,
    tokensBefore: 1000,
    tokensAfter: 100,
    model: "test",
  };
}

test("applyCompaction returns all messages when no record", () => {
  const compactor = new SessionCompactor();
  const messages = [msg("1", "user", "a"), msg("2", "assistant", "b")];
  assert.deepEqual(compactor.applyCompaction(messages, null), messages);
});

test("applyCompaction keeps summary plus messages after boundary", () => {
  const compactor = new SessionCompactor();
  const messages = [
    msg("1", "user", "a"),
    msg("2", "assistant", "b"),
    msg("3", "system", "summary", { meta: { isSummary: true } }),
    msg("4", "user", "c"),
  ];
  const result = compactor.applyCompaction(messages, record("2", "3"));
  assert.deepEqual(
    result.map((m) => m.id),
    ["3", "4"]
  );
});

test("applyCompaction degrades gracefully when boundary is gone", () => {
  const compactor = new SessionCompactor();
  const messages = [msg("1", "user", "a"), msg("2", "assistant", "b")];
  const result = compactor.applyCompaction(messages, record("missing", "also-missing"));
  assert.deepEqual(result.map((m) => m.id), ["1", "2"]);
});

test("applyCompaction drops summary when it is missing", () => {
  const compactor = new SessionCompactor();
  const messages = [msg("1", "user", "a"), msg("2", "assistant", "b"), msg("3", "user", "c")];
  const result = compactor.applyCompaction(messages, record("2", "gone"));
  assert.deepEqual(result.map((m) => m.id), ["3"]);
});

test("renderForSummary skips system messages and renders tool calls", () => {
  const compactor = new SessionCompactor();
  const messages = [
    msg("1", "system", "preset"),
    msg("2", "user", "do it"),
    msg("3", "assistant", "", {
      messageParams: { tool_calls: [{ id: "c1", function: { name: "bash", arguments: '{"command":"ls"}' } }] },
    }),
    msg("4", "tool", "output"),
  ];
  const text = compactor.renderForSummary(messages);
  assert.ok(!text.includes("preset"));
  assert.ok(text.includes("## User\ndo it"));
  assert.ok(text.includes("→ bash("));
  assert.ok(text.includes("## Tool result\noutput"));
});

test("renderForSummary renders images as placeholder", () => {
  const compactor = new SessionCompactor();
  const messages = [
    msg("1", "user", "look", { contentParams: [{ type: "image_url", image_url: { url: "data:x" } }] }),
  ];
  const text = compactor.renderForSummary(messages);
  assert.ok(text.includes("[图片]"));
});

test("renderForSummary truncates long tool results", () => {
  const compactor = new SessionCompactor();
  const messages = [msg("1", "tool", "x".repeat(5000))];
  const text = compactor.renderForSummary(messages);
  assert.ok(text.length < 5000);
  assert.ok(text.includes("已截断"));
});

test("estimateTokens counts CJK heavier than ASCII", () => {
  const compactor = new SessionCompactor();
  assert.ok(compactor.estimateTokens("中文中文") > compactor.estimateTokens("abcd"));
});
