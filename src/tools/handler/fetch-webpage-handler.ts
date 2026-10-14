/**
 * fetch_webpage — handler 实现
 *
 * 获取网页 HTML，优先提取文档正文，并支持按字符偏移续读长页面。
 */

import * as https from "https";
import * as http from "http";
import { URL } from "url";
import type { ToolExecutionContext, ToolExecutionResult } from "../types";

const TIMEOUT_MS = 30_000;
const MAX_SIZE_BYTES = 5 * 1024 * 1024;
const DEFAULT_OUTPUT_CHARS = 12_000;
const MAX_OUTPUT_CHARS = 30_000;
const MAX_REDIRECTS = 5;

type FetchResponse = {
  html: string;
  finalUrl: string;
  contentType: string;
};

function httpGet(urlStr: string): Promise<FetchResponse> {
  const request = (url: URL, redirectsLeft: number): Promise<FetchResponse> =>
    new Promise<FetchResponse>((resolve, reject) => {
      if (url.protocol !== "http:" && url.protocol !== "https:") {
        reject(new Error(`Unsupported protocol: ${url.protocol}. Only http and https are supported.`));
        return;
      }

      const mod = url.protocol === "https:" ? https : http;
      const req = mod.get(
        url,
        {
          timeout: TIMEOUT_MS,
          headers: {
            "User-Agent": "Coding-Maid/1.0 (VS Code Extension)",
            Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.9",
          },
        },
        (res) => {
          const statusCode = res.statusCode ?? 0;
          const location = res.headers.location;

          if ([301, 302, 303, 307, 308].includes(statusCode) && location) {
            res.resume();
            if (redirectsLeft <= 0) {
              reject(new Error(`Too many redirects (maximum ${MAX_REDIRECTS}).`));
              return;
            }
            let nextUrl: URL;
            try {
              nextUrl = new URL(location, url);
            } catch {
              reject(new Error(`Invalid redirect URL: ${location}`));
              return;
            }
            request(nextUrl, redirectsLeft - 1).then(resolve, reject);
            return;
          }

          if (statusCode < 200 || statusCode >= 300) {
            res.resume();
            reject(new Error(`HTTP ${statusCode}: ${res.statusMessage || ""}`));
            return;
          }

          const chunks: Buffer[] = [];
          let totalSize = 0;
          res.on("data", (chunk: Buffer) => {
            totalSize += chunk.length;
            if (totalSize > MAX_SIZE_BYTES) {
              req.destroy();
              reject(new Error(`Response too large (>${MAX_SIZE_BYTES / 1024 / 1024}MB).`));
              return;
            }
            chunks.push(chunk);
          });
          res.on("error", reject);
          res.on("end", () => {
            const contentType = typeof res.headers["content-type"] === "string" ? res.headers["content-type"] : "";
            const charset = contentType.match(/charset\s*=\s*"?([^\s;"]+)/i)?.[1]?.toLowerCase();
            const encoding: BufferEncoding = charset === "latin1" || charset === "iso-8859-1" ? "latin1" : "utf8";
            resolve({
              html: Buffer.concat(chunks).toString(encoding),
              finalUrl: url.toString(),
              contentType,
            });
          });
        }
      );

      req.on("error", reject);
      req.on("timeout", () => {
        req.destroy();
        reject(new Error(`Request timed out after ${TIMEOUT_MS / 1000}s.`));
      });
    });

  try {
    return request(new URL(urlStr), MAX_REDIRECTS);
  } catch {
    return Promise.reject(new Error(`Invalid URL: ${urlStr}`));
  }
}

