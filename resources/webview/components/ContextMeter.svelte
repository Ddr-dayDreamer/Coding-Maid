<script lang="ts">
  import { appState } from "../lib/state.svelte";

  let hovered = $state(false);
  let meterEl: HTMLSpanElement | undefined = $state();
  let tooltipStyle = $state("");

  // ─── Tooltip 动态定位 ──────────────────────────────

  $effect(() => {
    if (!hovered || !meterEl) {
      tooltipStyle = "";
      return;
    }

    const updatePos = () => {
      const rect = meterEl!.getBoundingClientRect();
      const gap = 6;
      let left = rect.left;

      // 从 meter 位置向上展开（bottom = 视口底边到 tooltip 底边的距离）
      const bottom = window.innerHeight - rect.top + gap;

      // 确保 tooltip 不超出右边界
      const tooltipW = 240;
      if (left + tooltipW > window.innerWidth - 8) {
        left = window.innerWidth - tooltipW - 8;
      }
      if (left < 8) left = 8;

      tooltipStyle = `left:${left}px;bottom:${bottom}px`;
    };

    updatePos();
    // 当布局变化时重新计算
    const observer = new ResizeObserver(updatePos);
    observer.observe(meterEl);
    return () => observer.disconnect();
  });

  // ─── 环图参数 ──────────────────────────────────────

  const R = 9;
  const CIRCUMFERENCE = 2 * Math.PI * R; // ≈ 56.55

  const activeTokens = $derived(appState.tokenTelemetry?.activeTokens ?? 0);
  const contextLimit = $derived(appState.tokenTelemetry?.contextLimit ?? 1_000_000);
  const proportion = $derived(contextLimit > 0 ? Math.min(activeTokens / contextLimit, 1) : 0);
  const dashOffset = $derived(CIRCUMFERENCE * (1 - proportion));

  const model = $derived(appState.tokenTelemetry?.model ?? "");

  // ─── 累计用量 ──────────────────────────────────────

  const totalPrompt = $derived(appState.tokenTelemetry?.usage?.prompt_tokens ?? 0);
  const totalCompletion = $derived(appState.tokenTelemetry?.usage?.completion_tokens ?? 0);
  const totalTokens = $derived(appState.tokenTelemetry?.usage?.total_tokens ?? 0);
  const totalReqs = $derived((appState.tokenTelemetry?.usage as Record<string, unknown> | undefined)?.["total_reqs"] as number | undefined ?? 0);

  // ─── 缓存命中率（累计） ────────────────────────────

  const totalCacheHit = $derived(appState.tokenTelemetry?.usage?.prompt_cache_hit_tokens ?? 0);
  const totalCacheMiss = $derived(appState.tokenTelemetry?.usage?.prompt_cache_miss_tokens ?? 0);
  const totalCache = $derived(totalCacheHit + totalCacheMiss);
  const totalCacheRate = $derived(totalCache > 0 ? (totalCacheHit / totalCache) * 100 : null);

  // ─── 缓存命中率（最后一次） ────────────────────────

  const lastCacheHit = $derived(appState.tokenTelemetry?.lastUsage?.prompt_cache_hit_tokens ?? 0);
  const lastCacheMiss = $derived(appState.tokenTelemetry?.lastUsage?.prompt_cache_miss_tokens ?? 0);
  const lastCache = $derived(lastCacheHit + lastCacheMiss);
  const lastCacheRate = $derived(lastCache > 0 ? (lastCacheHit / lastCache) * 100 : null);

  // ─── 环图颜色 ──────────────────────────────────────

  const ringColor = $derived(
    proportion === 0 ? "var(--vscode-input-border, #ccc)" :
    proportion > 0.8 ? "var(--vscode-charts-red, #e33)" :
    proportion > 0.5 ? "var(--vscode-charts-yellow, #ea3)" :
    "var(--vscode-charts-green, #3b8)"
  );

  // ─── 格式化 ──────────────────────────────────────

  function fmt(n: number): string {
    if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
    if (n >= 1_000) return (n / 1_000).toFixed(1) + "K";
    return String(n);
  }

  function pct(n: number): string {
    return (n * 100).toFixed(1) + "%";
  }
