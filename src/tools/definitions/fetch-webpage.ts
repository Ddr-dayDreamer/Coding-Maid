/**
 * fetch_webpage — 工具定义
 *
 * 获取指定 URL 的网页内容并提取可读文本。
 */

import { handleFetchWebpage } from "../handler/fetch-webpage-handler";
import type { ToolRegistration } from "../registry";

export const fetchWebpageTool: ToolRegistration = {
  name: "fetch_webpage",
  description:
    "Fetch content from a specified URL and extract readable text. " +
    "Useful for reading documentation, API responses, GitHub issues/PRs, or any publicly accessible web page.",
  parameters: {
    type: "object",
    properties: {
      url: {
        type: "string",
        description: "The URL to fetch content from (http/https only).",
      },
    },
    required: ["url"],
    additionalProperties: false,
  },
  handler: handleFetchWebpage,
  doc: `## Fetch Webpage

Fetches the content of a web page from a user-provided URL and extracts the readable text.

The tool:
- Follows HTTP redirects automatically.
- Strips HTML tags, scripts, and styles to return clean text.
- Has a 30-second timeout and 5MB response size limit.
- Only supports \`http:\` and \`https:\` URLs.

\`\`\`json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "url": {
      "description": "The URL to fetch (must start with http:// or https://).",
      "type": "string"
    }
  },
  "required": ["url"]
}
\`\`\`
`,
};
