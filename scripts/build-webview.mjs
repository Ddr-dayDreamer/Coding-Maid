/**
 * Webview 构建脚本
 *
 * 使用 esbuild + esbuild-svelte 打包 Svelte 前端
 */

import * as esbuild from "esbuild";
import esbuildSvelte from "esbuild-svelte";
import { sveltePreprocess } from "svelte-preprocess";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

await esbuild.build({
  entryPoints: [resolve(root, "resources", "webview", "main.ts")],
  bundle: true,
  format: "iife",
  target: "es2020",
  outfile: resolve(root, "resources", "webview", "bundle.js"),
  plugins: [
    esbuildSvelte({
      preprocess: sveltePreprocess(),
    }),
  ],
  logOverride: {
    "empty-import-meta": "silent",
  },
});
