/**
 * memory — 工具定义
 *
 * 获取记忆目录路径（global / project），确保目录存在。
 * 实际的读写操作由 read / write / edit / search / list_dir 等现有工具完成。
 */

import { handleMemory } from "../handler/memory-handler";
import type { ToolRegistration } from "../registry";

export const memoryTool: ToolRegistration = {
  name: "memory",
  description:
    "Get the memory directory path for the specified scope and ensure it exists. " +
    "Use the returned path with other tools (read, write, edit, search, list_dir) for actual file operations. " +
    "'global' (~/.codingmaid/memory/) persists across all workspaces; " +
    "'project' (.codingmaid/memory/) is scoped to the current repository.",
  parameters: {
    type: "object",
    properties: {
      scope: {
        type: "string",
        enum: ["global", "project"],
        description:
          '"global" for ~/.codingmaid/memory/ (跨项目通用). ' +
          '"project" for .codingmaid/memory/ in the current project root (仓库级).',
      },
    },
    required: ["scope"],
    additionalProperties: false,
  },
  handler: handleMemory,
  doc: `## Memory

Returns the memory directory path for the given scope and ensures the directory exists.

### Scopes

| scope | path |
|-------|------|
| \`global\` | \`~/.codingmaid/memory/\` |
| \`project\` | \`<projectRoot>/.codingmaid/memory/\` |

### Usage

Get the path, then use other tools for file operations:

\`\`\`
path = memory({ scope: "global" })
→ ~/.codingmaid/memory/

write({ file_path: path + "patterns.md", content: "# Useful patterns..." })
read({ file_path: path + "patterns.md" })
search({ mode: "file", query: "**/*", path: path })
\`\`\`
`,
};
