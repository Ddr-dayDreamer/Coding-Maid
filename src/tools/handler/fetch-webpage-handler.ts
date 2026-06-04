/**
 * fetch_webpage — handler 实现
 *
 * 通过 Node.js http/https 模块获取网页内容，提取可读文本。
 */

import * as https from "https";
import * as http from "http";
import { URL } from "url";
import type { ToolExecutionContext, ToolExecutionResult } from "../types";

// ─── 常量 ───────────────────────────────────────────────

const TIMEOUT_MS = 30_000;
const MAX_SIZE_BYTES = 5 * 1024 * 1024; // 5MB
const MAX_OUTPUT_CHARS = 30_000;

// ─── HTTP 请求 ──────────────────────────────────────────

function httpGet(urlStr: string): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    let url: URL;
    try {
      url = new URL(urlStr);
    } catch {
      reject(new Error(`Invalid URL: ${urlStr}`));
      return;
    }

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
          "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
        },
      },
      (res) => {
        // 检查状态码
        if (res.statusCode && (res.statusCode < 200 || res.statusCode >= 300)) {
          reject(new Error(`HTTP ${res.statusCode}: ${res.statusMessage || ""}`));
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

        res.on("end", () => {
          const buffer = Buffer.concat(chunks);

          // 尝试检测编码
          let contentType = "";
          if (typeof res.headers["content-type"] === "string") {
            contentType = res.headers["content-type"];
          }

          let encoding: BufferEncoding = "utf8";
          const charsetMatch = contentType.match(/charset\s*=\s*([^\s;]+)/i);
          if (charsetMatch) {
            const cs = charsetMatch[1].toLowerCase();
            if (cs === "gbk" || cs === "gb2312" || cs === "gb18030") {
              // GBK 系需要 iconv-lite，这里 fallback 到 utf8
              encoding = "utf8";
            } else if (["utf-8", "utf8", "ascii", "latin1"].includes(cs)) {
              encoding = cs as BufferEncoding;
            }
          }

          resolve(buffer.toString(encoding));
        });
      },
    );

    req.on("error", (err) => reject(err));
    req.on("timeout", () => {
      req.destroy();
      reject(new Error(`Request timed out after ${TIMEOUT_MS / 1000}s.`));
    });
  });
}

// ─── HTML → 文本 ────────────────────────────────────────

function htmlToText(html: string): string {
  // 移除 script/style/noscript 块
  let text = html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, " ");
  text = text.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, " ");
  text = text.replace(/<noscript[^>]*>[\s\S]*?<\/noscript>/gi, " ");
  text = text.replace(/<svg[^>]*>[\s\S]*?<\/svg>/gi, " ");

  // 块级标签后换行
  text = text.replace(/<\/(p|div|h[1-6]|li|tr|blockquote|pre|section|article|nav|header|footer|aside|dl|dd|dt)>/gi, "\n");
  text = text.replace(/<br\s*\/?>/gi, "\n");
  text = text.replace(/<hr\s*\/?>/gi, "\n---\n");

  // 移除所有剩余标签
  text = text.replace(/<[^>]+>/g, "");

  // 解码 HTML 实体
  text = text.replace(/&amp;/g, "&");
  text = text.replace(/&lt;/g, "<");
  text = text.replace(/&gt;/g, ">");
  text = text.replace(/&quot;/g, '"');
  text = text.replace(/&#39;/g, "'");
  text = text.replace(/&#x27;/g, "'");
  text = text.replace(/&#x2F;/g, "/");
  text = text.replace(/&nbsp;/g, " ");
  text = text.replace(/&mdash;/g, "—");
  text = text.replace(/&ndash;/g, "–");

  // 清理空白
  text = text.replace(/\r\n/g, "\n");
  text = text.replace(/[ \t]+/g, " ");
  text = text.replace(/\n{3,}/g, "\n\n");
  text = text.replace(/^\s+|\s+$/gm, "");

  return text.trim();
}

// ─── 入口 ───────────────────────────────────────────────

export async function handleFetchWebpage(
  args: Record<string, unknown>,
  context: ToolExecutionContext,
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
    const rawHtml = await httpGet(url);
    const text = htmlToText(rawHtml);

    if (!text) {
      return {
        ok: true,
        name: "fetch_webpage",
        output: `Fetched ${url}, but no readable text content was found. The page may be empty or rely on JavaScript to render.`,
        metadata: { url, bytes: Buffer.byteLength(rawHtml, "utf8") },
      };
    }

    const truncated = text.length > MAX_OUTPUT_CHARS
      ? text.slice(0, MAX_OUTPUT_CHARS) + `\n\n... [truncated at ${MAX_OUTPUT_CHARS} characters]`
      : text;

    return {
      ok: true,
      name: "fetch_webpage",
      output: truncated,
      metadata: {
        url,
        bytes: Buffer.byteLength(rawHtml, "utf8"),
        chars: text.length,
        truncated: text.length > MAX_OUTPUT_CHARS,
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
