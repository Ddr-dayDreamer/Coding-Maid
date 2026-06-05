/**
 * 提示词预设管理器
 *
 * 职责：
 * 1. 扫描 ~/.codingmaid/presets/ 下的所有预设
 * 2. 预设的 CRUD（加载、保存、删除）
 * 3. 渲染预设条目（委托给 MacroEngine）
 * 4. 默认预设创建与导入/导出
 */

import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import type { PresetDefinition, PresetEntry, PresetMeta, MacroContext, SessionMessage } from "./session-types";
import type { SessionMessageBuilder } from "./session-message-builder";
import { MacroEngine } from "./preset-macros";
import { registry } from "./tools/index";

// ─── 常量 ────────────────────────────────────────────────

const PRESETS_DIR_NAME = "presets";
const PRESET_FILE_NAME = "preset.json";
const DEFAULT_PRESET_NAME = "default";

// ─── 内置工具列表 ────────────────────────────────────────

const ALL_TOOLS = ["bash", "read", "write", "edit", "AskUserQuestion", "UpdatePlan"] as const;

// ─── PresetManager ───────────────────────────────────────

export class PresetManager {
  private readonly presetsDir: string;
  private readonly extensionRoot: string;
  /** 宏引擎 */
  readonly macroEngine: MacroEngine;

  constructor(extensionRoot: string, presetsDir?: string) {
    this.extensionRoot = extensionRoot;
    this.presetsDir = presetsDir ?? path.join(os.homedir(), ".codingmaid", PRESETS_DIR_NAME);
    this.macroEngine = new MacroEngine(extensionRoot);
    this.ensureDirectory();
  }

  // ═══════════════════════════════════════════════════════
  //  预设 CRUD
  // ═══════════════════════════════════════════════════════

  /** 扫描 presets 目录，返回所有预设的元信息列表 */
  listPresets(): PresetMeta[] {
    this.ensureDirectory();

    const metas: PresetMeta[] = [];
    try {
      const entries = fs.readdirSync(this.presetsDir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const presetPath = path.join(this.presetsDir, entry.name, PRESET_FILE_NAME);
        if (!fs.existsSync(presetPath)) continue;

        try {
          const def = JSON.parse(fs.readFileSync(presetPath, "utf8")) as PresetDefinition;
          metas.push({
            name: entry.name,
            displayName: def.name,
            description: def.description ?? "",
            path: presetPath,
          });
        } catch {
          continue;
        }
      }
    } catch {
      // 目录不存在时返回空列表
    }

    return metas;
  }

  /** 加载指定预设 */
  loadPreset(name: string): PresetDefinition {
    const presetPath = this.getPresetPath(name);
    if (!fs.existsSync(presetPath)) {
      throw new Error(`Preset "${name}" not found at ${presetPath}`);
    }
    return JSON.parse(fs.readFileSync(presetPath, "utf8")) as PresetDefinition;
  }

