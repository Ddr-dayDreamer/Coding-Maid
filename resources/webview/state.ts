import type { SessionSummary, TokenTelemetry, LlmStreamProgressData } from "./types";

// ─── VS Code API ─────────────────────────────────────────

declare function acquireVsCodeApi(): {
  postMessage(msg: unknown): void;
  getState(): Record<string, unknown> | undefined;
  setState(state: Record<string, unknown> | undefined): void;
};

export const vscode = acquireVsCodeApi();

// ─── DOM 元素缓存 ────────────────────────────────────────

export const $ = {
  app: document.querySelector(".app") as HTMLElement,
  messages: document.getElementById("messages") as HTMLElement,
  inputWrap: document.querySelector(".input-wrap") as HTMLElement,
  toolsLine: document.querySelector(".tools-line") as HTMLElement,
  promptInput: document.getElementById("prompt") as HTMLTextAreaElement,
  sendButton: document.getElementById("send") as HTMLButtonElement,
  loading: document.getElementById("loading") as HTMLElement,
  sessionSelector: document.getElementById("sessionSelector") as HTMLElement,
  sessionSelectorTitle: document.getElementById("sessionSelectorTitle") as HTMLElement,
  sessionSelectorTitleText: document.getElementById("sessionSelectorTitleText") as HTMLElement,
  sessionDropdown: document.getElementById("sessionDropdown") as HTMLElement,
  newSessionBtn: document.getElementById("newSessionBtn") as HTMLButtonElement,
  sendIcon: document.getElementById("sendIcon") as HTMLElement,
  stopIcon: document.getElementById("stopIcon") as HTMLElement,
  contextMeter: document.getElementById("contextMeter") as HTMLElement,
  contextMeterRing: document.getElementById("contextMeterRing") as HTMLElement,
  contextMeterTooltip: document.getElementById("contextMeterTooltip") as HTMLElement,
  chatContainer: document.getElementById("chatContainer") as HTMLElement,
};

// ─── 全局状态 ────────────────────────────────────────────

export const state = {
  currentSessionId: null as string | null,
  currentSessionStatus: null as string | null,
  allSessions: [] as SessionSummary[],
  lastMessageRole: null as string | null,
  currentThinkingBubble: null as HTMLElement | null,
  currentRunningProcesses: null as Record<string, { startTime: string; command: string }> | null,
  currentLlmStreamProgress: null as LlmStreamProgressData | null,
  currentTokenTelemetry: null as TokenTelemetry | null,
  promptMinRows: Number($.promptInput?.getAttribute("rows") as string) || 3,
  promptMaxRows: 10,
};

// ─── 提示词历史导航 ──────────────────────────────────────

export const history = {
  inputHistory: [] as string[],
  cursor: -1,
  draftBeforeHistory: null as string | null,
  pendingUserPrompt: null as string | null,
  lastRecordText: "",
  lastRecordAt: 0,
};
