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
import { defaultsToThinkingMode } from "./common/model-capabilities";

// ─── Re-export types for backward compatibility ─────────────────────────────

export type { ReasoningEffort, McpServerConfig } from "./common/connection-profiles";

/** @deprecated 使用 ConnectionProfile 替代 */
export type DeepcodingSettings = Record<string, never>;

/**
 * 解析后的设置。
 * 仍保留此类型兼容旧代码，但推荐直接使用 ConnectionProfile。
 */
export type ResolvedDeepcodingSettings = {
  env: Record<string, string>;
  apiKey?: string;
  baseURL: string;
  model: string;
  thinkingEnabled?: boolean;
  reasoningEffort?: ReasoningEffort;
  params?: Record<string, unknown>;
  debugLogEnabled: boolean;
  debugPromptEnabled: boolean;
  notify?: string;
  webSearchTool?: string;
  mcpServers?: Record<string, McpServerConfig>;
};

// ─── New simplified API ──────────────────────────────────────────────────────

/**
 * 根据加密密钥解析当前激活的连接预设 + 全局设置
 */
export function resolveSettingsWithCryptoKey(cryptoKey: string): ResolvedDeepcodingSettings & { profileName: string } {
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
    params: profile?.params,
    debugLogEnabled: globalSettings.debugLogEnabled ?? false,
    debugPromptEnabled: globalSettings.debugPromptEnabled ?? false,
    notify: globalSettings.notify,
    mcpServers: globalSettings.mcpServers,
    profileName: globalSettings.activeProfile || "default",
  };
}

// ─── Legacy API (deprecated, kept for backward compat) ───────────────────────

/**
 * @deprecated 改用 resolveSettingsWithCryptoKey()
 *
 * 旧版的多层配置合并函数，保留兼容性。
 * 现在简化实现：忽略旧参数，直接从连接预设读取。
 */
export function resolveSettingsSources(
  _userSettings: DeepcodingSettings | null | undefined,
  _projectSettings: DeepcodingSettings | null | undefined,
  defaults: { model: string; baseURL: string },
  _processEnv?: Record<string, string | undefined>
): ResolvedDeepcodingSettings {
  // Fallback: 尝试从预设读取，如果没加密密钥则返回默认值
  try {
    const globalSettings = loadGlobalSettings();
    const profile = getActiveProfile("");

    const model = profile?.model ?? defaults.model;
    const baseURL = profile?.baseURL ?? defaults.baseURL;

    return {
      env: {},
      apiKey: profile?.apiKey, // 无加密密钥时只能读取明文预设
      baseURL,
      model,
      thinkingEnabled: profile?.thinkingEnabled,
      reasoningEffort: profile?.reasoningEffort,
      params: profile?.params,
      debugLogEnabled: globalSettings.debugLogEnabled ?? false,
      debugPromptEnabled: globalSettings.debugPromptEnabled ?? false,
      notify: globalSettings.notify,
    };
  } catch {
    return {
      env: {},
      baseURL: defaults.baseURL,
      model: defaults.model,
      debugLogEnabled: false,
      debugPromptEnabled: false,
    };
  }
}

// ─── Profile management convenience wrappers ─────────────────────────────────

export {
  type ConnectionProfile,
  type CodingMaidSettings,
  type ReasoningEffort as ReasoningEffortAlias,
  loadGlobalSettings,
  getActiveProfile,
  listProfiles,
  loadProfile,
  saveProfile,
  deleteProfile,
  setActiveProfile,
  ensureDefaultProfile,
} from "./common/connection-profiles";
