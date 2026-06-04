/**
 * search — 工具定义
 *
 * 统一搜索工具：按文件内容（text）或文件路径（file）搜索。
 */

import { handleSearchTool } from "../handler/search-handler";
import type { ToolRegistration } from "../registry";

export const searchTool: ToolRegistration = {
  name: "search",
  description:
    "Search files by content (text/regex) or by file path (glob). Use 'text' mode to find code, function definitions, or any text within files. Use 'file' mode to find files matching a glob pattern.",
  parameters: {
    type: "object",
    properties: {
      mode: {
        type: "string",
        enum: ["text", "file"],
        description:
          "Search mode:\n" +
          '- "text": Search file **contents** for matching text or regex. Use this to find function definitions, variable names, comments, or any code pattern.\n' +
          '- "file": Search file **paths** using glob patterns. Use this to find files by name, extension, or directory structure (e.g., `**/*.ts`, `src/**/*.css`).',
      },
      query: {
        type: "string",
        description:
          'For text mode: the text or regex pattern to search for within file contents. For file mode: a glob pattern to match file paths against (e.g., "**/*.ts", "src/**/*.css", "*controller*").',
      },
      includePattern: {
        type: "string",
        description:
          'Optional. Only search files whose paths match this glob pattern. Useful for scoping searches to a specific area (e.g., "src/**" to search only under src/, "**/*.ts" to search only TypeScript files).',
      },
      isRegexp: {
        type: "boolean",
        description: "For text mode only. When true, treat query as a regular expression. Default false.",
        default: false,
      },
      maxResults: {
        type: "number",
        description: "Maximum number of results to return (default 50, max 200).",
        default: 50,
      },
      path: {
        type: "string",
        description:
          "Root path to search from. Defaults to the workspace root (projectRoot). Use this to search a specific directory outside the workspace.",
      },
    },
    required: ["mode", "query"],
    additionalProperties: false,
  },
  handler: handleSearchTool,
  doc: `## Search

Searches files in the workspace by content (text/regex) or by file path (glob).

### Modes

**text** — Search file contents for matching text or regex patterns.
Returns files with line numbers and matching line content.
Honors \`.gitignore\` and skips binary files automatically.

**file** — Search file paths using glob patterns.
Returns matching file paths.
Honors \`.gitignore\` automatically.

### Usage Tips

- Use \`text\` mode to find where a function is defined, where a variable is used, or any code pattern.
- Use \`file\` mode to discover files by name pattern (e.g., \`**/*.controller.ts\`).
- Use \`includePattern\` to narrow the search scope (e.g., \`src/**\`) for faster results.
- Set \`isRegexp: true\` in text mode for regex searches. The regex is case-insensitive.
- Results are capped at \`maxResults\` (default 50, max 200) to keep output manageable.
- Binary file extensions and \`.gitignore\`d paths are automatically excluded in both modes.
- If searching the whole workspace is too slow, use \`includePattern\` to restrict the search area.
`,
};
