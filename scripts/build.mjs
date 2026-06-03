/**
 * 构建脚本
 *
 * 编译 TS → 打包 .vsix
 * 输出路径: dist/codingmaid-v<version>.vsix
 */

import { execSync } from "child_process";
import { readFileSync, mkdirSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

// 读取版本号
const pkg = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
const version = pkg.version;

// 确保 dist 目录存在
mkdirSync(resolve(root, "dist"), { recursive: true });

// 编译
console.log("[build] Compiling...");
execSync("pnpm run compile", { cwd: root, stdio: "inherit" });

// 打包
const outFile = `dist/codingmaid-v${version}.vsix`;
console.log(`[build] Packaging -> ${outFile}...`);
execSync(`pnpm vsce package --no-dependencies --baseContentUrl . --baseImagesUrl . --out ${outFile}`, {
  cwd: root,
  stdio: "inherit",
});

console.log(`[build] Done: ${outFile}`);
