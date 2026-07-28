/**
 * read — 工具定义
 *
 * 读取文件内容（文本、图片）。
 */

import { handleReadTool } from "../handler/read-handler";
import type { ToolRegistration } from "../registry";

export const readTool: ToolRegistration = {
  name: "read",
  description: "Read files from the filesystem (text, images).",
  parameters: {
    type: "object",
    properties: {
      file_path: {
        type: "string",
        description: "Absolute path to file",
      },
      offset: {
        type: "number",
        description: "Line number to start reading from",
      },
      limit: {
        type: "number",
        description: "Number of lines to read",
      },
    },
    required: ["file_path"],
    additionalProperties: false,
  },
  handler: handleReadTool,
  doc: `## Read

Reads a file from the local filesystem. You can access any file directly by using this tool.
Assume this tool is able to read all files on the machine. If the User provides a path to a file assume that path is valid. It is okay to read a file that does not exist; an error will be returned.

Usage:

- The file_path parameter must be an absolute path.
- By default, it reads up to 2000 lines starting from the beginning of the file
- You can optionally specify a line offset and limit (especially handy for long files), but it's recommended to read the whole file by not providing these parameters
- Any lines longer than 2000 characters will be truncated
- Results are returned with line numbers in \`001|\` format (e.g., \`001|const x = 1\`), zero-padded to at least 3 digits
- Text reads return a snippet id in metadata. You can pass that snippet id to the Edit tool to constrain replacements to just that read range.
- This tool allows you to read images (e.g., PNG, JPG, etc.). The contents are presented visually if the model supports multimodal input.
- This tool can only read files, not directories. To read a directory, use an ls command via the Bash tool.
- You can call multiple tools in a single response. It is always better to speculatively read multiple potentially useful files in parallel.
- You will regularly be asked to read screenshots. If the user provides a path to a screenshot, ALWAYS use this tool to view the file at the path. This tool will work with all temporary file paths.
- If you read a file that exists but has empty contents you will receive a system reminder warning in place of file contents.

\`\`\`json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "file_path": {
      "description": "The absolute path to the file to read",
      "type": "string"
    },
    "offset": {
      "description": "The line number to start reading from. Only provide if the file is too large to read at once",
      "type": "number"
    },
    "limit": {
      "description": "The number of lines to read. Only provide if the file is too large to read at once.",
      "type": "number"
    }
  },
  "required": ["file_path"],
  "additionalProperties": false
}
\`\`\``,
};
