import * as fs from "fs";
import * as path from "path";
import type { FileState, FileLineEnding } from "./state";

export type FileReadMetadata = {
  content: string;
  encoding: BufferEncoding;
  lineEndings: FileLineEnding;
  timestamp: number;
};

export function normalizeContent(value: string): string {
  return value.replace(/\r\n/g, "\n");
}

export function detectLineEndings(value: string): FileLineEnding {
  return value.includes("\r\n") ? "CRLF" : "LF";
}

export function detectEncoding(buffer: Buffer): BufferEncoding {
  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) {
    return "utf16le";
  }

  return "utf8";
}

export function readTextFileWithMetadata(filePath: string): FileReadMetadata {
  const buffer = fs.readFileSync(filePath);
  const stat = fs.statSync(filePath);
  const encoding = detectEncoding(buffer);
  const raw = buffer.toString(encoding);

  return {
    content: normalizeContent(raw),
    encoding,
    lineEndings: detectLineEndings(raw),
    timestamp: Math.floor(stat.mtimeMs),
  };
}

export function writeTextFile(
  filePath: string,
  content: string,
  encoding: BufferEncoding,
  lineEndings: FileLineEnding
): number {
  const normalized = normalizeContent(content);
  const toWrite = lineEndings === "CRLF" ? normalized.replace(/\n/g, "\r\n") : normalized;
  fs.writeFileSync(filePath, toWrite, { encoding });
  return Buffer.byteLength(toWrite, encoding === "utf16le" ? "utf16le" : "utf8");
}

export function ensureParentDirectory(filePath: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

export function hasFileChangedSinceState(filePath: string, state: FileState): boolean {
  const current = readTextFileWithMetadata(filePath);
  if (current.timestamp <= state.timestamp) {
    return false;
  }

  const isFullRead = !state.isPartialView && typeof state.offset === "undefined" && typeof state.limit === "undefined";

  return !(isFullRead && current.content === state.content);
}

export function buildDiffPreview(
  filePath: string,
  originalContent: string | null,
  updatedContent: string,
  maxLines = 40
): string | null {
  const original = originalContent === null ? null : normalizeContent(originalContent);
  const updated = normalizeContent(updatedContent);

  if (original !== null && original === updated) {
    return null;
  }

  const oldLines = toDiffLines(original);
  const newLines = toDiffLines(updated);

  let prefix = 0;
  while (prefix < oldLines.length && prefix < newLines.length && oldLines[prefix] === newLines[prefix]) {
    prefix += 1;
  }

  let suffix = 0;
  while (
    suffix < oldLines.length - prefix &&
    suffix < newLines.length - prefix &&
    oldLines[oldLines.length - 1 - suffix] === newLines[newLines.length - 1 - suffix]
  ) {
    suffix += 1;
  }

  const oldChanged = oldLines.slice(prefix, oldLines.length - suffix);
  const newChanged = newLines.slice(prefix, newLines.length - suffix);
  const oldStart = original === null ? 0 : prefix + 1;
  const newStart = prefix + 1;

  const previewLines = [
    `--- ${original === null ? "/dev/null" : `a/${filePath}`}`,
    `+++ b/${filePath}`,
    `@@ -${oldStart},${oldChanged.length} +${newStart},${newChanged.length} @@`,
  ];

  if (prefix > 0) {
    previewLines.push(` ${oldLines[prefix - 1]}`);
  }

  for (const line of oldChanged) {
    previewLines.push(`-${line}`);
  }

  for (const line of newChanged) {
    previewLines.push(`+${line}`);
  }

  if (suffix > 0) {
    previewLines.push(` ${oldLines[oldLines.length - suffix]}`);
  }

  if (previewLines.length > maxLines) {
    return `${previewLines.slice(0, maxLines).join("\n")}\n...`;
  }

  return previewLines.join("\n");
}

function toDiffLines(content: string | null): string[] {
  if (!content) {
    return [];
  }

  const lines = content.split("\n");
  if (lines[lines.length - 1] === "") {
    lines.pop();
  }
  return lines;
}

// ─── 文件读取 + 行数控制（供宏引擎使用） ──────────────────

export type ReadFileContentOptions = {
  /** 文件绝对路径 */
  filePath: string;
  /** 起始行（1-based），不传则从第一行开始 */
  startLine?: number;
  /** 结束行（1-based，含），不传则到最后一行 */
  endLine?: number;
  /** 超过此行数时截断，默认 100 */
  maxLines?: number;
  /** 截断时保留的开头行数，默认 50 */
  headLines?: number;
  /** 截断时保留的末尾行数，默认 20 */
  tailLines?: number;
};

export type ReadFileContentResult = {
  /** 最终输出的文本内容 */
  content: string;
  /** 文件总行数 */
  totalLines: number;
  /** 是否被截断 */
  truncated: boolean;
  /** 省略的行数（仅截断时有效） */
  omittedLines: number;
};

/**
 * 读取文件并提取指定行范围，超过阈值时自动截断中间部分。
 *
 * 用于 {{editor_selection}}、{{active_file}}、{{attached_files}} 等宏，
 * 保证确定性的输出以支持模型输入缓存。
 */
export function readFileContent(options: ReadFileContentOptions): ReadFileContentResult {
  const { filePath, maxLines = 100, headLines = 50, tailLines = 20 } = options;
  const raw = fs.readFileSync(filePath, "utf8");
  const allLines = raw.split("\n");
  const totalLines = allLines.length;

  const startIdx = options.startLine ? Math.max(options.startLine - 1, 0) : 0;
  const endIdx = options.endLine ? Math.min(options.endLine, totalLines) : totalLines;

  if (startIdx >= endIdx) {
    return { content: "", totalLines, truncated: false, omittedLines: 0 };
  }

  const rangeLines = allLines.slice(startIdx, endIdx);
  const rangeTotal = rangeLines.length;

  if (rangeTotal <= maxLines) {
    return {
      content: rangeLines.join("\n"),
      totalLines,
      truncated: false,
      omittedLines: 0,
    };
  }

  const omitted = rangeTotal - headLines - tailLines;
  const head = rangeLines.slice(0, headLines);
  const tail = rangeLines.slice(rangeTotal - tailLines);

  return {
    content: [...head, `// ... (${omitted} lines omitted) ...`, ...tail].join("\n"),
    totalLines,
    truncated: true,
    omittedLines: omitted,
  };
}
