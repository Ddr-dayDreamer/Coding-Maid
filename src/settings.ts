import {
  type ConnectionProfile,
  type CodingMaidSettings,
  type ReasoningEffort,
  type McpServerConfig,
  loadGlobalSettings,
  getActiveProfile,
  listProfiles,
  loadProfile,
  saveProfile,
  deleteProfile,
  setActiveProfile,
  ensureDefaultProfile,
} from "./common/connection-profiles";

// ─── Re-export types for backward compatibility ─────────────────────────────

export type { ReasoningEffort, McpServerConfig } from "./common/connection-profiles";

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
  debugLogEnabled: boolean;
  debugPromptEnabled: boolean;
  notify?: string;
  webSearchTool?: string;
  mcpServers?: Record<string, McpServerConfig>;
  profileName: string;
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
    debugLogEnabled: globalSettings.debugLogEnabled ?? false,
    debugPromptEnabled: globalSettings.debugPromptEnabled ?? false,
    notify: globalSettings.notify,
    mcpServers: globalSettings.mcpServers,
    profileName: globalSettings.activeProfile || "default",
  };
}

// ─── Profile management convenience wrappers ─────────────────────────────────

export {
  type ConnectionProfile,
  type CodingMaidSettings,
  type ReasoningEffort as ReasoningEffortAlias,
  PLACEHOLDER_API_KEY,
  isRealApiKey,
  loadGlobalSettings,
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
