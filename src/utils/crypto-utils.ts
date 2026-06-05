import * as crypto from "crypto";

const ALGORITHM = "aes-256-gcm";
const KEY_LENGTH = 32;
const IV_LENGTH = 16;

/**
 * 生成一个新的加密密钥（hex 编码）
 */
export function generateEncryptionKey(): string {
  return crypto.randomBytes(KEY_LENGTH).toString("hex");
}

/**
 * 从种子值确定性派生加密密钥（相同 seed 始终返回相同 key）
 *
 * 用于解决扩展重装后 globalState 丢失导致密钥变化的问题。
 * 传入 vscode.env.machineId 即可保证同一台机器上密钥始终一致。
 */
export function deriveKeyFromSeed(seed: string): string {
  return crypto
    .createHash("sha256")
    .update("codingmaid-encryption-v2:" + seed)
    .digest("hex")
    .substring(0, KEY_LENGTH * 2);
}

/**
 * 使用 AES-256-GCM 加密明文
 * @returns 格式为 "iv:tag:ciphertext" 的 hex 编码字符串
 */
export function encrypt(plaintext: string, keyHex: string): string {
  const key = Buffer.from(keyHex, "hex");
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  let encrypted = cipher.update(plaintext, "utf8", "hex");
  encrypted += cipher.final("hex");
  const tag = cipher.getAuthTag().toString("hex");

  return `${iv.toString("hex")}:${tag}:${encrypted}`;
}

/**
 * 解密 AES-256-GCM 加密的数据
 * @param encryptedData "iv:tag:ciphertext" 格式的 hex 字符串
 */
export function decrypt(encryptedData: string, keyHex: string): string {
  const parts = encryptedData.split(":");
  if (parts.length !== 3) {
    throw new Error("Invalid encrypted data format");
  }

  const iv = Buffer.from(parts[0], "hex");
  const tag = Buffer.from(parts[1], "hex");
  const encrypted = parts[2];
  const key = Buffer.from(keyHex, "hex");

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);

  let decrypted = decipher.update(encrypted, "hex", "utf8");
  decrypted += decipher.final("utf8");

  return decrypted;
}

/**
 * 检查一个字符串是否为加密数据格式
 */
export function isEncrypted(value: string): boolean {
  return /^[0-9a-f]+:[0-9a-f]+:[0-9a-f]+$/i.test(value);
}
