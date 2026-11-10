/**
 * 全局设置管理
 *
 * 职责：管理 ~/.codingmaid/settings.json 的读写
 * 独立于连接预设，只负责全局配置字段。
 */

import * as fs from "fs";
import * as path from "path";
import * as os from "os";

// ─── 路径 ────────────────────────────────────────────────────────────────────

export const CODING_MAID_DIR = path.join(os.homedir(), ".codingmaid");
export const SETTINGS_FILE = path.join(CODING_MAID_DIR, "settings.json");

// ─── Types ───────────────────────────────────────────────────────────────────

export type McpServerConfig = {
  command: string;
  args?: string[];
  env?: Record<string, string>;
};

/**
 * 审批模式枚举
 * - "none": 无需审批，直接执行
 * - "require": 需要用户审批后才执行
 * 未来可扩展："ai_approval" 等
 */
export type ApprovalMode = "none" | "require";

/**
 * 工具审批配置
 * key: 工具名（如 "bash"、"write"、"read"）
 * value: 审批模式
 * 未在此处列出的工具 → 默认 "require"（安全优先）
 */
export type ApprovalConfig = Record<string, ApprovalMode>;

/**
 * 全局设置（存入 settings.json）
 *
 * 注意：连接预设相关的字段不在此处。
 * 每个 profile 的 model/baseURL/apiKey 存在 ~/.codingmaid/profiles/<name>.json 中。
 */
export type CodingMaidSettings = {
  /** 当前激活的连接配置名称（必填，默认为 "default"） */
  activeProfile: string;
  /** 当前激活的提示词预设名称（可选，默认为 "default"） */
  activePreset?: string;
  /** 桌面通知方式 */
  notify?: string;
  /** 预设目录覆盖路径 */
  presetsDir?: string;
  /** 是否启用调试日志 */
  debugEnabled?: boolean;
  /**
   * LLM 请求在“尚未输出任何内容”时失败后的自动重试次数。
   * 取值 0–3，0 表示关闭；未设置时默认 2。
   */
  llmRetryCount?: number;
  /**
   * 单次 LLM 请求的整体超时时间（毫秒）。
   * 不设置时使用默认值 600000（10 分钟）。
   */
  llmTimeoutMs?: number;
  /** MCP 服务器配置 */
  mcpServers?: Record<string, McpServerConfig>;
  /** 工具审批配置 */
  approvalConfig?: ApprovalConfig;
};

// ─── 内部工具 ────────────────────────────────────────────────────────────────

function ensureSettingsDir(): void {
  if (!fs.existsSync(CODING_MAID_DIR)) {
    fs.mkdirSync(CODING_MAID_DIR, { recursive: true });
  }
}

// ─── Global Settings CRUD ────────────────────────────────────────────────────

/** 读取全局设置，文件不存在或损坏时返回默认值 */
export function loadGlobalSettings(): CodingMaidSettings {
  ensureSettingsDir();
  try {
    if (fs.existsSync(SETTINGS_FILE)) {
      const raw = fs.readFileSync(SETTINGS_FILE, "utf8");
      return JSON.parse(raw) as CodingMaidSettings;
    }
  } catch {
    // fall through to defaults
  }
  return { activeProfile: "default" };
}

/** 保存全局设置 */
export function saveGlobalSettings(settings: CodingMaidSettings): void {
  ensureSettingsDir();
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2), "utf8");
}

// ─── activePreset ────────────────────────────────────────────────────────────

/** 获取当前激活的预设名称 */
export function getActivePreset(): string {
  const settings = loadGlobalSettings();
  return settings.activePreset || "default";
}

/** 设置当前激活的预设名称 */
export function setActivePreset(name: string): void {
  const settings = loadGlobalSettings();
  settings.activePreset = name;
  saveGlobalSettings(settings);
}
