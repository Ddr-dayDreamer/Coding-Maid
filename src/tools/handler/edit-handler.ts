import * as fs from "fs";
import { z } from "zod";
import type { ToolExecutionContext, ToolExecutionResult } from "../types";
import {
  buildDiffPreview,
  readTextFileWithMetadata,
  writeTextFile,
} from "../../utils/file-utils";
import type { FileReadMetadata } from "../../utils/file-utils";
import { executeValidatedTool } from "../../utils/runtime";
import {
  getFileState,
  isAbsoluteFilePath,
  markFileRead,
  normalizeFilePath,
} from "../../utils/state";

const MIN_FUZZY_SCORE = 0.8;
const CLOSEST_MATCH_CONTEXT_LINES = 2;


type LineIndex = {
  lines: string[];
  lineStarts: number[];
};

type SearchScope = {
  filePath: string;
  startOffset: number;
  endOffset: number;
  startLine: number;
  endLine: number;
};

type MatchOccurrence = {
  startOffset: number;
  endOffset: number;
  startLine: number;
  endLine: number;
};

type ClosestMatch = {
  text: string;
  startLine: number;
  endLine: number;
  score: number;
  strategy: "loose_escape" | "fuzzy_window";
};

type LooseEscapeMatch = MatchOccurrence & {
  text: string;
  score: number;
};

function optionalInt(min: number) {
  return z.preprocess(
    (value) => {
      if (value === undefined || value === null || value === "") {
        return undefined;
      }
      if (typeof value === "string") {
        return Number(value);
      }
      return value;
    },
    z.number().int().min(min, `value must be >= ${min}.`).optional()
  );
}

const editSchema = z.strictObject({
  file_path: z.string(),
  old_string: z.string(),
  new_string: z.string(),
  start_line: optionalInt(1),
  end_line: optionalInt(1),
  expected_start_line: optionalInt(1),
});

