/**
 * 内置工具列表（唯一数据源）
 *
 * 纯数据文件，无任何 import / Node.js 依赖。
 * 扩展后端（src/）和 WebView（resources/webview/）都可以安全 import。
 *
 * 加/删工具只需改这一个数组。
 * `macro` 由 {{tool.${id}}} 自动推导，不需要手写。
 */
export const BUILTIN_TOOLS = [
  "bash",
  "read",
  "write",
  "edit",
  "AskUserQuestion",
  "UpdatePlan",
  "search",
  "list_dir",
  "find_references",
  "rename_symbol",
  "get_errors",
  "fetch_webpage",
  "memory",
] as const;

export type BuiltinToolId = (typeof BUILTIN_TOOLS)[number];

/** 获取所有工具 ID 列表（字符串数组） */
export function getBuiltinToolIds(): string[] {
  return [...BUILTIN_TOOLS];
}
