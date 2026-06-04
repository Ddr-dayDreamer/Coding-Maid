import * as path from "path";
import { fileURLToPath } from "url";
import { registry } from "./tools/index";
import type { ToolDefinition } from "./tools/registry";

/** 工具选项，控制哪些工具注册到 API */
type PromptToolOptions = {
  model?: string;
  /** 仅在此列表中的工具会被注册到 API，未指定时返回全部 */
  availableTools?: string[];
};

export function getExtensionRoot(): string {
  // Prefer `__dirname` which is always available in the CJS bundle output.
  // Fall back to `import.meta.url` for ESM test environments (tsx --test).
  if (typeof __dirname !== "undefined") {
    return path.resolve(__dirname, "..");
  }

  const currentFilePath = fileURLToPath(import.meta.url);
  return path.resolve(path.dirname(currentFilePath), "..");
}

// 向后兼容 — 类型已移至 src/tools/registry.ts
export type { ToolDefinition } from "./tools/registry";

export function getTools(_options: PromptToolOptions = {}, externalTools: ToolDefinition[] = []): ToolDefinition[] {
  const { availableTools } = _options;

  // 从 registry 获取内置工具定义
  const builtinTools = registry.getToolDefinitions(availableTools);

  // 合并外部工具（MCP）
  const allTools = [...builtinTools, ...externalTools];

  // 如果 availableTools 指定了，registry.getToolDefinitions 已经做了过滤
  // 但 externalTools 也需要匹配过滤
  if (availableTools && availableTools.length > 0) {
    const allowed = new Set(availableTools.map((t: string) => t.toLowerCase()));
    return allTools.filter((t) => allowed.has(t.function.name.toLowerCase()));
  }

  return allTools;
}
