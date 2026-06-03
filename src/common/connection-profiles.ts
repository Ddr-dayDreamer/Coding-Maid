import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { encrypt, decrypt, isEncrypted } from "./crypto-utils";

// ─── 占位符常量 ─────────────────────────────────────────────────────────────

/**
 * 模板中 apiKey 的占位文本，会被自动识别并跳过（不加密、不写入）。
 * 用户在此位置填入真实 key 后，启动时会自动加密并写入 apiKeyEncrypted。
 */
export const PLACEHOLDER_API_KEY = "place_your_api_key_here";

/**
 * 判断一个明文 apiKey 是否为真实的 key（非空、非占位符）
 */
export function isRealApiKey(key: string | undefined | null): boolean {
  if (!key || key.trim() === "") return false;
  return key.trim() !== PLACEHOLDER_API_KEY;
}

// ─── Types ───────────────────────────────────────────────────────────────────

export type ReasoningEffort = "high" | "max";

/**
 * 连接预设的磁盘存储格式
 * - 新保存的预设使用 `apiKeyEncrypted`（AES-256-GCM 加密）
 * - 也支持读取明文 `apiKey` 字段作为回退（手动编辑场景）
 */
export type ConnectionProfileStored = {
  name: string;
  model: string;
  baseURL: string;
  /** AES-256-GCM 加密后的 API Key，格式 "iv:tag:ciphertext" */
  apiKeyEncrypted?: string;
  /** 明文 API Key（仅用于手动编辑 JSON 时的读取回退，保存时会自动加密） */
  apiKey?: string;
  /** 是否启用思考模式，不设置时由 params 或模型默认行为决定 */
  thinkingEnabled?: boolean;
  /** 思考强度，仅 thinkingEnabled 为 true 时生效 */
  reasoningEffort?: ReasoningEffort;
  /**
   * 附加 API 请求参数，会直接合并到 chat.completions.create() 的请求体中。
   * 例如：{ "temperature": 0.7, "max_tokens": 4096, "top_p": 0.9 }
   * 可用于覆盖默认参数或传入模型特有参数（如 Gemini 的 thinking_level）。
   * 此字段优先级最高，会覆盖 thinkingEnabled/reasoningEffort 生成的默认参数。
   */
  params?: Record<string, unknown>;
};

/**
 * 连接预设的用户输入/运行时格式（API Key 明文）
 */
export type ConnectionProfile = {
  name: string;
  model: string;
  baseURL: string;
  apiKey?: string;
  /** 是否启用思考模式，不设置时由 params 或模型默认行为决定 */
  thinkingEnabled?: boolean;
  /** 思考强度，仅 thinkingEnabled 为 true 时生效 */
  reasoningEffort?: ReasoningEffort;
  /**
   * 附加 API 请求参数，直接合并到 chat.completions.create() 的请求体中。
   */
  params?: Record<string, unknown>;
};

export type McpServerConfig = {
  command: string;
  args?: string[];
  env?: Record<string, string>;
};

/**
 * 全局设置（不含连接预设）
 */
export type CodingMaidSettings = {
  activeProfile: string;
  notify?: string;
  presetsDir?: string;
  debugLogEnabled?: boolean;
  debugPromptEnabled?: boolean;
  mcpServers?: Record<string, McpServerConfig>;
};

// ─── Paths ────────────────────────────────────────────────────────────────────

const CODING_MAID_DIR = path.join(os.homedir(), ".codingmaid");
const PROFILES_DIR = path.join(CODING_MAID_DIR, "profiles");
const SETTINGS_FILE = path.join(CODING_MAID_DIR, "settings.json");

function ensureDirs(): void {
  if (!fs.existsSync(PROFILES_DIR)) {
    fs.mkdirSync(PROFILES_DIR, { recursive: true });
  }
}

// ─── Global Settings ─────────────────────────────────────────────────────────

export function loadGlobalSettings(): CodingMaidSettings {
  ensureDirs();
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

export function saveGlobalSettings(settings: CodingMaidSettings): void {
  ensureDirs();
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2), "utf8");
}

// ─── Profile CRUD ────────────────────────────────────────────────────────────

/**
 * 列出所有可用的连接预设名称
 */
export function listProfiles(): string[] {
  ensureDirs();
  try {
    const entries = fs.readdirSync(PROFILES_DIR, { withFileTypes: true });
    return entries
      .filter((e) => e.isFile() && e.name.endsWith(".json"))
      .map((e) => e.name.replace(/\.json$/, ""))
      .sort();
  } catch {
    return [];
  }
}

function profilePath(name: string): string {
  // Sanitize: only allow safe filename characters
  const safeName = name.replace(/[^a-zA-Z0-9_\-\u4e00-\u9fff]+/g, "_");
  return path.join(PROFILES_DIR, `${safeName}.json`);
}

/**
 * 读取一个连接预设（返回明文 API Key，需提供加密密钥）
 */
export function loadProfile(name: string, cryptoKey: string): ConnectionProfile | null {
  ensureDirs();
  const filePath = profilePath(name);
  if (!fs.existsSync(filePath)) {
    return null;
  }

  try {
    const raw = fs.readFileSync(filePath, "utf8");
    const stored = JSON.parse(raw) as ConnectionProfileStored;

    let apiKey: string | undefined;

    // 优先解密加密的 API Key
    if (stored.apiKeyEncrypted) {
      try {
        apiKey = decrypt(stored.apiKeyEncrypted, cryptoKey);
      } catch {
        apiKey = undefined;
      }
    }

    // 回退：读取明文的 apiKey（手动编辑 JSON 场景）
    if (!apiKey && stored.apiKey) {
      apiKey = stored.apiKey;
    }

    return {
      name: stored.name,
      model: stored.model,
      baseURL: stored.baseURL,
      apiKey,
      thinkingEnabled: stored.thinkingEnabled,
      reasoningEffort: stored.reasoningEffort,
      params: stored.params,
    };
  } catch {
    return null;
  }
}

