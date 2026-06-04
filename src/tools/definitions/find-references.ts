/**
 * find_references — 工具定义
 *
 * 利用 VS Code Language Server 查找符号的所有引用、定义和实现。
 */

import { handleFindReferences } from "../handler/find-references-handler";
import type { ToolRegistration } from "../registry";

export const findReferencesTool: ToolRegistration = {
  name: "find_references",
  description:
    "Find all usages (references, definitions, and implementations) of a code symbol " +
    "across the workspace using the language server. Provide the file path and a line content " +
    "snippet to disambiguate when multiple symbols share the same name.",
  parameters: {
    type: "object",
    properties: {
      symbol: {
        type: "string",
        description: "The exact name of the symbol (function, class, method, variable, type, etc.) to search for.",
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
    required: ["symbol", "filePath", "lineContent"],
    additionalProperties: false,
  },
  handler: handleFindReferences,
  doc: `## Find References

Finds all references, definitions, and implementations of a code symbol across the workspace.

This tool uses the VS Code Language Server Protocol, which provides **semantic** knowledge of the code — it understands the language's syntax and can distinguish between different symbols that happen to have the same name.

### Usage

Provide the symbol name, a file where it appears, and a snippet of the line content to uniquely identify it.

\`\`\`json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "symbol": {
      "description": "The exact name of the symbol to search for.",
      "type": "string"
    },
    "filePath": {
      "description": "Absolute path to a file where the symbol appears.",
      "type": "string"
    },
    "lineContent": {
      "description": "A substring of the line where the symbol appears, used to locate the exact position.",
      "type": "string"
    }
  },
  "required": ["symbol", "filePath", "lineContent"]
}
\`\`\`
`,
};
