/**
 * 预设渲染测试 — 直接读取 buildin_preset.json 输出实际 prompt
 *
 * 运行：npm run test:single src/tests/preset-render.test.ts
 *
 * 每次运行都直接从模板文件读取，不缓存，方便迭代 JSON。
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { MacroEngine } from "../preset-macros";
import type { PresetDefinition } from "../session-types";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

test("render buildin preset and print result", () => {
  // 直接读取 JSON 文件，不走 PresetManager 缓存
  const presetPath = path.join(repoRoot, "templates", "buildin_preset.json");
  const preset: PresetDefinition = JSON.parse(fs.readFileSync(presetPath, "utf8"));

  // 直接用 MacroEngine 渲染
  const macroEngine = new MacroEngine(repoRoot);
  const macroContext = {
    projectRoot: repoRoot,
    model: "deepseek-v4-pro",
    extensionRoot: repoRoot,
  };

  console.log("\n════════════════════════════════════════════");
  console.log(`预设: ${preset.name}`);
  console.log(`描述: ${preset.description}`);
  console.log(`可用工具: ${preset.availableTools.join(", ")}`);
  console.log(`总条目数: ${preset.entries.length}`);
  console.log(`启用条目: ${preset.entries.filter((e) => e.enabled).length}`);
  console.log("════════════════════════════════════════════\n");

  // 只渲染启用的条目
  const enabledEntries = preset.entries.filter((e) => e.enabled);
  let renderedCount = 0;

  for (const entry of enabledEntries) {
    const content = macroEngine.render(entry.content, macroContext);
    console.log(`──────────────────────────────────────────`);
    console.log(`[#${renderedCount}] ${entry.name}`);
    console.log(`    角色: ${entry.role}`);
    console.log(`──────────────────────────────────────────`);
    console.log(content);
    console.log();
    renderedCount++;
  }

  // 验证：启用的条目才应该出现
  assert.equal(renderedCount, preset.entries.filter((e) => e.enabled).length);

  for (const entry of enabledEntries) {
    assert.ok(entry.content.length > 0);
  }

  console.log("════════════════════════════════════════════");
  console.log(`✅ 渲染完成，共 ${renderedCount} 条（已过滤关闭条目）`);
  console.log("════════════════════════════════════════════\n");
});