/**
 * 保存一个连接预设（自动加密 API Key）
 */
export function saveProfile(profile: ConnectionProfile, cryptoKey: string): void {
  ensureDirs();

  const stored: ConnectionProfileStored = {
    name: profile.name,
    model: profile.model,
    baseURL: profile.baseURL,
    thinkingEnabled: profile.thinkingEnabled,
    reasoningEffort: profile.reasoningEffort,
    params: profile.params,
  };

  // 加密 API Key（跳过空值和占位符）
  if (isRealApiKey(profile.apiKey)) {
    stored.apiKeyEncrypted = encrypt(profile.apiKey!, cryptoKey);
  }

  const filePath = profilePath(profile.name);
  fs.writeFileSync(filePath, JSON.stringify(stored, null, 2), "utf8");
}

/**
 * 删除一个连接预设
 */
export function deleteProfile(name: string): boolean {
  const filePath = profilePath(name);
  if (!fs.existsSync(filePath)) {
    return false;
  }
  fs.unlinkSync(filePath);
  return true;
}

/**
 * 获取当前激活的连接预设
 */
export function getActiveProfile(cryptoKey: string): ConnectionProfile | null {
  const settings = loadGlobalSettings();
  if (!settings.activeProfile) {
    return null;
  }
  return loadProfile(settings.activeProfile, cryptoKey);
}

/**
 * 设置当前激活的连接预设
 */
export function setActiveProfile(name: string): void {
  const settings = loadGlobalSettings();
  settings.activeProfile = name;
  saveGlobalSettings(settings);
}

/**
 * 创建默认的连接预设（如果不存在）
 */
export function ensureDefaultProfile(cryptoKey: string): void {
  const profiles = listProfiles();
  if (profiles.length > 0) {
    return;
  }

  const defaultProfile: ConnectionProfile = {
    name: "default",
    model: "deepseek-v4-pro",
    baseURL: "https://api.deepseek.com",
  };

  saveProfile(defaultProfile, cryptoKey);
  setActiveProfile("default");
}

/**
 * 扫描所有连接预设，将明文 apiKey 自动加密为 apiKeyEncrypted。
 * 支持用户在 JSON 中直接填写真实 key，启动时自动完成加密迁移。
 */
export function migratePlaintextApiKeys(cryptoKey: string): void {
  const profiles = listProfiles();
  for (const name of profiles) {
    const filePath = profilePath(name);
    try {
      const raw = fs.readFileSync(filePath, "utf8");
      const stored = JSON.parse(raw) as ConnectionProfileStored;

      // 已有加密 key 或没有明文 key → 跳过
      if (stored.apiKeyEncrypted || !stored.apiKey) continue;

      // 占位符 → 清理明文，不留痕迹
      if (!isRealApiKey(stored.apiKey)) {
        delete stored.apiKey;
        fs.writeFileSync(filePath, JSON.stringify(stored, null, 2), "utf8");
        continue;
      }

      // 真实 key → 加密写入
      stored.apiKeyEncrypted = encrypt(stored.apiKey, cryptoKey);
      delete stored.apiKey;
      fs.writeFileSync(filePath, JSON.stringify(stored, null, 2), "utf8");
      console.log(`[Coding Maid] Auto-encrypted API key in profile "${name}"`);
    } catch (err) {
      console.error(`[Coding Maid] Failed to migrate profile "${name}":`, err);
    }
  }
}

/**
 * 统一初始化：检测用户的 settings.json 和连接预设，缺失则从模板复制。
 * 由 extension.ts 在启动时调用。
 */
export function ensureInitialConfig(templatesDir: string, cryptoKey: string): void {
  ensureDirs();

  // ── 1. settings.json ────────────────────────────────
  if (!fs.existsSync(SETTINGS_FILE)) {
    const templatePath = path.join(templatesDir, "buildin_settings.json");
    try {
      if (fs.existsSync(templatePath)) {
        fs.copyFileSync(templatePath, SETTINGS_FILE);
        console.log("[Coding Maid] Created default settings.json from template");
      } else {
        // 模板不存在则 fallback 最小配置
        saveGlobalSettings({ activeProfile: "default" });
      }
    } catch (err) {
      console.error("[Coding Maid] Failed to create settings.json:", err);
    }
  }

  // ── 2. 连接预设 ─────────────────────────────────────
  const existingProfiles = listProfiles();
  if (existingProfiles.length === 0) {
    const templatePath = path.join(templatesDir, "buildin_profile.json");
    try {
      if (fs.existsSync(templatePath)) {
        const raw = fs.readFileSync(templatePath, "utf8");
        const profile = JSON.parse(raw) as ConnectionProfile;
        // 模板中的 apiKey 只是占位指引，不写入实际配置
        delete profile.apiKey;
        saveProfile(profile, cryptoKey);
        setActiveProfile(profile.name);
        console.log("[Coding Maid] Created default profile from template");
      } else {
        // 模板不存在则 fallback 硬编码默认值
        const profile: ConnectionProfile = {
          name: "default",
          model: "deepseek-v4-pro",
          baseURL: "https://api.deepseek.com",
        };
        saveProfile(profile, cryptoKey);
        setActiveProfile("default");
      }
    } catch (err) {
      console.error("[Coding Maid] Failed to create default profile:", err);
    }
  }

  // ── 3. 明文 key 自动加密 ────────────────────────────
  migratePlaintextApiKeys(cryptoKey);
}
