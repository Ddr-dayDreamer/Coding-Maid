/**
 * 宏引擎
 *
 * 职责：
 * 1. 解析 {{...}} 宏语法（内置宏 + setvar/getvar 变量存储）
 * 2. 从模板目录读取工具文档、skill 文档等
 * 3. 构建运行时上下文
 *
 * 独立于 PresetManager，可单独测试和复用。
 */

import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import type { MacroContext } from "./session-types";

// ─── MacroEngine ─────────────────────────────────────────

export class MacroEngine {
  private readonly extensionRoot: string;
  /** 会话级变量存储，跨条目、跨轮对话 */
  private variables: Map<string, string>;

  constructor(extensionRoot: string) {
    this.extensionRoot = extensionRoot;
    this.variables = new Map();
  }

  // ═══════════════════════════════════════════════════════
  //  变量存储
  // ═══════════════════════════════════════════════════════

  /** 设置会话变量 */
  setVariable(key: string, value: string): void {
    this.variables.set(key, value);
  }

  /** 获取会话变量 */
  getVariable(key: string): string | undefined {
    return this.variables.get(key);
  }

  /** 获取所有变量快照 */
  getAllVariables(): Record<string, string> {
    const result: Record<string, string> = {};
    for (const [key, value] of this.variables) {
      result[key] = value;
    }
    return result;
  }

  /** 重置变量存储（用于新会话） */
  resetVariables(): void {
    this.variables.clear();
  }

  // ═══════════════════════════════════════════════════════
  //  宏解析
  // ═══════════════════════════════════════════════════════

  /**
   * 渲染单条内容中的所有宏。
   *
   * 处理顺序：
   * 1. {{setvar::key::val}} — 提取并存储变量，从内容中移除
   * 2. {{getvar::key}} — 替换为变量存储中的值
   * 3. {{tool.xxx}} — 替换为工具描述文档
   * 4. {{skill.xxx}} — 替换为内建 skill 文档
   * 5. {{runtime_context}} — 替换为运行时上下文
   * 6. {{agents_md}} — 替换为 AGENTS.md 内容
   * 7. {{date}} / {{time}} / {{model}} / {{user}} / {{char}} / {{workspace}} — 简单替换
   */
  render(content: string, context: MacroContext): string {
    if (!content) return content;

    let result = content;

    // 1. {{setvar::key::val}}
    result = result.replace(/\{\{setvar::(.+?)::(.+?)\}\}/g, (_match, key: string, val: string) => {
      this.variables.set(key.trim(), val.trim());
      return "";
    });

    // 2. {{getvar::key}}
    result = result.replace(/\{\{getvar::(.+?)\}\}/g, (_match, key: string) => {
      return this.variables.get(key.trim()) ?? "";
    });

    // 3. {{tool.xxx}}
    result = result.replace(/\{\{tool\.(.+?)\}\}/g, (_match, toolName: string) => {
      return this.readToolDoc(toolName);
    });

    // 4. {{skill.xxx}}
    result = result.replace(/\{\{skill\.(.+?)\}\}/g, (_match, skillName: string) => {
      return this.readSkillDoc(skillName);
    });

    // 5. {{runtime_context}}
    result = result.replace(/\{\{runtime_context\}\}/g, () => {
      return this.buildRuntimeContext(context);
    });

    // 6. {{agents_md}}
    result = result.replace(/\{\{agents_md\}\}/g, () => {
      return this.readAgentsMd(context.projectRoot);
    });

    // 7. 简单替换
    result = result.replace(/\{\{date\}\}/g, () => {
      return new Date().toLocaleDateString("zh-CN", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      });
    });

    result = result.replace(/\{\{time\}\}/g, () => {
      return new Date().toLocaleTimeString("zh-CN", {
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      });
    });

    result = result.replace(/\{\{model\}\}/g, () => {
      return context.model || "";
    });

    result = result.replace(/\{\{user\}\}/g, () => {
      return this.variables.get("user") ?? context.userName ?? "user";
    });

    result = result.replace(/\{\{char\}\}/g, () => {
      return this.variables.get("char") ?? context.charName ?? "coding maid";
    });

    result = result.replace(/\{\{workspace\}\}/g, () => {
      return context.projectRoot;
    });

    return result;
  }

  // ═══════════════════════════════════════════════════════
  //  内部方法
  // ═══════════════════════════════════════════════════════

  /** 从 templates/tools/ 读取工具描述文档 */
  private readToolDoc(toolName: string): string {
    const toolsDir = path.join(this.extensionRoot, "templates", "tools");
    const files = fs.readdirSync(toolsDir);
    const match = files.find((f) => path.parse(f).name.toLowerCase() === toolName.toLowerCase());
    if (!match) return "";

    try {
      return fs.readFileSync(path.join(toolsDir, match), "utf8").trim();
    } catch {
      return "";
    }
  }

  /** 读取单个 skill 文档 */
  private readSkillDoc(skillName: string): string {
    const skillsDir = path.join(this.extensionRoot, "templates", "skills");
    const filename = `${skillName}.md`;
    const fullPath = path.join(skillsDir, filename);
    try {
      const content = fs.readFileSync(fullPath, "utf8").trim();
      return `<${skillName}-skill>\n${content}\n</${skillName}-skill>`;
    } catch {
      return "";
    }
  }

  /** 构建运行时上下文 */
  private buildRuntimeContext(context: MacroContext): string {
    const env: Record<string, unknown> = {
      "root path": context.projectRoot,
      pwd: context.projectRoot,
      homedir: os.homedir(),
      "system info": `${os.type()} ${os.release()} ${os.arch()}`,
    };

    return `# Local Workspace Environment

\`\`\`json
${JSON.stringify(env, null, 2)}
\`\`\``;
  }

  /** 读取 AGENTS.md 指令 */
  private readAgentsMd(projectRoot: string): string {
    const candidates = [
      path.join(projectRoot, ".codingmaid", "AGENTS.md"),
      path.join(projectRoot, "AGENTS.md"),
      path.join(os.homedir(), ".codingmaid", "AGENTS.md"),
    ];

    for (const candidatePath of candidates) {
      try {
        if (fs.existsSync(candidatePath)) {
          const content = fs.readFileSync(candidatePath, "utf8").trim();
          if (content) return content;
        }
      } catch {
        continue;
      }
    }

    return "";
  }
}