  /** 保存预设（创建或覆盖） */
  savePreset(name: string, definition: PresetDefinition): void {
    const dirPath = path.join(this.presetsDir, name);
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
    }
    const presetPath = path.join(dirPath, PRESET_FILE_NAME);
    fs.writeFileSync(presetPath, JSON.stringify(definition, null, 2), "utf8");
  }

  /** 删除预设 */
  deletePreset(name: string): void {
    const dirPath = path.join(this.presetsDir, name);
    if (fs.existsSync(dirPath)) {
      fs.rmSync(dirPath, { recursive: true, force: true });
    }
  }

  // ═══════════════════════════════════════════════════════
  //  默认预设
  // ═══════════════════════════════════════════════════════

  /** 确保默认预设存在，不存在则自动创建 */
  ensureDefaultPreset(): PresetDefinition {
    const presetPath = this.getPresetPath(DEFAULT_PRESET_NAME);
    if (fs.existsSync(presetPath)) {
      return this.loadPreset(DEFAULT_PRESET_NAME);
    }
    const def = this.buildDefaultPreset();
    this.savePreset(DEFAULT_PRESET_NAME, def);
    return def;
  }

  /** 从 buildin preset JSON 文件读取默认预设定义 */
  private buildDefaultPreset(): PresetDefinition {
    const buildinPath = path.join(this.extensionRoot, "templates", "buildin_preset.json");
    try {
      const content = fs.readFileSync(buildinPath, "utf8");
      return JSON.parse(content) as PresetDefinition;
    } catch {
      return {
        name: "默认编程助手",
        description: "Coding Maid 默认行为",
        availableTools: [...registry.getNames()],
        entries: [
          {
            name: "系统设定",
            role: "system",
            content: "你是 Coding Maid，一个全能的编程助手。",
            enabled: true,
          },
        ],
      };
    }
  }

  // ═══════════════════════════════════════════════════════
  //  预设渲染
  // ═══════════════════════════════════════════════════════

  /**
   * 渲染预设的所有条目。
   * 按数组顺序处理，依次解析宏。
   * 返回启用且解析后的条目列表（保持 role 和原始顺序）。
   */
  renderPreset(preset: PresetDefinition, context: MacroContext): PresetEntry[] {
    const rendered: PresetEntry[] = [];
    // 从预设 JSON 顶层字段读取 char/user，作为宏的默认值
    const fullContext: MacroContext = {
      ...context,
      charName: context.charName || preset.char || preset.name,
      userName: context.userName || preset.user,
    };

    for (const entry of preset.entries) {
      if (!entry.enabled) continue;

      rendered.push({
        ...entry,
        content: this.macroEngine.render(entry.content, fullContext),
      });
    }

    return rendered;
  }

  // ═══════════════════════════════════════════════════════
  //  消息组装
  // ═══════════════════════════════════════════════════════

  /**
   * 将渲染后的预设条目和对话记录组装为 SessionMessage 数组。
   * chat_history 条目会在其位置展开为对话记录，其余条目按 role 转为对应消息。
   */
  buildMessages(
    sessionId: string,
    renderedEntries: PresetEntry[],
    conversationMessages: SessionMessage[],
    messageBuilder: SessionMessageBuilder
  ): SessionMessage[] {
    const messages: SessionMessage[] = [];

    for (const entry of renderedEntries) {
      if (entry.role === "chat_history") {
        // 在此位置展开对话记录
        for (const msg of conversationMessages) {
          messages.push(msg);
        }
        continue;
      }

      switch (entry.role) {
        case "user":
          messages.push(messageBuilder.buildUserMessage(sessionId, { text: entry.content }));
          break;
        case "assistant":
          messages.push(messageBuilder.buildAssistantMessage(sessionId, entry.content, null));
          break;
        default:
          messages.push(messageBuilder.buildSystemMessage(sessionId, entry.content, null, false, { isPreset: true }));
          break;
      }
    }

    return messages;
  }

  // ═══════════════════════════════════════════════════════
  //  导入 / 导出
  // ═══════════════════════════════════════════════════════

  /** 从文件导入预设 */
  importPreset(filePath: string): PresetMeta {
    const content = fs.readFileSync(filePath, "utf8");
    const def = JSON.parse(content) as PresetDefinition;

    const name = path.basename(filePath, path.extname(filePath));
    this.savePreset(name, def);

    return {
      name,
      displayName: def.name,
      description: def.description ?? "",
      path: this.getPresetPath(name),
    };
  }

  /** 导出预设到指定文件 */
  exportPreset(name: string, targetPath: string): void {
    const def = this.loadPreset(name);
    fs.writeFileSync(targetPath, JSON.stringify(def, null, 2), "utf8");
  }

  // ═══════════════════════════════════════════════════════
  //  内部工具方法
  // ═══════════════════════════════════════════════════════

  private ensureDirectory(): void {
    if (!fs.existsSync(this.presetsDir)) {
      fs.mkdirSync(this.presetsDir, { recursive: true });
    }
  }

  private getPresetPath(name: string): string {
    return path.join(this.presetsDir, name, PRESET_FILE_NAME);
  }
}
