import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { encrypt, decrypt, isEncrypted } from "./crypto-utils";
import {
  type CodingMaidSettings,
  type McpServerConfig,
  loadGlobalSettings,
  saveGlobalSettings,
  SETTINGS_FILE,
  CODING_MAID_DIR,
} from "./global-settings";

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
   * 模型的上下文窗口上限（tokens）。
   * 用于前端 context meter 显示用量比例。不设置时默认 1,000,000（DeepSeek V4）。
   */
  contextLimit?: number;
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
  /** 模型的上下文窗口上限（tokens），不设置时默认 1,000,000 */
  contextLimit?: number;
  /**
   * 附加 API 请求参数，直接合并到 chat.completions.create() 的请求体中。
   */
  params?: Record<string, unknown>;
};

// ─── Paths ────────────────────────────────────────────────────────────────────

const PROFILES_DIR = path.join(CODING_MAID_DIR, "profiles");

function ensureProfileDir(): void {
  if (!fs.existsSync(PROFILES_DIR)) {
    fs.mkdirSync(PROFILES_DIR, { recursive: true });
  }
}

// ─── Profile CRUD ────────────────────────────────────────────────────────────

/**
 * 列出所有可用的连接预设名称
 */
export function listProfiles(): string[] {
  ensureProfileDir();
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
 *
 * 如果发现明文 API Key 且为真实密钥，会自动加密写入并用占位符替换明文。
 */
export function loadProfile(name: string, cryptoKey: string): ConnectionProfile | null {
  ensureProfileDir();
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

    // 回退：读取明文的 apiKey（手动编辑 JSON 场景）→ 自动加密并替换为占位符
    if (!apiKey && isRealApiKey(stored.apiKey)) {
      apiKey = stored.apiKey;
      try {
        stored.apiKeyEncrypted = encrypt(apiKey!, cryptoKey);
        stored.apiKey = PLACEHOLDER_API_KEY;
        fs.writeFileSync(filePath, JSON.stringify(stored, null, 2), "utf8");
        console.log(`[Coding Maid] Auto-encrypted API key in profile "${name}"`);
      } catch (e) {
        console.error(`[Coding Maid] Failed to encrypt API key in profile "${name}":`, e);
      }
    }

    // 占位符清理（不留空 key 字段）
    if (!apiKey && stored.apiKey && !isRealApiKey(stored.apiKey)) {
      delete stored.apiKey;
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
 * 写入预设文件（内部使用，不对外暴露）
 */
function writeProfileFile(profile: ConnectionProfile, cryptoKey: string): void {
  ensureProfileDir();

  const stored: ConnectionProfileStored = {
    name: profile.name,
    model: profile.model,
    baseURL: profile.baseURL,
    thinkingEnabled: profile.thinkingEnabled,
    reasoningEffort: profile.reasoningEffort,
    apiKey: profile.apiKey,
    params: profile.params,
  };

  // 加密 API Key（跳过空值和占位符）
  if (isRealApiKey(profile.apiKey)) {
    stored.apiKeyEncrypted = encrypt(profile.apiKey!, cryptoKey);
    delete stored.apiKey;
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
 * 重命名一个连接预设（重命名文件 + 更新 JSON 内的 name 字段）
 */
export function renameProfile(oldName: string, newName: string): boolean {
  if (oldName === newName) return true;
  const oldPath = profilePath(oldName);
  const newPath = profilePath(newName);
  if (!fs.existsSync(oldPath)) return false;
  if (fs.existsSync(newPath)) return false; // 目标已存在

  try {
    // 读取旧配置，更新 name 字段
    const raw = fs.readFileSync(oldPath, "utf8");
    const stored = JSON.parse(raw) as ConnectionProfileStored;
    stored.name = newName;
    // 写入新文件
    fs.writeFileSync(newPath, JSON.stringify(stored, null, 2), "utf8");
    // 删除旧文件
    fs.unlinkSync(oldPath);
    return true;
  } catch {
    return false;
  }
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

  writeProfileFile(defaultProfile, cryptoKey);
  setActiveProfile("default");
}

/**
 * 扫描所有连接预设，将明文 apiKey 自动加密为 apiKeyEncrypted。
 * 支持用户在 JSON 中直接填写真实 key，启动时自动完成加密迁移。
 * 加密后会在 apiKey 字段保留占位符，方便下次替换。
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

      // 占位符 → 保留不动
      if (!isRealApiKey(stored.apiKey)) continue;

      // 真实 key → 加密写入，明文替换为占位符
      stored.apiKeyEncrypted = encrypt(stored.apiKey, cryptoKey);
      stored.apiKey = PLACEHOLDER_API_KEY;
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
  ensureProfileDir();

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
        // 保留占位符，方便用户直接填写
        profile.apiKey = PLACEHOLDER_API_KEY;
        writeProfileFile(profile, cryptoKey);
        setActiveProfile(profile.name);
        console.log("[Coding Maid] Created default profile from template");
      } else {
        // 模板不存在则 fallback 硬编码默认值
        const profile: ConnectionProfile = {
          name: "default",
          model: "deepseek-v4-pro",
          baseURL: "https://api.deepseek.com",
        };
        writeProfileFile(profile, cryptoKey);
        setActiveProfile("default");
      }
    } catch (err) {
      console.error("[Coding Maid] Failed to create default profile:", err);
    }
  }

  // ── 3. 明文 key 自动加密 ────────────────────────────
  migratePlaintextApiKeys(cryptoKey);
}

/**
 * 从内置模板创建新的连接预设（不包含 API Key）
 * @param name 新预设名称
 * @param cryptoKey 加密密钥
 * @param templatesDir 模板目录路径
 */
export function createProfileFromTemplate(name: string, templatesDir: string, cryptoKey: string): ConnectionProfile {
  const templatePath = path.join(templatesDir, "buildin_profile.json");

  let base: ConnectionProfile;

  if (fs.existsSync(templatePath)) {
    const raw = fs.readFileSync(templatePath, "utf8");
    base = JSON.parse(raw) as ConnectionProfile;
  } else {
    base = {
      name: "default",
      model: "deepseek-v4-flash",
      baseURL: "https://api.deepseek.com",
      params: { stream: true },
    };
  }

  // 使用新名称，保留占位符方便直接编辑
  base.name = name;
  base.apiKey = PLACEHOLDER_API_KEY;

  writeProfileFile(base, cryptoKey);
  return base;
}