function findElementContent(
  html: string,
  tag: string,
  matches: (openingTag: string) => boolean = () => true
): string | null {
  const openingTag = new RegExp(`<${tag}\\b[^>]*>`, "gi");
  let opening: RegExpExecArray | null;
  while ((opening = openingTag.exec(html))) {
    if (!matches(opening[0])) continue;

    const tags = new RegExp(`<\\/?${tag}\\b[^>]*>`, "gi");
    tags.lastIndex = openingTag.lastIndex;
    let depth = 1;
    let current: RegExpExecArray | null;
    while ((current = tags.exec(html))) {
      if (/^<\//.test(current[0])) {
        depth -= 1;
        if (depth === 0) {
          return html.slice(openingTag.lastIndex, current.index);
        }
      } else if (!/\/>$/.test(current[0])) {
        depth += 1;
      }
    }
    return null;
  }
  return null;
}

function decodeEntities(text: string): string {
  const namedEntities: Record<string, string> = {
    amp: "&",
    lt: "<",
    gt: ">",
    quot: '"',
    apos: "'",
    nbsp: " ",
    mdash: "—",
    ndash: "–",
    lsquo: "‘",
    rsquo: "’",
    ldquo: "“",
    rdquo: "”",
    copy: "©",
    reg: "®",
  };
  return text.replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (entity, code: string) => {
    if (code[0] === "#") {
      const value =
        code[1].toLowerCase() === "x" ? Number.parseInt(code.slice(2), 16) : Number.parseInt(code.slice(1), 10);
      return Number.isFinite(value) && value > 0 && value <= 0x10ffff ? String.fromCodePoint(value) : entity;
    }
    return namedEntities[code.toLowerCase()] ?? entity;
  });
}

function htmlToText(html: string, baseUrl: string): { text: string; title: string } {
  const title = decodeEntities(
    html
      .match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1]
      ?.replace(/<[^>]+>/g, " ")
      .trim() ?? ""
  );
  const findDivByAttribute = (attribute: "id" | "class", values: string[]): string | null =>
    findElementContent(html, "div", (openingTag) => {
      const value = openingTag.match(new RegExp(`\\b${attribute}\\s*=\\s*(["'])(.*?)\\1`, "i"))?.[2];
      const tokens = attribute === "class" ? (value?.split(/\s+/) ?? []) : [value ?? ""];
      return tokens.some((token) => values.includes(token.toLowerCase()));
    });
  let content =
    findElementContent(html, "main") ??
    findElementContent(html, "article") ??
    findDivByAttribute("id", ["main-content", "content", "document"]) ??
    findDivByAttribute("class", ["document", "doc-content", "documentation", "main-content", "content"]) ??
    html;

  content = content.replace(/<(script|style|noscript|svg|nav|header|footer|aside)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, " ");
  content = content.replace(/<!--[\s\S]*?-->/g, " ");
  const codeBlocks: string[] = [];
  content = content.replace(/<pre\b[^>]*>([\s\S]*?)<\/pre>/gi, (_match, code: string) => {
    const plainCode = decodeEntities(code.replace(/<[^>]+>/g, ""))
      .replace(/\r\n?/g, "\n")
      .replace(/^\n|\n$/g, "");
    const placeholder = `\u0000FETCH_CODE_${codeBlocks.length}\u0000`;
    codeBlocks.push(plainCode);
    return `\n\n${placeholder}\n\n`;
  });
  content = content.replace(/<code\b[^>]*>([\s\S]*?)<\/code>/gi, (_match, code: string) => {
    return `\`${decodeEntities(code.replace(/<[^>]+>/g, ""))}\``;
  });
  content = content.replace(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi, (_match, attributes: string, label: string) => {
    const href = attributes.match(/\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
    const target = href?.[1] ?? href?.[2] ?? href?.[3];
    const linkText = label.replace(/<[^>]+>/g, "").trim();
    if (!target || !linkText || /^(?:javascript|mailto|data):/i.test(target)) return label;
    try {
      return `[${label.trim()}](${new URL(target, baseUrl).toString()})`;
    } catch {
      return label;
    }
  });
  content = content.replace(
    /<\/(p|div|h[1-6]|li|tr|blockquote|pre|section|article|nav|header|footer|aside|dl|dd|dt|ul|ol|table)>/gi,
    "\n"
  );
  content = content.replace(/<(h[1-6])\b[^>]*>/gi, "\n## ");
  content = content.replace(/<li\b[^>]*>/gi, "\n- ");
  content = content.replace(/<br\s*\/?>/gi, "\n");
  content = content.replace(/<hr\s*\/?>/gi, "\n---\n");
  content = content.replace(/<[^>]+>/g, "");
  content = decodeEntities(content);
  content = content
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n");
  content = content
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .join("\n");
  content = content.replace(/\u0000FETCH_CODE_(\d+)\u0000/g, (_match, index: string) => {
    return `\n\`\`\`\n${codeBlocks[Number(index)]}\n\`\`\`\n`;
  });
  return { text: content.trim(), title };
}

