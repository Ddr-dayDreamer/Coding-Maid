/**
 * list_dir — 工具定义
 *
 * 列出目录内容，区分文件/文件夹。
 */

import { handleListDirTool } from "../handler/list-dir-handler";
import type { ToolRegistration } from "../registry";

export const listDirTool: ToolRegistration = {
  name: "list_dir",
  description: "List directory contents, distinguishing files from directories.",
  parameters: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description: "Absolute path to the directory to list.",
      },
    },
    required: ["path"],
    additionalProperties: false,
  },
  handler: handleListDirTool,
  doc: `## List Directory

Lists the contents of a directory, clearly showing which entries are files and which are subdirectories.

Usage:
- Provide an absolute path to the directory you want to list.
- Directories are shown with a trailing "/" for easy identification.
- Hidden files (starting with ".") are included.
- Supports both Windows (\\\\) and POSIX (/) path separators.

\`\`\`json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "path": {
      "description": "The absolute path to the directory to list.",
      "type": "string"
    }
  },
  "required": ["path"]
}
\`\`\`
`,
};
