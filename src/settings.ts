import {
  type ConnectionProfile,
  type ReasoningEffort,
  getActiveProfile,
  listProfiles,
  loadProfile,
  saveProfile,
  deleteProfile,
  setActiveProfile,
  ensureDefaultProfile,
} from "./common/connection-profiles";
import {
  type CodingMaidSettings,
  type McpServerConfig,
  loadGlobalSettings,
} from "./common/global-settings";

// ─── Re-export types for backward compatibility ─────────────────────────────

export type { ReasoningEffort } from "./common/connection-profiles";
export type { McpServerConfig } from "./common/global-settings";

/**
 * 解析后的运行时设置 — 由 resolveSettingsWithCryptoKey() 返回。
 */
export type ResolvedSettings = {
  env: Record<string, string>;
  apiKey?: string;
  baseURL: string;
  model: string;
  thinkingEnabled?: boolean;
  reasoningEffort?: ReasoningEffort;
  contextLimit?: number;
  params?: Record<string, unknown>;
  /** 是否启用调试日志（统一开关，控制 LLM 请求日志 + prompt 调试输出） */
  debugEnabled: boolean;
  notify?: string;
  webSearchTool?: string;
  mcpServers?: Record<string, McpServerConfig>;
  profileName: string;
  /** 当前激活的预设名称 */
  activePreset: string;
};

/**
 * 根据加密密钥解析当前激活的连接预设 + 全局设置
 */
export function resolveSettingsWithCryptoKey(cryptoKey: string): ResolvedSettings {
  const globalSettings = loadGlobalSettings();
  const profile = getActiveProfile(cryptoKey);

  const model = profile?.model ?? "deepseek-v4-pro";
  const baseURL = profile?.baseURL ?? "https://api.deepseek.com";

  return {
    env: {},
    apiKey: profile?.apiKey,
    baseURL,
    model,
    thinkingEnabled: profile?.thinkingEnabled,
    reasoningEffort: profile?.reasoningEffort,
    contextLimit: profile?.contextLimit,
    params: profile?.params,
    debugEnabled: globalSettings.debugEnabled ?? false,
    notify: globalSettings.notify,
    mcpServers: globalSettings.mcpServers,
    profileName: globalSettings.activeProfile || "default",
    activePreset: globalSettings.activePreset || "default",
  };
}

// ─── Profile management convenience wrappers ─────────────────────────────────

export {
  type ConnectionProfile,
  type ReasoningEffort as ReasoningEffortAlias,
  PLACEHOLDER_API_KEY,
  isRealApiKey,
  getActiveProfile,
  listProfiles,
  loadProfile,
  saveProfile,
  deleteProfile,
  setActiveProfile,
  ensureDefaultProfile,
  ensureInitialConfig,
  migratePlaintextApiKeys,
} from "./common/connection-profiles";

export { loadGlobalSettings } from "./common/global-settings";

export type { CodingMaidSettings } from "./common/global-settings";