function parseIntegerArgument(value: unknown, name: string, defaultValue: number): number {
  if (value === undefined) return defaultValue;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`"${name}" must be a non-negative safe integer.`);
  }
  return value;
}

export async function handleFetchWebpage(
  args: Record<string, unknown>,
  _context: ToolExecutionContext
): Promise<ToolExecutionResult> {
  const url = typeof args.url === "string" ? args.url.trim() : "";
  if (!url) {
    return {
      ok: false,
      name: "fetch_webpage",
      error: 'Missing required "url" string.',
    };
  }

  try {
    const offset = parseIntegerArgument(args.offset, "offset", 0);
    const limit = parseIntegerArgument(args.limit, "limit", DEFAULT_OUTPUT_CHARS);
    if (limit < 1 || limit > MAX_OUTPUT_CHARS) {
      throw new Error(`"limit" must be between 1 and ${MAX_OUTPUT_CHARS}.`);
    }

    const fetched = await httpGet(url);
    if (fetched.contentType && !/^(text\/|application\/(?:xhtml\+xml|xml|json))/i.test(fetched.contentType)) {
      return {
        ok: false,
        name: "fetch_webpage",
        error: `Unsupported content type "${fetched.contentType}". This tool reads text-based web pages, not binary files.`,
      };
    }
    const { text, title } = htmlToText(fetched.html, fetched.finalUrl);
    const metadata = {
      url,
      finalUrl: fetched.finalUrl,
      title,
      contentType: fetched.contentType,
      bytes: Buffer.byteLength(fetched.html, "utf8"),
      chars: text.length,
    };
    if (!text) {
      return {
        ok: true,
        name: "fetch_webpage",
        output: `Fetched ${fetched.finalUrl}, but no readable text content was found. The page may require JavaScript rendering or return a non-HTML resource.`,
        metadata,
      };
    }
    if (offset > text.length) {
      throw new Error(`"offset" (${offset}) exceeds the extracted content length (${text.length}).`);
    }

    let end = Math.min(offset + limit, text.length);
    if (end < text.length) {
      const paragraphEnd = text.lastIndexOf("\n\n", end);
      const lineEnd = text.lastIndexOf("\n", end);
      const wordEnd = text.lastIndexOf(" ", end);
      if (paragraphEnd >= offset + Math.floor(limit * 0.7)) {
        end = paragraphEnd;
      } else if (lineEnd >= offset + Math.floor(limit * 0.9)) {
        end = lineEnd;
      } else if (wordEnd >= offset + Math.floor(limit * 0.95)) {
        end = wordEnd;
      }
    }
    const hasMore = end < text.length;
    const excerpt = text.slice(offset, end);
    const heading = [title ? `# ${title}` : "", `Source: ${fetched.finalUrl}`].filter(Boolean).join("\n\n");
    const continuation = hasMore
      ? `\n\n[More content available. Call fetch_webpage with the same URL and offset ${end}.]`
      : "";

    return {
      ok: true,
      name: "fetch_webpage",
      output: `${heading}\n\n${excerpt}${continuation}`,
      metadata: {
        ...metadata,
        offset,
        returnedChars: end - offset,
        nextOffset: hasMore ? end : null,
        truncated: hasMore,
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      name: "fetch_webpage",
      error: `Failed to fetch ${url}: ${message}`,
    };
  }
}
