/**
 * get_errors — 工具定义
 *
 * 获取当前文件或工作区的编译/语法错误。
 */

import { handleGetErrors } from "../handler/get-errors-handler";
import type { ToolRegistration } from "../registry";

export const getErrorsTool: ToolRegistration = {
  name: "get_errors",
  description:
    "Get compile/lint/diagnostic errors for specific files or the entire workspace. " +
    "Uses VS Code's Language Server diagnostics to return real-time errors with file paths, line numbers, and severity.",
  parameters: {
    type: "object",
    properties: {
      filePaths: {
        type: "array",
        items: { type: "string" },
        description:
          "Optional list of absolute file paths to check. When omitted, returns errors for all files in the workspace. " +
          "Pass an empty array or a single path to narrow results.",
      },
    },
    required: [],
    additionalProperties: false,
  },
  handler: handleGetErrors,
  doc: `## Get Errors

Retrieves compiler, linter, and syntax errors for files in the workspace.

This tool uses VS Code's built-in diagnostic system (Language Server Protocol), so it sees the same errors shown in the Problems panel and editor squiggly underlines.

### Usage

- Omit \`filePaths\` to get all errors across the entire workspace.
- Pass a single file path to check just that file.
- Pass multiple file paths to check a set of files.
- Results are grouped by file, with line numbers, column numbers, severity, and error messages.

\`\`\`json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "filePaths": {
      "description": "Optional list of absolute file paths. Omit for all workspace errors.",
      "type": "array",
      "items": { "type": "string" }
    }
  }
}
\`\`\`
`,
};
