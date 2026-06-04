/**
 * memory — handler 实现
 *
 * 返回记忆目录路径，确保目录存在。
 */

import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import type { ToolExecutionContext, ToolExecutionResult } from "../types";

export async function handleMemory(
  args: Record<string, unknown>,
  context: ToolExecutionContext,
): Promise<ToolExecutionResult> {
  const scope = typeof args.scope === "string" ? args.scope.trim().toLowerCase() : "";
  if (scope !== "global" && scope !== "project") {
    return {
      ok: false,
      name: "memory",
      error: 'scope must be "global" or "project".',
    };
  }

  const memoryRoot =
    scope === "global"
      ? path.join(os.homedir(), ".codingmaid", "memory")
      : path.join(context.projectRoot, ".codingmaid", "memory");

  // 确保目录存在
  try {
    fs.mkdirSync(memoryRoot, { recursive: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      name: "memory",
      error: `Failed to create memory directory: ${message}`,
    };
  }

  // 使用 UNIX 风格的路径
  const unixPath = memoryRoot.replace(/\\/g, "/");

  return {
    ok: true,
    name: "memory",
    output: unixPath,
    metadata: {
      scope,
      path: unixPath,
      exists: true,
    },
  };
}
