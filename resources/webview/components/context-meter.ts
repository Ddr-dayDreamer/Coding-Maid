import { $ } from "../state";
import type { TokenTelemetry } from "../types";

// ─── 更新 Token 用量环 ───────────────────────────────────

export function updateContextMeter(telemetry: TokenTelemetry | null | undefined): void {
  if (!telemetry) {
    $.contextMeter.style.display = "none";
    return;
  }
  $.contextMeter.style.display = "";

  const percent = getTokenUsagePercent(telemetry);
  const degrees = Math.round(percent * 3.6);
  $.contextMeterRing.style.background = `conic-gradient(var(--accent) ${degrees}deg, transparent ${degrees}deg)`;

  // 更新 tooltip
  const tooltip = renderTooltip(telemetry, percent);
  $.contextMeterTooltip.innerHTML = tooltip;
}

function getTokenUsagePercent(telemetry: TokenTelemetry): number {
  const active = telemetry.activeTokens || 0;
  // 用 1M 作为基准（DeepSeek 上下文窗口）
  const base = 1_000_000;
  const pct = (active / base) * 100;
  return Math.min(100, Math.max(0, Math.round(pct * 10) / 10));
}

function formatTokenCount(value: number): string {
  return value.toLocaleString();
}

function renderTooltip(telemetry: TokenTelemetry, percent: number): string {
  const parts: string[] = [];
  parts.push(`<div><strong>${telemetry.model || "Unknown"}</strong></div>`);
  if (telemetry.thinkingEnabled) parts.push("<div>思考模式: 启用</div>");
  parts.push(`<div>活跃 Token: ${formatTokenCount(telemetry.activeTokens || 0)}</div>`);
  parts.push(`<div>用量: ${percent}%</div>`);

  const usage = telemetry.usage;
  if (usage) {
    parts.push(`<hr style="margin:4px 0;border:none;border-top:1px solid var(--border-color)">`);
    parts.push(`<div>Prompt: ${formatTokenCount(usage.prompt_tokens || 0)}</div>`);
    parts.push(`<div>补全: ${formatTokenCount(usage.completion_tokens || 0)}</div>`);
    parts.push(`<div>总计: ${formatTokenCount(usage.total_tokens || 0)}</div>`);
  }

  return parts.join("");
}
