import assert from "node:assert/strict";
import { test } from "node:test";
import { SessionMessageBuilder } from "../session/message-builder";
import { SessionStorage } from "../session/storage";

function createBuilder(): SessionMessageBuilder {
  const projectRoot = process.cwd();
  return new SessionMessageBuilder(projectRoot, new SessionStorage(projectRoot));
}

const toolFunction = { name: "bash", arguments: JSON.stringify({ command: "false" }) };

test("keeps failed bash results visible", () => {
  const builder = createBuilder();
  const content = JSON.stringify({ ok: false, name: "bash", error: "Command failed with exit code 1." });
  const message = builder.buildToolMessage("session", "call-1", content, toolFunction);
  assert.equal(message.visible, true);
});

test("keeps auto-rejected tool results visible", () => {
  const builder = createBuilder();
  const content = JSON.stringify({
    ok: false,
    name: "bash",
    error: "Blocked.",
    autoReject: true,
    autoRejectReason: "Blocked.",
  });
  const message = builder.buildToolMessage("session", "call-2", content, toolFunction);
  assert.equal(message.visible, true);
});

test("restores visibility for previously hidden tool messages", () => {
  const builder = createBuilder();
  const content = JSON.stringify({ ok: false, name: "bash", error: "Command failed with exit code 1." });
  const message = builder.buildToolMessage("session", "call-3", content, toolFunction);
  const normalized = builder.normalizeSessionMessage({ ...message, visible: false });
  assert.equal(normalized.visible, true);
});
