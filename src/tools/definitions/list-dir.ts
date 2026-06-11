/**
 * list_dir — 工具定义
 *
 * 列出目录内容，区分文件/文件夹。支持递归树形查看。
 */

import { handleListDirTool } from "../handler/list-dir-handler";
import type { ToolRegistration } from "../registry";

export const listDirTool: ToolRegistration = {
  name: "list_dir",
  description:
    "List directory contents, distinguishing files from directories. Supports optional recursive tree view.",
  parameters: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description: "Absolute path to the directory to list.",
      },
      recursive: {
        type: "boolean",
        description:
          "If true, recursively list all subdirectories and files in a tree format. Default true.",
      },
      maxDepth: {
        type: "number",
        description:
          "Maximum recursion depth when recursive=true. Default 5. Use -1 for unlimited (use with caution on large trees).",
      },
      filterIgnored: {
        type: "boolean",
        description:
          "If true, skip entries matched by .gitignore rules and built-in ignore list (node_modules/, .git/, dist/, etc). Default true.",
      },
    },
    required: ["path"],
    additionalProperties: false,
  },
  handler: handleListDirTool,
  doc: `## List Directory

Lists the contents of a directory, clearly showing which entries are files and which are subdirectories.

### Basic usage
- Provide an absolute path to the directory you want to list.
- Directories are shown with a trailing "/" for easy identification.
- Hidden files (starting with ".") are included.
- Supports both Windows (\\\\ and /) path separators.

### Recursive mode
- Set \`recursive: true\` to get a tree-style listing of the entire subtree.
- Use \`maxDepth\` to limit recursion depth (default 5, use -1 for unlimited).
- Symlinks are **not** followed to prevent infinite loops.
- Useful for quickly exploring a project's structure in a single call.

\`\`\`json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "path": {
      "description": "The absolute path to the directory to list.",
      "type": "string"
    },
    "recursive": {
      "description": "If true, recursively list all subdirectories and files in a tree format. Default true.",
      "type": "boolean"
    },
    "maxDepth": {
      "description": "Maximum recursion depth. Default 5. Use -1 for unlimited.",
      "type": "number"
    },
    "filterIgnored": {
      "description": "If true, skip entries matched by .gitignore rules and built-in ignore list. Default true.",
      "type": "boolean"
    }
  },
  "required": ["path"]
}
\`\`\`
`,
};
