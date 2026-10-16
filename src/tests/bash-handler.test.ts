import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";
import { handleBashTool } from "../tools/handler/bash-handler";
import type { ToolExecutionContext } from "../tools/types";

function createContext(sessionId: string, projectRoot: string): ToolExecutionContext {
  return {
    sessionId,
    projectRoot,
    toolCall: {
      id: `${sessionId}-call`,
      type: "function",
      function: { name: "bash", arguments: "{}" },
    },
  };
}

function metadataOf(result: { metadata?: Record<string, unknown> }): { cwd: string | null; startCwd: string } {
  return result.metadata as { cwd: string | null; startCwd: string };
}

function assertUsableDirectory(target: string | null, label: string): void {
  assert.ok(target, `${label} should not be empty`);
  assert.ok(fs.statSync(target).isDirectory(), `${label} should be an existing directory: ${target}`);
}

test("carries the working directory into the next call", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "codingmaid-cwd-"));
  const context = createContext("bash-cwd-carry", process.cwd());
  try {
    const first = await handleBashTool({ command: `cd '${dir.replace(/\\/g, "/")}' && pwd` }, context);
    assert.equal(first.ok, true);
    assertUsableDirectory(metadataOf(first).cwd, "first call cwd");

    const second = await handleBashTool({ command: "pwd" }, context);
    assert.equal(second.ok, true);
    assert.equal(path.basename(metadataOf(second).startCwd), path.basename(dir));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("keeps the session usable after cd into a shell-only path", async () => {
  const context = createContext("bash-cwd-shell-path", process.cwd());
  const first = await handleBashTool({ command: "cd /tmp && pwd" }, context);
  assert.equal(first.ok, true);
  assert.equal(metadataOf(first).cwd === null, false);
  assertUsableDirectory(metadataOf(first).cwd, "first call cwd");

  // 修复前：`/tmp` 会被记录成 `\tmp`，下一次调用在 spawn 阶段就以 ENOENT 失败
  const second = await handleBashTool({ command: "pwd" }, context);
  assert.equal(second.ok, true);
  assertUsableDirectory(metadataOf(second).startCwd, "second call start cwd");
  assertUsableDirectory(metadataOf(second).cwd, "second call cwd");
});

test("reports the fallback directory when the shell directory has no native counterpart", async () => {
  const context = createContext("bash-cwd-relative", process.cwd());
  const result = await handleBashTool({ command: "cd / && pwd" }, context);
  assert.equal(result.ok, true);
  const metadata = metadataOf(result);
  if (process.platform === "win32") {
    // Git Bash 的 `/` 是 MSYS 根目录，其 `pwd -W` 结果必须能被 Windows 直接使用
    assert.match(metadata.cwd ?? "", /^[A-Za-z]:\\/);
  }
  assertUsableDirectory(metadata.cwd, "cwd");
});