export async function handleEditTool(
  args: Record<string, unknown>,
  context: ToolExecutionContext
): Promise<ToolExecutionResult> {
  return executeValidatedTool(
    "edit",
    editSchema,
    args,
    context,
    async (input) => {
      const filePath = normalizeFilePath(input.file_path);
      if (!isAbsoluteFilePath(filePath)) {
        return {
          ok: false,
          name: "edit",
          error: "file_path must be an absolute path.",
        };
      }

      if (input.old_string === "") {
        return {
          ok: false,
          name: "edit",
          error: "old_string cannot be empty.",
        };
      }

      if (input.old_string === input.new_string) {
        return {
          ok: false,
          name: "edit",
          error: "new_string must differ from old_string.",
        };
      }

      if (!fs.existsSync(filePath)) {
        return {
          ok: false,
          name: "edit",
          error: `File not found: ${filePath}`,
        };
      }

      let stat: fs.Stats;
      try {
        stat = fs.statSync(filePath);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          ok: false,
          name: "edit",
          error: `Failed to stat file: ${message}`,
        };
      }

      if (stat.isDirectory()) {
        return {
          ok: false,
          name: "edit",
          error: "file_path points to a directory.",
        };
      }

      const fileState = getFileState(context.sessionId, filePath);
      if (!fileState) {
        return {
          ok: false,
          name: "edit",
          error: "Must read file first.",
        };
      }

      let metadata: FileReadMetadata;
      try {
        metadata = readTextFileWithMetadata(filePath);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          ok: false,
          name: "edit",
          error: `Failed to read file: ${message}`,
        };
      }

      // Simple staleness check
      if (metadata.timestamp > fileState.timestamp && metadata.content !== fileState.content) {
        return {
          ok: false,
          name: "edit",
          error: "File modified since read. Re-read it first.",
        };
      }

      try {
        const raw = metadata.content;
        const oldString = input.old_string;
        const newString = input.new_string;
        const lineIndex = buildLineIndex(raw);
        const scope = buildSearchScope(filePath, raw, lineIndex, input.start_line ?? null, input.end_line ?? null);
        let matches = findOccurrences(raw, oldString, scope, lineIndex.lineStarts);
        let matchedVia:
          | "exact"
          | "line_number_prefix_correction"
          | "loose_escape"
          | "whitespace_normalized" = "exact";
        let replacementOldString = oldString;
        let replacementNewString = newString;

        // ── Phase 2: Line number prefix stripping ──────────────
        // AI may copy Read tool output which includes line numbers.
        if (matches.length === 0) {
          const strippedOld = stripReadLineNumberPrefixes(oldString);
          if (strippedOld !== oldString) {
            const strippedMatches = findOccurrences(raw, strippedOld, scope, lineIndex.lineStarts);
            if (strippedMatches.length >= 1) {
              matches = strippedMatches;
              matchedVia = "line_number_prefix_correction";
              replacementOldString = strippedOld;
              replacementNewString = stripReadLineNumberPrefixes(newString);
            }
          }
        }

        // ── Phase 3: Loose escape matching (improved threshold) ─
        // Handles JSON escape differences (e.g., double-escaped quotes).
        if (matches.length === 0) {
          const looseEscapeMatches = findLooseEscapeMatches(raw, oldString, scope, lineIndex.lineStarts);
          const bestLoose =
            looseEscapeMatches.length === 1
              ? looseEscapeMatches[0]
              : looseEscapeMatches.length > 1
                ? looseEscapeMatches.reduce((a, b) => (a.score > b.score ? a : b))
                : null;
          if (bestLoose && bestLoose.score >= 0.85) {
            matches = [bestLoose];
            matchedVia = "loose_escape";
            replacementOldString = bestLoose.text;
          }
        }

        // ── Phase 4: Whitespace-normalized matching ─────────────
        // Handles indent differences (tab/space, extra spaces, etc.)
        if (matches.length === 0) {
          const wsMatches = findWhitespaceNormalizedMatches(raw, oldString, scope, lineIndex.lineStarts, lineIndex);
          if (wsMatches.length === 1) {
            matches = wsMatches;
            matchedVia = "whitespace_normalized";
          }
        }

        // ── All matching failed ─────────────────────────────────
        if (matches.length === 0) {
          const closestMatch = findClosestMatch(raw, oldString, scope, lineIndex);
          return {
            ok: false,
            name: "edit",
            error: "old_string not found in file.",
            metadata: closestMatch
              ? {
                  scope: formatScopeMetadata(scope),
                  closest_match: buildClosestMatchMetadata(filePath, closestMatch),
                }
              : {
                  scope: formatScopeMetadata(scope),
                },
          };
        }

        if (matches.length > 1) {
          return {
            ok: false,
            name: "edit",
            error:
              "old_string is not unique. Use start_line/end_line to scope, or expected_start_line as a safety check.",
            metadata: {
              match_count: matches.length,
              scope: formatScopeMetadata(scope),
              candidates: matches.slice(0, 5).map((m) => ({
                start_line: m.startLine,
                end_line: m.endLine,
                preview: buildPreview(lineIndex.lines, m.startLine, m.endLine),
              })),
            },
          };
        }

        const expectedStartLine = input.expected_start_line ?? null;
        if (expectedStartLine !== null && matches[0].startLine !== expectedStartLine) {
          return {
            ok: false,
            name: "edit",
            error: `old_string found at line ${matches[0].startLine}, but expected_start_line is ${expectedStartLine}.`,
            metadata: {
              match_count: matches.length,
              scope: formatScopeMetadata(scope),
              actual_start_line: matches[0].startLine,
              expected_start_line: expectedStartLine,
            },
          };
        }

        const updated = applyReplacement(raw, replacementOldString, replacementNewString, matches);
        const diffPreview = buildDiffPreview(filePath, raw, updated);
        context.onBeforeFileMutation?.(filePath);

        try {
          writeTextFile(filePath, updated, metadata.encoding, metadata.lineEndings);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          return {
            ok: false,
            name: "edit",
            error: `Write failed: ${message}`,
          };
        }

        context.onAfterFileMutation?.(filePath);

        let freshMetadata: FileReadMetadata;
        try {
          freshMetadata = readTextFileWithMetadata(filePath);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          return {
            ok: false,
            name: "edit",
            error: `State sync failed: ${message}`,
          };
        }

        console.log("[DEBUG] edit-handler: calling onEditApplied", filePath);
        context.onEditApplied?.(filePath, diffPreview ?? "");

        markFileRead(context.sessionId, filePath, {
          content: freshMetadata.content,
          timestamp: freshMetadata.timestamp,
          encoding: freshMetadata.encoding,
          lineEndings: freshMetadata.lineEndings,
        });
        return {
          ok: true,
          name: "edit",
          output: `Replaced 1 occurrence(s) in ${filePath}.`,
          metadata: {
            file_path: filePath,
            replaced_count: 1,
            matched_via: matchedVia,
            encoding: freshMetadata.encoding,
            line_endings: freshMetadata.lineEndings,
            diff_preview: diffPreview,
            scope: formatScopeMetadata(scope),
          },
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          ok: false,
          name: "edit",
          error: `Unexpected error: ${message}`,
        };
      }
    },
    {
      preprocess: (rawInput) => {
        const nextInput = { ...rawInput };
        if (typeof nextInput.file_path === "string") {
          nextInput.file_path = normalizeFilePath(nextInput.file_path);
        }
        return { ok: true, input: nextInput };
      },
    }
  );
}

