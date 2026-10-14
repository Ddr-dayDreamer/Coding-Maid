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
    "Fetch a web page and extract its main readable content. Works well for static documentation and reference pages, including the official Godot docs. " +
    "Long pages can be read in chunks by calling again with the returned nextOffset.",
  parameters: {
    type: "object",
    properties: {
      url: {
        type: "string",
        description: "The URL to fetch content from (http/https only).",
      },
      offset: {
        type: "number",
        description:
          "Character offset to continue reading from, using the previous result's nextOffset. Defaults to 0.",
      },
      limit: {
        type: "number",
        description: "Maximum characters to return (1-30000). Defaults to 12000.",
      },
    },
    required: ["url"],
    additionalProperties: false,
  },
  handler: handleFetchWebpage,
  doc: `## Fetch Webpage

Fetches content from a user-provided URL and extracts readable text, with a focus on documentation and reference pages.

The tool:
- Follows up to 5 HTTP redirects and reports the final URL.
- Prioritizes the main/article/document body, preserves links, and keeps code examples in fenced blocks.
- Returns up to 12000 characters by default (maximum 30000 per call). If \`metadata.nextOffset\` is present, call again with the same URL and that offset to continue reading.
- Works best for static HTML pages such as documentation, API references, and articles. It does not execute JavaScript or access authenticated pages.
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
    },
    "offset": {
      "description": "Character offset for reading the next chunk.",
      "type": "number"
    },
    "limit": {
      "description": "Maximum number of characters to return (1-30000).",
      "type": "number"
    }
  },
  "required": ["url"]
}
\`\`\`
`,
};
