/**
 * rename_symbol — 工具定义
 *
 * 利用 VS Code Language Server 跨文件安全重命名符号。
 */

import { handleRenameSymbol } from "../handler/rename-symbol-handler";
import type { ToolRegistration } from "../registry";

export const renameSymbolTool: ToolRegistration = {
  name: "rename_symbol",
  description:
    "Rename a code symbol across the workspace using the language server. " +
    "This performs a precise, semantics-aware rename that updates all references. " +
    "Provide the file path and a line content snippet to disambiguate the symbol.",
  parameters: {
    type: "object",
    properties: {
      symbol: {
        type: "string",
        description: "The exact current name of the symbol to rename.",
      },
      newName: {
        type: "string",
        description: "The new name for the symbol. Must be a valid identifier in the source language.",
      },
      filePath: {
        type: "string",
        description:
          "Absolute path to a file where the symbol appears. Provide this to help locate the correct symbol.",
      },
      lineContent: {
        type: "string",
        description:
          "A substring of the line of code where the symbol appears. Used together with filePath to " +
          "pinpoint the exact symbol instance. Must be actual text from the file.",
      },
    },
    required: ["symbol", "newName", "filePath", "lineContent"],
    additionalProperties: false,
  },
  handler: handleRenameSymbol,
  doc: `## Rename Symbol

Renames a code symbol across the entire workspace using the Language Server's rename capability.

Unlike a simple find-and-replace, this tool understands the language's syntax and semantics:
- It only renames the **specific symbol** you intend, not other symbols with the same name.
- It correctly handles scoping (e.g., local variables vs. module-level exports).
- It updates all references simultaneously (definitions, imports, usages).

### Usage

Provide the current symbol name, the new name, and a file + line content to identify which symbol to rename.

\`\`\`json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "symbol": {
      "description": "The exact current name of the symbol.",
      "type": "string"
    },
    "newName": {
      "description": "The new name for the symbol.",
      "type": "string"
    },
    "filePath": {
      "description": "Absolute path to a file where the symbol appears.",
      "type": "string"
    },
    "lineContent": {
      "description": "A substring of the line where the symbol appears.",
      "type": "string"
    }
  },
  "required": ["symbol", "newName", "filePath", "lineContent"]
}
\`\`\`
`,
};