function buildLineIndex(raw: string): LineIndex {
  const lines = raw.split(/\r?\n/);
  const lineStarts = new Array<number>(lines.length + 2).fill(raw.length);
  let cursor = 0;

  for (let index = 0; index < lines.length; index += 1) {
    lineStarts[index + 1] = cursor;
    cursor += lines[index].length;
    if (index < lines.length - 1) {
      if (raw.slice(cursor, cursor + 2) === "\r\n") {
        cursor += 2;
      } else if (raw[cursor] === "\n") {
        cursor += 1;
      }
    }
  }

  lineStarts[lines.length + 1] = raw.length;
  return { lines, lineStarts };
}

function buildSearchScope(
  filePath: string,
  raw: string,
  lineIndex: LineIndex,
  startLine: number | null,
  endLine: number | null,
): SearchScope {
  if (startLine !== null && endLine !== null) {
    const safeStart = clamp(startLine, 1, lineIndex.lines.length);
    const safeEnd = clamp(endLine, safeStart, lineIndex.lines.length);
    return {
      filePath,
      startOffset: lineIndex.lineStarts[safeStart],
      endOffset: lineIndex.lineStarts[safeEnd + 1],
      startLine: safeStart,
      endLine: safeEnd,
    };
  }

  return {
    filePath,
    startOffset: 0,
    endOffset: raw.length,
    startLine: 1,
    endLine: lineIndex.lines.length,
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function findOccurrences(
  raw: string,
  needle: string,
  scope: SearchScope,
  lineStarts: number[]
): MatchOccurrence[] {
  if (!raw || !needle) {
    return [];
  }

  const scopeText = raw.slice(scope.startOffset, scope.endOffset);
  const matches: MatchOccurrence[] = [];
  let searchIndex = 0;

  while (true) {
    const found = scopeText.indexOf(needle, searchIndex);
    if (found === -1) {
      break;
    }
    const startOffset = scope.startOffset + found;
    const endOffset = startOffset + needle.length;
    matches.push({
      startOffset,
      endOffset,
      startLine: offsetToLine(lineStarts, startOffset),
      endLine: offsetToLine(lineStarts, Math.max(startOffset, endOffset - 1)),
    });
    searchIndex = found + needle.length;
  }

  return matches;
}

function findLooseEscapeMatches(
  raw: string,
  needle: string,
  scope: SearchScope,
  lineStarts: number[]
): LooseEscapeMatch[] {
  if (!raw || !needle) {
    return [];
  }

  const scopeText = raw.slice(scope.startOffset, scope.endOffset);
  const looseEscapeRegex = buildLooseEscapeRegex(needle);
  if (!looseEscapeRegex) {
    return [];
  }

  const normalizedNeedle = normalizeLooseText(needle);
  const matches: LooseEscapeMatch[] = [];
  for (const match of scopeText.matchAll(looseEscapeRegex)) {
    if (typeof match.index !== "number") {
      continue;
    }

    const text = match[0];
    const startOffset = scope.startOffset + match.index;
    const endOffset = startOffset + text.length;
    matches.push({
      text,
      score: similarityScore(normalizedNeedle, normalizeLooseText(text)),
      startOffset,
      endOffset,
      startLine: offsetToLine(lineStarts, startOffset),
      endLine: offsetToLine(lineStarts, Math.max(startOffset, endOffset - 1)),
    });
  }

  return matches;
}

/**
 * Try to match old_string against file content after normalizing all
 * consecutive whitespace to a single space. This handles common AI mistakes:
 * - Tab vs space indentation differences
 * - Extra/missing spaces
 * - Trailing whitespace differences
 *
 * Only returns matches when EXACTLY ONE unique range matches.
 */
function findWhitespaceNormalizedMatches(
  raw: string,
  needle: string,
  scope: SearchScope,
  lineStarts: number[],
  lineIndex: LineIndex,
): MatchOccurrence[] {
  const normalizeWs = (s: string) => s.replace(/[ \t]+/g, " ").replace(/^ | $/gm, "").trim();
  const normalizedNeedle = normalizeWs(needle);
  if (!normalizedNeedle) return [];

  const needleLineCount = needle.split(/\r?\n/).length;
  const maxStartLine = scope.endLine - needleLineCount + 1;
  const matches: MatchOccurrence[] = [];

  for (let startLine = scope.startLine; startLine <= maxStartLine; startLine++) {
    const endLine = startLine + needleLineCount - 1;
    const candidateText = sliceLines(raw, lineIndex, startLine, endLine);
    if (normalizeWs(candidateText) === normalizedNeedle) {
      const startOffset = lineStarts[startLine];
      const endOffset = lineStarts[endLine + 1];
      matches.push({ startOffset, endOffset, startLine, endLine });
    }
  }

  return matches;
}

function offsetToLine(lineStarts: number[], offset: number): number {
  if (offset <= 0) {
    return 1;
  }

  let lo = 1;
  let hi = lineStarts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >>> 1;
    if (lineStarts[mid] <= offset) {
      lo = mid;
    } else {
      hi = mid - 1;
    }
  }
  return lo;
}

function applyReplacement(
  raw: string,
  oldString: string,
  newString: string,
  matches: MatchOccurrence[],
): string {
  return raw.slice(0, matches[0].startOffset) + newString + raw.slice(matches[0].endOffset);
}

/**
 * Strip Read tool-style line number prefixes from each line.
 *
 * Read output format: "     6\tcontent"  (6-wide line number + tab + content)
 * If the AI accidentally included the line number prefix in old_string,
 * this will remove it and allow matching against the raw file content.
 */
function stripReadLineNumberPrefixes(value: string): string {
  // Pattern: optional leading whitespace + digits + tab, at line start
  return value.replace(/^[ \t]*\d+\t/gm, "");
}

function buildClosestMatchMetadata(
  filePath: string,
  closestMatch: ClosestMatch
): Record<string, unknown> {
  const preview = formatWithLineNumbers(closestMatch.text.split(/\r?\n/), closestMatch.startLine);

  return {
    start_line: closestMatch.startLine,
    end_line: closestMatch.endLine,
    similarity: Number(closestMatch.score.toFixed(3)),
    strategy: closestMatch.strategy,
    preview,
  };
}

function formatScopeMetadata(scope: SearchScope): Record<string, unknown> {
  return {
    file_path: scope.filePath,
    start_line: scope.startLine,
    end_line: scope.endLine,
  };
}

function buildPreview(lines: string[], startLine: number, endLine: number): string {
  const selected = lines.slice(startLine - 1, endLine);
  return formatWithLineNumbers(selected, startLine);
}

function formatWithLineNumbers(lines: string[], startLine: number): string {
  return lines.map((line, index) => `${String(startLine + index).padStart(6, " ")}\t${line}`).join("\n");
}

function findClosestMatch(
  raw: string,
  oldString: string,
  scope: SearchScope,
  lineIndex: LineIndex
): ClosestMatch | null {
  const looseEscapeMatches = findLooseEscapeMatches(raw, oldString, scope, lineIndex.lineStarts);
  if (looseEscapeMatches.length > 0) {
    let bestLooseMatch: ClosestMatch | null = null;
    for (const match of looseEscapeMatches) {
      const candidate: ClosestMatch = {
        text: match.text,
        startLine: match.startLine,
        endLine: match.endLine,
        score: match.score,
        strategy: "loose_escape",
      };
      if (!bestLooseMatch || candidate.score > bestLooseMatch.score) {
        bestLooseMatch = candidate;
      }
    }

    if (bestLooseMatch && bestLooseMatch.score >= MIN_FUZZY_SCORE) {
      return expandClosestMatch(raw, lineIndex, scope, bestLooseMatch);
    }
  }

  const targetLineCount = Math.max(1, oldString.split(/\r?\n/).length);
  const windowSizes = Array.from(new Set([Math.max(1, targetLineCount - 1), targetLineCount, targetLineCount + 1]));
  const normalizedTarget = normalizeLooseText(oldString);

  let bestMatch: ClosestMatch | null = null;
  for (let startLine = scope.startLine; startLine <= scope.endLine; startLine += 1) {
    for (const windowSize of windowSizes) {
      const endLine = startLine + windowSize - 1;
      if (endLine > scope.endLine) {
        continue;
      }

      const candidateText = sliceLines(raw, lineIndex, startLine, endLine);
      const score = similarityScore(normalizedTarget, normalizeLooseText(candidateText));
      if (score < MIN_FUZZY_SCORE) {
        continue;
      }

      const candidate: ClosestMatch = {
        text: candidateText,
        startLine,
        endLine,
        score,
        strategy: "fuzzy_window",
      };

      if (!bestMatch || candidate.score > bestMatch.score) {
        bestMatch = candidate;
      }
    }
  }

  return bestMatch ? expandClosestMatch(raw, lineIndex, scope, bestMatch) : null;
}

function expandClosestMatch(
  raw: string,
  lineIndex: LineIndex,
  scope: SearchScope,
  closestMatch: ClosestMatch
): ClosestMatch {
  const startLine = clamp(closestMatch.startLine - CLOSEST_MATCH_CONTEXT_LINES, scope.startLine, scope.endLine);
  const endLine = clamp(closestMatch.endLine + CLOSEST_MATCH_CONTEXT_LINES, startLine, scope.endLine);
  return {
    ...closestMatch,
    text: sliceLines(raw, lineIndex, startLine, endLine),
    startLine,
    endLine,
  };
}

function buildLooseEscapeRegex(source: string): RegExp | null {
  if (!source) {
    return null;
  }

  let pattern = "";
  for (let index = 0; index < source.length; index += 1) {
    if (source[index] === "\\") {
      let slashEnd = index;
      while (slashEnd < source.length && source[slashEnd] === "\\") {
        slashEnd += 1;
      }

      if (slashEnd < source.length) {
        pattern += "\\\\*";
        pattern += escapeRegExp(source[slashEnd]);
        index = slashEnd;
        continue;
      }

      pattern += escapeRegExp(source.slice(index, slashEnd));
      index = slashEnd - 1;
      continue;
    }

    pattern += escapeRegExp(source[index]);
  }

  return new RegExp(pattern, "g");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeLooseText(value: string): string {
  return value
    .replace(/\r\n?/g, "\n")
    .replace(/\\+(?=["'`\\])/g, "")
    .replace(/[ \t]+/g, " ")
    .trim();
}

function similarityScore(left: string, right: string): number {
  if (left === right) {
    return 1;
  }
  if (!left || !right) {
    return 0;
  }

  const leftBigrams = toBigrams(left);
  const rightBigrams = toBigrams(right);
  if (leftBigrams.length === 0 || rightBigrams.length === 0) {
    return left === right ? 1 : 0;
  }

  const rightCounts = new Map<string, number>();
  for (const bigram of rightBigrams) {
    rightCounts.set(bigram, (rightCounts.get(bigram) ?? 0) + 1);
  }

  let overlap = 0;
  for (const bigram of leftBigrams) {
    const count = rightCounts.get(bigram) ?? 0;
    if (count > 0) {
      overlap += 1;
      rightCounts.set(bigram, count - 1);
    }
  }

  return (2 * overlap) / (leftBigrams.length + rightBigrams.length);
}

function toBigrams(value: string): string[] {
  if (value.length < 2) {
    return [value];
  }

  const result: string[] = [];
  for (let index = 0; index < value.length - 1; index += 1) {
    result.push(value.slice(index, index + 2));
  }
  return result;
}

function sliceLines(raw: string, lineIndex: LineIndex, startLine: number, endLine: number): string {
  const startOffset = lineIndex.lineStarts[startLine];
  const endOffset = lineIndex.lineStarts[endLine + 1];
  return raw.slice(startOffset, endOffset);
}
