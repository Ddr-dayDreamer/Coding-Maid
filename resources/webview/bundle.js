"use strict";
(() => {
  // resources/webview/state.ts
  var vscode = acquireVsCodeApi();
  var $ = {
    app: document.querySelector(".app"),
    messages: document.getElementById("messages"),
    inputWrap: document.querySelector(".input-wrap"),
    toolsLine: document.querySelector(".tools-line"),
    promptInput: document.getElementById("prompt"),
    sendButton: document.getElementById("send"),
    loading: document.getElementById("loading"),
    sessionSelector: document.getElementById("sessionSelector"),
    sessionSelectorTitle: document.getElementById("sessionSelectorTitle"),
    sessionSelectorTitleText: document.getElementById("sessionSelectorTitleText"),
    sessionDropdown: document.getElementById("sessionDropdown"),
    newSessionBtn: document.getElementById("newSessionBtn"),
    sendIcon: document.getElementById("sendIcon"),
    stopIcon: document.getElementById("stopIcon"),
    contextMeter: document.getElementById("contextMeter"),
    contextMeterRing: document.getElementById("contextMeterRing"),
    contextMeterTooltip: document.getElementById("contextMeterTooltip"),
    chatContainer: document.getElementById("chatContainer"),
  };
  var state = {
    currentSessionId: null,
    currentSessionStatus: null,
    allSessions: [],
    lastMessageRole: null,
    currentThinkingBubble: null,
    currentRunningProcesses: null,
    currentLlmStreamProgress: null,
    currentTokenTelemetry: null,
    promptMinRows: Number($.promptInput?.getAttribute("rows")) || 3,
    promptMaxRows: 10,
  };
  var history = {
    inputHistory: [],
    cursor: -1,
    draftBeforeHistory: null,
    pendingUserPrompt: null,
    lastRecordText: "",
    lastRecordAt: 0,
  };

  // resources/webview/utils/formatting.ts
  var _workspaceRoot = "";
  function setWorkspaceRoot(root) {
    _workspaceRoot = root;
  }
  function formatDisplayPath(filePath) {
    if (!filePath) return "";
    const normalized = normalizePath(filePath);
    if (_workspaceRoot && normalized.startsWith(_workspaceRoot)) {
      const relative = normalized.slice(_workspaceRoot.length).replace(/^[/\\]/, "");
      return relative || normalized;
    }
    return normalized;
  }
  function normalizePath(value) {
    if (!value) return value;
    return value.replace(/\\/g, "/");
  }
  function formatSessionDate(dateString) {
    const date = new Date(dateString);
    const today = /* @__PURE__ */ new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    const startOfWeek = new Date(today);
    startOfWeek.setDate(today.getDate() - today.getDay());
    if (isSameDay(date, today)) return "\u4ECA\u5929";
    if (isSameDay(date, yesterday)) return "\u6628\u5929";
    if (date >= startOfWeek) return "\u672C\u5468";
    return "\u66F4\u65E9";
  }
  function formatSessionTime(dateString) {
    const date = new Date(dateString);
    const today = /* @__PURE__ */ new Date();
    const diffTime = today.getTime() - date.getTime();
    const diffDays = Math.floor(diffTime / (1e3 * 60 * 60 * 24));
    if (diffDays === 0) {
      return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    }
    return `${date.getMonth() + 1}/${date.getDate()}`;
  }
  function isSameDay(a, b) {
    return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  }

  // resources/webview/components/composer.ts
  function initComposer() {
    $.promptInput.addEventListener("input", onInput);
    $.promptInput.addEventListener("keydown", onKeyDown);
    $.sendButton.addEventListener("click", onSendClick);
    const savedState = vscode.getState();
    if (savedState?.promptText) {
      $.promptInput.value = savedState.promptText || "";
      autoResize();
      updateSendIconState2();
    }
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") {
        vscode.setState({ promptText: $.promptInput.value });
      }
    });
    updateSendIconState2();
  }
  function onInput() {
    exitHistoryBrowsing();
    autoResize();
    updateSendIconState2();
  }
  function onKeyDown(e) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendPrompt();
      return;
    }
    if (e.key === "ArrowUp" && $.promptInput.selectionStart === 0 && $.promptInput.selectionEnd === 0) {
      e.preventDefault();
      navigateHistory(-1);
      return;
    }
    if (e.key === "ArrowDown" && $.promptInput.selectionStart === $.promptInput.value.length) {
      e.preventDefault();
      navigateHistory(1);
      return;
    }
  }
  function onSendClick() {
    sendPrompt();
  }
  function isProcessing() {
    return state.currentSessionStatus === "processing" || state.currentSessionStatus === "pending";
  }
  function sendPrompt() {
    if (isProcessing()) {
      vscode.postMessage({ type: "interrupt" });
      state.currentSessionStatus = "interrupted";
      setLoading(false);
      return;
    }
    const text = $.promptInput.value.trim();
    const imageUrls = getAttachedImageUrls();
    if ((!text && imageUrls.length === 0) || $.sendButton.disabled) return;
    $.promptInput.value = "";
    vscode.setState({ promptText: "" });
    autoResize();
    updateSendIconState2();
    vscode.postMessage({
      type: "userPrompt",
      prompt: text,
      images: imageUrls.length > 0 ? imageUrls : void 0,
    });
    history.pendingUserPrompt = text || (imageUrls.length > 0 ? "\u7C98\u8D34\u7684\u56FE\u50CF" : "");
    attachmentManager?.clear();
    updateSendIconState2();
  }
  function getLineHeight() {
    const computed = window.getComputedStyle($.promptInput);
    const fontSize = parseFloat(computed.fontSize) || 16;
    const lineHeight = parseFloat(computed.lineHeight) || fontSize * 1.2;
    return lineHeight;
  }
  function getVerticalSize() {
    const computed = window.getComputedStyle($.promptInput);
    const paddingTop = parseFloat(computed.paddingTop) || 0;
    const paddingBottom = parseFloat(computed.paddingBottom) || 0;
    const borderTop = parseFloat(computed.borderTopWidth) || 0;
    const borderBottom = parseFloat(computed.borderBottomWidth) || 0;
    return paddingTop + paddingBottom + borderTop + borderBottom;
  }
  function autoResize() {
    const lineHeight = getLineHeight();
    const vertical = getVerticalSize();
    $.promptInput.style.height = "0";
    const scrollHeight = $.promptInput.scrollHeight;
    const minHeight = lineHeight * state.promptMinRows + vertical;
    const maxHeight = lineHeight * state.promptMaxRows + vertical;
    const clamped = Math.max(minHeight, Math.min(scrollHeight, maxHeight));
    $.promptInput.style.height = `${clamped}px`;
  }
  function updateSendIconState2() {
    const hasText = $.promptInput.value.trim().length > 0;
    const hasImages = getAttachedImageUrls().length > 0;
    const disabled = !hasText && !hasImages;
    $.sendButton.disabled = disabled;
    $.sendButton.classList.toggle("disabled", disabled);
  }
  function setLoading(isLoading) {
    $.loading.classList.toggle("active", isLoading);
    $.sendIcon.classList.toggle("hidden", isLoading);
    $.stopIcon.classList.toggle("hidden", !isLoading);
  }
  var attachmentManager = null;
  function getAttachedImageUrls() {
    return attachmentManager?.getImageUrls() ?? [];
  }
  function initAttachmentManager() {
    if (typeof window.createPromptAttachmentManager === "function") {
      attachmentManager = window.createPromptAttachmentManager({
        promptInput: $.promptInput,
        inputWrap: $.inputWrap,
        toolsLine: $.toolsLine,
        onAttachmentChange: () => {
          updateSendIconState2();
        },
      });
    }
  }
  function navigateHistory(direction) {
    if (history.inputHistory.length === 0) return;
    if (history.cursor === -1) {
      history.draftBeforeHistory = $.promptInput.value;
    }
    const newCursor = history.cursor + direction;
    if (newCursor < -1 || newCursor >= history.inputHistory.length) return;
    history.cursor = newCursor;
    if (newCursor === -1) {
      $.promptInput.value = history.draftBeforeHistory || "";
      history.draftBeforeHistory = null;
    } else {
      $.promptInput.value = history.inputHistory[history.inputHistory.length - 1 - newCursor];
    }
    autoResize();
    updateSendIconState2();
    const len = $.promptInput.value.length;
    $.promptInput.setSelectionRange(len, len);
  }
  function exitHistoryBrowsing() {
    if (history.cursor === -1) return;
    history.cursor = -1;
    history.draftBeforeHistory = null;
  }

  // resources/webview/components/context-meter.ts
  function updateContextMeter(telemetry) {
    if (!telemetry) {
      $.contextMeter.style.display = "none";
      return;
    }
    $.contextMeter.style.display = "";
    const percent = getTokenUsagePercent(telemetry);
    $.contextMeterRing.style.setProperty("--context-percent", `${percent}%`);
    const tooltip = renderTooltip(telemetry, percent);
    $.contextMeterTooltip.innerHTML = tooltip;
  }
  function getTokenUsagePercent(telemetry) {
    const active = telemetry.activeTokens || 0;
    const base = 1e6;
    const pct = (active / base) * 100;
    return Math.min(100, Math.max(0, Math.round(pct * 10) / 10));
  }
  function formatTokenCount(value) {
    return value.toLocaleString();
  }
  function renderTooltip(telemetry, percent) {
    const parts = [];
    parts.push(`<div><strong>${telemetry.model || "Unknown"}</strong></div>`);
    if (telemetry.thinkingEnabled) parts.push("<div>\u601D\u8003\u6A21\u5F0F: \u542F\u7528</div>");
    parts.push(`<div>\u6D3B\u8DC3 Token: ${formatTokenCount(telemetry.activeTokens || 0)}</div>`);
    parts.push(`<div>\u7528\u91CF: ${percent}%</div>`);
    const usage = telemetry.usage;
    if (usage) {
      parts.push(`<hr style="margin:4px 0;border:none;border-top:1px solid var(--border-color)">`);
      parts.push(`<div>Prompt: ${formatTokenCount(usage.prompt_tokens || 0)}</div>`);
      parts.push(`<div>\u8865\u5168: ${formatTokenCount(usage.completion_tokens || 0)}</div>`);
      parts.push(`<div>\u603B\u8BA1: ${formatTokenCount(usage.total_tokens || 0)}</div>`);
      const hit = usage.prompt_cache_hit_tokens;
      const miss = usage.prompt_cache_miss_tokens;
      if (hit !== void 0 || miss !== void 0) {
        const totalCache = (hit || 0) + (miss || 0);
        const rate = totalCache > 0 ? (((hit || 0) / totalCache) * 100).toFixed(1) : "--";
        parts.push(`<hr style="margin:4px 0;border:none;border-top:1px solid var(--border-color)">`);
        parts.push(`<div>\u7F13\u5B58\u547D\u4E2D: ${formatTokenCount(hit || 0)}</div>`);
        parts.push(`<div>\u7F13\u5B58\u672A\u547D\u4E2D: ${formatTokenCount(miss || 0)}</div>`);
        parts.push(`<div>\u547D\u4E2D\u7387: ${rate}%</div>`);
      }
    }
    return parts.join("");
  }

  // resources/webview/components/session-list.ts
  function initSessionList() {
    $.sessionSelector.addEventListener("click", (e) => {
      e.stopPropagation();
      toggleDropdown();
    });
    $.newSessionBtn.addEventListener("click", () => {
      closeDropdown();
      vscode.postMessage({ type: "createNewSession" });
      $.promptInput.value = "";
      updateSendIconState?.();
    });
    document.addEventListener("click", () => closeDropdown());
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && $.sessionDropdown.classList.contains("show")) {
        closeDropdown();
      }
    });
  }
  function toggleDropdown() {
    const isOpen = $.sessionDropdown.classList.toggle("show");
    $.sessionSelector.classList.toggle("open", isOpen);
  }
  function closeDropdown() {
    $.sessionDropdown.classList.remove("show");
    $.sessionSelector.classList.remove("open");
  }
  function updateSessionDropdown(sessions) {
    state.allSessions = sessions;
    const searchHtml = `<div class="session-search"><input type="text" id="sessionSearch" placeholder="\u641C\u7D22\u4F1A\u8BDD..." /></div>`;
    const listHtml = renderFilteredSessions(sessions, "");
    $.sessionDropdown.innerHTML = searchHtml + listHtml;
    const searchInput = document.getElementById("sessionSearch");
    if (searchInput) {
      searchInput.addEventListener("input", () => {
        const query = searchInput.value;
        const listEl = $.sessionDropdown.querySelector(".session-list-wrap");
        if (listEl) {
          listEl.innerHTML = renderFilteredSessions(sessions, query);
          bindSessionClickHandlers();
        }
      });
      $.sessionSelector.addEventListener("click", () => {
        setTimeout(() => searchInput?.focus(), 50);
      });
    }
    bindSessionClickHandlers();
  }
  function renderFilteredSessions(sessions, query) {
    const filtered = sessions.filter((s) => {
      if (!query) return true;
      const q = query.toLowerCase();
      return s.summary.toLowerCase().includes(q);
    });
    const groups = {};
    for (const s of filtered) {
      const label = formatSessionDate(s.createTime);
      if (!groups[label]) groups[label] = [];
      groups[label].push(s);
    }
    const order = ["\u4ECA\u5929", "\u6628\u5929", "\u672C\u5468", "\u66F4\u65E9"];
    const escaped = (text) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    let html = '<div class="session-list-wrap">';
    for (const label of order) {
      const items = groups[label];
      if (!items) continue;
      html += `<div class="session-group-label">${label}</div>`;
      for (const s of items) {
        const isActive = s.id === state.currentSessionId;
        const highlighted = query
          ? escaped(s.summary).replace(new RegExp(escapeRegExp(query), "gi"), (m) => `<mark>${m}</mark>`)
          : escaped(s.summary);
        html += `<div class="session-item ${isActive ? "active" : ""}" data-session-id="${s.id}">
        <div class="session-item-summary">${highlighted || "\u7A7A\u5BF9\u8BDD"}</div>
        <div class="session-item-time">${formatSessionTime(s.createTime)}</div>
      </div>`;
      }
    }
    html += "</div>";
    return html;
  }
  function bindSessionClickHandlers() {
    $.sessionDropdown.querySelectorAll(".session-item").forEach((el) => {
      el.addEventListener("click", (e) => {
        e.stopPropagation();
        const sessionId = el.dataset.sessionId;
        if (sessionId) {
          closeDropdown();
          vscode.postMessage({ type: "selectSession", sessionId });
        }
      });
    });
  }
  function escapeRegExp(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
  function updateSessionTitle(summary) {
    $.sessionSelectorTitleText.textContent = summary?.slice(0, 100) || "New Chat";
  }

  // resources/webview/components/chat-view.ts
  function addMessageBubble(msg, shouldConnect) {
    const content = msg.content ?? "";
    const role = msg.role;
    const meta = msg.meta || {};
    if (msg.visible === false) return;
    const bubble = document.createElement("div");
    bubble.className = `bubble bubble-${role}`;
    bubble.dataset.messageId = msg.id;
    const isCollapsible = role === "system" || (role === "assistant" && meta.asThinking === true) || role === "tool";
    const isThinking = role === "assistant" && meta.asThinking === true;
    const isSkillBubble = !!(role === "system" && meta.skill);
    const defaultExpanded = isThinking && state.currentThinkingBubble === null;
    const dot = document.createElement("div");
    dot.className = `bubble-dot${shouldConnect ? " connect-to-prev" : ""}`;
    bubble.appendChild(dot);
    const body = document.createElement("div");
    body.className = "bubble-body";
    bubble.appendChild(body);
    if (isCollapsible) {
      const displayContent = isThinking ? (msg.html ?? content) : content;
      renderCollapsibleContent(body, displayContent, role, meta, defaultExpanded, isThinking, isSkillBubble, msg.html);
    } else {
      const contentDiv = document.createElement("div");
      contentDiv.className = "bubble-normal-content";
      if (role === "user") {
        contentDiv.textContent = content;
      } else {
        contentDiv.innerHTML = msg.html ?? content;
      }
      body.appendChild(contentDiv);
    }
    $.messages.appendChild(bubble);
    state.lastMessageRole = role;
    if (isThinking && defaultExpanded) {
      state.currentThinkingBubble = bubble;
    }
    scrollToBottom();
    if (shouldConnect) {
      requestAnimationFrame(() => updateAllConnectionLines());
    }
  }
  function renderCollapsibleContent(body, content, role, meta, defaultExpanded, isThinking, isSkillBubble, rawHtml) {
    const header = document.createElement("div");
    header.className = "bubble-collapsible-header";
    const toggle = document.createElement("span");
    toggle.className = "bubble-toggle";
    toggle.textContent = defaultExpanded ? "\u25BC" : "\u25B6";
    header.appendChild(toggle);
    const title = document.createElement("span");
    if (isSkillBubble) {
      title.textContent = `\u{1F9E0} ${meta.skill}`;
    } else if (isThinking) {
      const plainText = extractPlainText(content);
      title.textContent = plainText.slice(0, 80) || "\u601D\u8003\u4E2D...";
    } else if (role === "tool") {
      const paramsMd = meta.paramsMd;
      title.textContent = `\u{1F527} ${paramsMd || "\u5DE5\u5177\u8C03\u7528"}`;
    } else if (role === "system") {
      title.textContent = "\u7CFB\u7EDF\u6D88\u606F";
    }
    header.appendChild(title);
    body.appendChild(header);
    const contentDiv = document.createElement("div");
    contentDiv.className = "bubble-collapsible-content";
    contentDiv.style.display = defaultExpanded ? "block" : "none";
    if (role === "tool") {
      renderToolContent(contentDiv, content, meta);
    } else if (isThinking) {
      if (rawHtml) {
        contentDiv.innerHTML = rawHtml;
      } else {
        contentDiv.textContent = content;
      }
    } else if (role === "system") {
      contentDiv.textContent = content;
    } else {
      contentDiv.innerHTML = content;
    }
    body.appendChild(contentDiv);
    header.addEventListener("click", () => {
      const isNowExpanded = contentDiv.style.display !== "none";
      contentDiv.style.display = isNowExpanded ? "none" : "block";
      toggle.textContent = isNowExpanded ? "\u25B6" : "\u25BC";
      if (!isNowExpanded && isThinking) {
        state.currentThinkingBubble = null;
      }
      requestAnimationFrame(() => updateAllConnectionLines());
    });
  }
  function extractPlainText(html) {
    const tmp = document.createElement("div");
    tmp.innerHTML = html;
    return tmp.textContent || tmp.innerText || "";
  }
  function renderToolContent(container, content, meta) {
    const resultMd = meta.resultMd;
    if (resultMd) {
      const resultEl = document.createElement("div");
      resultEl.className = "tool-result-snippet";
      resultEl.textContent = resultMd.length > 500 ? resultMd.slice(0, 500) + "..." : resultMd;
      container.appendChild(resultEl);
    }
    try {
      const parsed = JSON.parse(content);
      if (parsed.metadata && typeof parsed.metadata === "object") {
        const md = parsed.metadata;
        if (md.file_path) {
          const pathEl = document.createElement("div");
          pathEl.className = "tool-file-path";
          pathEl.textContent = `\u{1F4C4} ${formatDisplayPath(md.file_path)}`;
          container.appendChild(pathEl);
        }
        if (md.diff_preview) {
          const diffEl = document.createElement("div");
          diffEl.className = "tool-diff-preview";
          diffEl.textContent = md.diff_preview;
          container.appendChild(diffEl);
        }
      }
    } catch {}
  }
  function updateAllConnectionLines() {
    document.querySelectorAll(".bubble-dot.connect-to-prev").forEach((dot) => {
      const dotEl = dot;
      const bubble = dotEl.closest(".bubble");
      if (!bubble) return;
      const prev = bubble.previousElementSibling;
      if (!prev) return;
      const prevDot = prev.querySelector(".bubble-dot");
      if (!prevDot) return;
      const prevRect = prevDot.getBoundingClientRect();
      const thisRect = dotEl.getBoundingClientRect();
      const height = thisRect.top - prevRect.bottom;
      dotEl.style.setProperty("--connector-height", `${Math.max(0, height)}px`);
    });
  }
  function scrollToBottom() {
    $.messages.scrollTop = $.messages.scrollHeight;
  }
  var streamBubble = null;
  var streamContent = "";
  var streamReasoningContent = "";
  function appendStreamChunk(content, reasoningContent) {
    if (!content && !reasoningContent) return;
    if (!streamBubble) {
      streamBubble = createStreamBubble();
      streamContent = "";
      streamReasoningContent = "";
    }
    if (content) {
      streamContent += content;
    }
    if (reasoningContent) {
      streamReasoningContent += reasoningContent;
    }
    const body = streamBubble.querySelector(".bubble-body");
    if (!body) return;
    body.innerHTML = "";
    if (streamReasoningContent) {
      const reasoningEl = document.createElement("div");
      reasoningEl.style.cssText = "color: var(--vscode-descriptionForeground); font-style: italic; margin-bottom: 8px;";
      reasoningEl.textContent = streamReasoningContent;
      body.appendChild(reasoningEl);
    }
    const contentEl = document.createElement("div");
    contentEl.className = "bubble-normal-content stream-content";
    contentEl.textContent = streamContent;
    body.appendChild(contentEl);
    scrollToBottom();
  }
  function clearStreamState() {
    streamBubble = null;
    streamContent = "";
    streamReasoningContent = "";
  }
  function createStreamBubble() {
    const bubble = document.createElement("div");
    bubble.className = "bubble bubble-assistant streaming";
    bubble.dataset.messageId = `streaming-${Date.now()}`;
    const dot = document.createElement("div");
    dot.className = "bubble-dot";
    bubble.appendChild(dot);
    const body = document.createElement("div");
    body.className = "bubble-body";
    bubble.appendChild(body);
    $.messages.appendChild(bubble);
    scrollToBottom();
    return bubble;
  }
  function clearMessages() {
    streamBubble = null;
    streamContent = "";
    streamReasoningContent = "";
    $.messages.innerHTML = "";
    state.lastMessageRole = null;
    state.currentThinkingBubble = null;
    state.currentRunningProcesses = null;
    state.currentLlmStreamProgress = null;
  }
  function renderAskUserQuestion(msg, shouldConnect) {
    addMessageBubble(msg, shouldConnect);
    if (state.currentSessionStatus === "waiting_for_user") {
      enableAskUserForms();
    }
  }
  function enableAskUserForms() {
    $.messages.querySelectorAll(".ask-user-form").forEach((form) => {
      form.querySelectorAll("input, textarea, button").forEach((el) => {
        el.disabled = false;
      });
    });
  }
  function updateLoadingText() {
    const loadingText = $.loading.querySelector("span");
    if (!loadingText) return;
    const parts = [];
    if (state.currentRunningProcesses) {
      const pids = Object.keys(state.currentRunningProcesses);
      for (const pid of pids) {
        const proc = state.currentRunningProcesses[pid];
        const elapsed = formatElapsedTimeSimple(proc.startTime);
        const cmd = proc.command.slice(0, 60);
        parts.push(`[PID ${pid}] ${cmd} (${elapsed})`);
      }
    }
    const progress = state.currentLlmStreamProgress;
    if (progress) {
      const elapsed = formatElapsedTimeSimple(progress.startedAt);
      if (progress.formattedTokens) {
        parts.push(`\u5DF2\u751F\u6210\u7EA6 ${progress.formattedTokens} tokens (${elapsed})`);
      } else {
        parts.push(`\u751F\u6210\u4E2D (${elapsed})`);
      }
    }
    loadingText.textContent = parts.length > 0 ? parts.join(" | ") : "\u5904\u7406\u4E2D...";
  }
  function formatElapsedTimeSimple(startTimeIso) {
    const elapsedMs = Date.now() - new Date(startTimeIso).getTime();
    const totalSec = Math.floor(elapsedMs / 1e3);
    const m = Math.floor(totalSec / 60);
    const s = totalSec % 60;
    return m > 0 ? `${m}m ${s}s` : `${s}s`;
  }

  // resources/webview/main.ts
  var loadingTimer = null;
  function init() {
    const root = window.workspaceRoot || "";
    setWorkspaceRoot(root);
    initComposer();
    initAttachmentManager();
    initSessionList();
    window.addEventListener("message", handleMessage);
    vscode.postMessage({ type: "ready" });
  }
  function normalizeProcesses(processes) {
    if (!processes || processes.length === 0) return null;
    const record = {};
    for (const p of processes) {
      record[String(p.pid)] = { startTime: p.startTime, command: p.command };
    }
    return record;
  }
  function handleMessage(event) {
    const msg = event.data;
    switch (msg.type) {
      case "initializeEmpty":
        handleInitializeEmpty(msg);
        break;
      case "loadSession":
        handleLoadSession(msg);
        break;
      case "showSessionsList":
        updateSessionDropdown(msg.sessions);
        break;
      case "sessionStatus":
        handleSessionStatus(msg);
        break;
      case "userMessage":
        handleUserMessage(msg.content);
        break;
      case "assistant":
        handleAssistantMessage(msg.html);
        break;
      case "appendMessage":
        handleAppendMessage(msg);
        break;
      case "loading":
        setLoading(msg.value);
        if (!msg.value) stopLoadingTimer();
        break;
      case "llmStreamProgress":
        state.currentLlmStreamProgress = msg.progress;
        break;
      case "streamChunk":
        appendStreamChunk(msg.content, msg.reasoningContent);
        break;
    }
  }
  function handleInitializeEmpty(msg) {
    clearMessages();
    clearStreamState();
    state.currentSessionId = null;
    state.currentSessionStatus = msg.status;
    state.currentTokenTelemetry = msg.tokenTelemetry ?? null;
    updateSessionTitle("New Chat");
    updateSessionDropdown(msg.sessions);
    updateContextMeter(state.currentTokenTelemetry);
  }
  function handleLoadSession(msg) {
    clearMessages();
    clearStreamState();
    state.currentSessionId = msg.sessionId;
    state.currentSessionStatus = msg.status;
    state.currentTokenTelemetry = msg.tokenTelemetry ?? null;
    state.currentRunningProcesses = normalizeProcesses(msg.processes);
    updateSessionTitle(msg.summary || "Chat");
    updateSessionDropdown(state.allSessions);
    updateContextMeter(state.currentTokenTelemetry);
    hideEmptyNewChat();
    let prevShouldConnect = false;
    for (const m of msg.messages) {
      renderMessage(m, prevShouldConnect);
      prevShouldConnect = m.visible !== false;
    }
    requestAnimationFrame(() => updateAllConnectionLines());
  }
  function handleSessionStatus(msg) {
    state.currentSessionStatus = msg.status;
    state.currentRunningProcesses = normalizeProcesses(msg.processes);
    state.currentTokenTelemetry = msg.tokenTelemetry ?? null;
    updateContextMeter(state.currentTokenTelemetry);
    if (msg.status === "completed" || msg.status === "interrupted" || msg.status === "failed") {
      setLoading(false);
      stopLoadingTimer();
    } else if (msg.status === "processing") {
      setLoading(true);
      startLoadingTimer();
    }
    if (msg.status === "waiting_for_user") {
      document
        .querySelectorAll(".ask-user-form input, .ask-user-form textarea, .ask-user-form button")
        .forEach((el) => (el.disabled = false));
    }
  }
  function handleUserMessage(content) {
    history.inputHistory.push(content);
    history.lastRecordText = content;
    history.lastRecordAt = Date.now();
    const msg = {
      id: `user-${Date.now()}`,
      sessionId: state.currentSessionId || "",
      role: "user",
      content,
      visible: true,
    };
    addMessageBubble(msg, false);
    hideEmptyNewChat();
    setLoading(true);
    startLoadingTimer();
  }
  function handleAssistantMessage(html) {
    const msg = {
      id: `assistant-${Date.now()}`,
      sessionId: state.currentSessionId || "",
      role: "assistant",
      content: html,
      visible: true,
    };
    addMessageBubble(msg, true);
  }
  function handleAppendMessage(msg) {
    clearStreamState();
    const message = msg.message;
    renderMessage(message, msg.shouldConnect);
    if (message.role === "tool" && message.content) {
      try {
        const parsed = JSON.parse(message.content);
        if (parsed.awaitUserResponse || parsed.metadata?.kind === "ask_user_question") {
          renderAskUserQuestion(message, msg.shouldConnect);
        }
      } catch {}
    }
  }
  function renderMessage(message, shouldConnect) {
    if (message.visible === false) return;
    addMessageBubble(message, shouldConnect);
  }
  function hideEmptyNewChat() {}
  function startLoadingTimer() {
    if (loadingTimer) return;
    loadingTimer = setInterval(() => {
      updateLoadingText();
    }, 1e3);
  }
  function stopLoadingTimer() {
    if (loadingTimer) {
      clearInterval(loadingTimer);
      loadingTimer = null;
    }
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