</script>

<span
  class="context-meter"
  bind:this={meterEl}
  onmouseenter={() => (hovered = true)}
  onmouseleave={() => (hovered = false)}
  role="img"
  aria-label="Token 用量: {fmt(activeTokens)} / {fmt(contextLimit)}"
>
  <!-- 环形 SVG -->
  <svg viewBox="0 0 24 24" width="18" height="18" class="ring-svg">
    <circle
      cx="12" cy="12" r={R}
      fill="none"
      stroke="var(--vscode-input-border, #333)"
      stroke-width="2"
      transform="rotate(-90 12 12)"
    />
    <circle
      cx="12" cy="12" r={R}
      fill="none"
      stroke={ringColor}
      stroke-width="2"
      stroke-dasharray={CIRCUMFERENCE}
      stroke-dashoffset={dashOffset}
      stroke-linecap="round"
      transform="rotate(-90 12 12)"
      class:active={activeTokens > 0}
    />
  </svg>

  <!-- Tooltip -->
  {#if hovered}
    <div class="meter-tooltip" role="tooltip" style={tooltipStyle}>
      <div class="meter-tooltip-header">{model || "等待数据…"}</div>

      <div class="meter-row">
        <span>上下文</span>
        <span>{fmt(activeTokens)} / {fmt(contextLimit)} ({pct(proportion)})</span>
      </div>

      {#if totalTokens > 0}
        <div class="meter-row">
          <span>输入</span>
          <span>{fmt(totalPrompt)} tokens</span>
        </div>
        <div class="meter-row">
          <span>输出</span>
          <span>{fmt(totalCompletion)} tokens</span>
        </div>
        <div class="meter-row">
          <span>请求次数</span>
          <span>{totalReqs}</span>
        </div>
      {:else}
        <div class="meter-empty">暂无用量数据</div>
      {/if}

      {#if totalCacheRate !== null || lastCacheRate !== null}
        {#if lastCacheRate !== null}
          <div class="meter-row">
            <span>本次缓存</span>
            <span>{pct(lastCacheRate / 100)}</span>
          </div>
        {/if}
        {#if totalCacheRate !== null}
          <div class="meter-row">
            <span>累计缓存</span>
            <span>{pct(totalCacheRate / 100)}</span>
          </div>
        {/if}
      {/if}
    </div>
  {/if}
</span>

<style>
  .context-meter {
    position: relative;
    display: inline-flex;
    align-items: center;
    cursor: default;
    line-height: 0;
  }

  .ring-svg {
    display: block;
    flex-shrink: 0;
  }

  .ring-svg circle.active {
    transition: stroke-dashoffset 0.3s ease, stroke 0.3s ease;
  }

  /* ─── Tooltip ───────────────────────────── */

  .meter-tooltip {
    position: fixed;
    z-index: 1000;
    min-width: 200px;
    padding: 8px 10px;
    border-radius: 6px;
    font-size: 11px;
    line-height: 1.5;
    white-space: nowrap;
    background: var(--vscode-editorWidget-background, #252526);
    border: 1px solid var(--vscode-editorWidget-border, #454545);
    color: var(--vscode-editorWidget-foreground, #ccc);
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
    pointer-events: none;
  }

  .meter-tooltip-header {
    font-weight: 600;
    margin-bottom: 4px;
    padding-bottom: 4px;
    border-bottom: 1px solid var(--vscode-editorWidget-border, #454545);
    color: var(--vscode-editor-foreground, #eee);
  }

  .meter-row {
    display: flex;
    justify-content: space-between;
    gap: 16px;
  }

  .meter-row span:first-child {
    color: var(--vscode-descriptionForeground, #999);
  }

  .meter-empty {
    color: var(--vscode-descriptionForeground, #999);
    font-style: italic;
  }
</style>
