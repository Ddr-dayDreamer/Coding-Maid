/**
 * edit — 工具定义
 *
 * 在文件中执行精确的字符串替换（单次匹配）。
 * 批量替换请使用 find_and_replace 工具。
 */

import { handleEditTool } from "../handler/edit-handler";
import { editApprovalChecker } from "../approval-checkers";
import type { ToolRegistration } from "../registry";

export const editTool: ToolRegistration = {
  name: "edit",
  description: "Perform precise single-occurrence string replacements in files.",
  parameters: {
    type: "object",
    properties: {
      file_path: {
        type: "string",
        description: "Absolute path to the file to modify.",
      },
      old_string: {
        type: "string",
        description: "Exact text to replace.",
      },
      new_string: {
        type: "string",
        description: "Replacement text (must differ from old_string).",
      },
      start_line: {
        type: "number",
        description:
          "Optional 1-based start line to scope the search. Use with end_line when you know the target range from a prior Read.",
      },
      end_line: {
        type: "number",
        description:
          "Optional 1-based end line (inclusive) to scope the search. Use with start_line.",
      },
      expected_start_line: {
        type: "number",
        description:
          "Optional 1-based line number where old_string is expected to start. " +
          "If provided, the tool verifies the match is at this line before editing.",
      },
    },
    required: ["file_path", "old_string", "new_string"],
    additionalProperties: false,
  },
  handler: handleEditTool,
  approvalChecker: editApprovalChecker,
  doc: `## Edit

Performs precise single-occurrence string replacements in files.

Usage:
- You must use your \`Read\` tool at least once in the conversation before editing.
- When editing text from Read tool output, ensure you preserve the exact indentation (tabs/spaces) as it appears AFTER the line number prefix. The line number prefix format is: spaces + line number + tab. Everything after that tab is the actual file content to match.
- Use \`start_line\` / \`end_line\` from a prior Read response to scope the edit to a known range.
- ALWAYS prefer editing existing files. NEVER write new files unless explicitly required.

If \`old_string\` is not unique, the tool returns candidate matches with line ranges and previews. Pass \`start_line\` / \`end_line\` in a follow-up call to scope the replacement.

If \`old_string\` is not found, the tool returns the closest likely match in metadata.

The tool automatically applies a multi-phase matching strategy when exact match fails:
1. **Line number prefix correction** — Strips Read output line numbers (\`     6\\tcontent\`) if accidentally included.
2. **Loose escape correction** — Corrects JSON/escape character differences (score >= 0.85).
3. **Whitespace normalization** — Normalizes all consecutive whitespace to handle indent/space/tab mismatches.

When auto-correction succeeds, the \`matched_via\` metadata field indicates which strategy was used.

\`\`\`json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "file_path": {
      "description": "The absolute path to the file to modify.",
      "type": "string"
    },
    "old_string": {
      "description": "The exact text to replace within the file.",
      "type": "string"
    },
    "new_string": {
      "description": "The replacement text (must differ from old_string).",
      "type": "string"
    },
    "start_line": {
      "description": "1-based start line to scope the search range.",
      "type": "number"
    },
    "end_line": {
      "description": "1-based end line (inclusive) to scope the search range.",
      "type": "number"
    },
    "expected_start_line": {
      "description": "Expected 1-based start line for the match. Acts as a safety check.",
      "type": "number"
    }
  },
  "required": [
    "file_path",
    "old_string",
    "new_string"
  ],
  "additionalProperties": false
}
\`\`\``,
};
