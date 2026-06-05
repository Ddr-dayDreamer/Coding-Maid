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
import type { MacroContext } from "../session/types";
import { registry } from "../tools/index";
import { readFileContent } from "../utils/file-utils";

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
   * 6. {{global_memory}} / {{repo_memory}} — 替换为记忆目录中的文件内容
   * 7. {{editor_selection}} — 替换为当前 VS Code 编辑器中选中的内容（含定位）
   * 8. {{active_file}} — 替换为当前活动编辑器文件的全文
   * 9. {{attached_files}} — 替换为用户附加的所有文件内容
   * 10. {{date}} / {{time}} / {{model}} / {{user}} / {{char}} / {{workspace}} — 简单替换
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

    // 6. {{global_memory}} / {{global_memory.filename}} / {{repo_memory}} / {{repo_memory.filename}}
    result = result.replace(/\{\{global_memory(?:\.(.+?))?\}\}/g, (_match, filename: string | undefined) => {
      return this.readMemoryDir("global", context.projectRoot, filename);
    });
    result = result.replace(/\{\{repo_memory(?:\.(.+?))?\}\}/g, (_match, filename: string | undefined) => {
      return this.readMemoryDir("project", context.projectRoot, filename);
    });

    // 7. {{editor_selection}}
    result = result.replace(/\{\{editor_selection\}\}/g, () => {
      return this.readEditorSelection(context);
    });

    // 8. {{active_file}}
    result = result.replace(/\{\{active_file\}\}/g, () => {
      return this.readActiveFile(context);
    });

    // 9. {{attached_files}}
    result = result.replace(/\{\{attached_files\}\}/g, () => {
      return this.readAttachedFiles(context);
    });

    // 10. 简单替换
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

  /** 从 ToolRegistry 读取工具描述文档 */
  private readToolDoc(toolName: string): string {
    return registry.getToolDoc(toolName) ?? "";
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

  /** 读取当前编辑器选中内容（从磁盘读取指定行范围） */
  private readEditorSelection(context: MacroContext): string {
    const sel = context.editorSelection;
    if (!sel) return "";
    try {
      const result = readFileContent({
        filePath: sel.filePath,
        startLine: sel.startLine,
        endLine: sel.endLine,
      });
      if (!result.content) return "";
      const location =
        sel.startLine === sel.endLine
          ? `${sel.filePath}:${sel.startLine}`
          : `${sel.filePath}:${sel.startLine}-${sel.endLine}`;
      return `[${location}]\n\`\`\`\n${result.content}\n\`\`\``;
    } catch {
      return "";
    }
  }

  /** 读取当前活动编辑器文件的全文 */
  private readActiveFile(context: MacroContext): string {
    const filePath = context.activeFile;
    if (!filePath) return "";
    try {
      const result = readFileContent({ filePath });
      if (!result.content) return "";
      const location = result.truncated
        ? `${filePath} (${result.totalLines} lines, ${result.omittedLines} omitted)`
        : `${filePath} (${result.totalLines} lines)`;
      return `[${location}]\n\`\`\`\n${result.content}\n\`\`\``;
    } catch {
      return "";
    }
  }

  /** 读取用户附加的所有文件内容 */
  private readAttachedFiles(context: MacroContext): string {
    const files = context.attachedFiles;
    if (!files || files.length === 0) return "";
    const parts: string[] = [];
    for (const filePath of files) {
      try {
        const result = readFileContent({ filePath });
        if (!result.content) continue;
        const location = result.truncated
          ? `${filePath} (${result.totalLines} lines, ${result.omittedLines} omitted)`
          : `${filePath} (${result.totalLines} lines)`;
        parts.push(`[${location}]\n\`\`\`\n${result.content}\n\`\`\``);
      } catch {
        continue;
      }
    }
    return parts.join("\n\n");
  }

  /**
   * 读取记忆目录中的文件内容。
   *
   * - 若传入了 filename，则只读取该指定文件，按 utf8 确定读取
   * - 若未传入 filename，则读取所有文件（递归展开子目录），按字典序排序
   * - 两种模式均保证确定性的输出以命中模型输入缓存
   * - 若目录不存在或文件不存在，返回空字符串
   */
  private readMemoryDir(scope: "global" | "project", projectRoot: string, filename?: string): string {
    const memoryRoot =
      scope === "global"
        ? path.join(os.homedir(), ".codingmaid", "memory")
        : path.join(projectRoot, ".codingmaid", "memory");

    try {
      if (!fs.existsSync(memoryRoot)) return "";
    } catch {
      return "";
    }

    const label = scope === "global" ? "Global Memory" : "Repository Memory";

    // ── 指定文件名模式 ──
    if (filename) {
      // 支持子路径，如 "subdir/file.md"
      const normalizedFilename = filename.replace(/\\/g, "/");
      const targetPath = path.join(memoryRoot, normalizedFilename);
      try {
        if (!fs.existsSync(targetPath)) return "";
        const content = fs.readFileSync(targetPath, "utf8");
        return `<${label}>\n<memory-file path="${normalizedFilename}">\n${content}\n</memory-file>\n</${label}>`;
      } catch {
        return "";
      }
    }

    // ── 全量模式 ──
    const files = this.collectFilesSorted(memoryRoot);
    if (files.length === 0) return "";

    const parts: string[] = [];
    for (const filePath of files) {
      try {
        const relPath = path.relative(memoryRoot, filePath).replace(/\\/g, "/");
        const content = fs.readFileSync(filePath, "utf8");
        parts.push(`<memory-file path="${relPath}">\n${content}\n</memory-file>`);
      } catch {
        continue;
      }
    }

    if (parts.length === 0) return "";

    return `<${label}>\n${parts.join("\n\n")}\n</${label}>`;
  }

  /** 递归收集目录下所有文件，按路径字典序排序 */
  private collectFilesSorted(dirPath: string): string[] {
    const results: string[] = [];
    try {
      const entries = fs.readdirSync(dirPath, { withFileTypes: true }).sort((a, b) =>
        a.name.localeCompare(b.name),
      );
      for (const entry of entries) {
        const fullPath = path.join(dirPath, entry.name);
        if (entry.isDirectory()) {
          results.push(...this.collectFilesSorted(fullPath));
        } else if (entry.isFile()) {
          results.push(fullPath);
        }
      }
    } catch {
      // 跳过无法读取的目录
    }
    return results;
  }
}
