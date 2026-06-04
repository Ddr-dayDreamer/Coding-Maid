/**
 * ToolRegistry — 工具统一注册器
 *
 * 职责：
 * 1. 注册工具（name + schema + handler + doc）
 * 2. 对外提供 Schema 列表（给 LLM API）
 * 3. 对外提供 handler 路由（给 executor）
 * 4. 对外提供 doc 内容（给 MacroEngine {{tool.xxx}}）
 *
 * 新加工具只需：
 *   a. 在 src/tools/ 下创建 xxx.ts，导出 ToolRegistration
 *   b. 在 src/tools/index.ts 加一行 register()
 */

import type { ToolHandler, ToolExecutionContext, ToolExecutionResult } from "./types";

// ─── 类型定义 ───────────────────────────────────────────

export type ToolDefinition = {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: {
      type: "object";
      properties: Record<string, unknown>;
      required?: string[];
      additionalProperties?: boolean;
    };
  };
};

export type ToolRegistration = {
  /** 工具名称（用于 LLM API function calling） */
  name: string;
  /** 工具描述（用于 LLM API） */
  description: string;
  /** OpenAI function-calling 参数 Schema（手写，为了给 LLM 最好的描述） */
  parameters: ToolDefinition["function"]["parameters"];
  /** 运行时 Zod 校验 Schema（可选） */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  zodSchema?: any;
  /** 工具执行函数 */
  handler: ToolHandler;
  /** Markdown 文档 — 通过 {{tool.xxx}} 宏注入提示词 */
  doc: string;
};

// ─── ToolRegistry ────────────────────────────────────────

export class ToolRegistry {
  private tools = new Map<string, ToolRegistration>();
  /** 别名映射（如 Bash → bash, Read → read） */
  private aliases = new Map<string, string>();

  /**
   * 注册一个工具。
   * @param tool 工具注册信息
   * @param extraAliases 额外别名（如 ["Bash", "BASH"]）
   */
  register(tool: ToolRegistration, extraAliases?: string[]): void {
    this.tools.set(tool.name, tool);
    if (extraAliases) {
      for (const alias of extraAliases) {
        this.aliases.set(alias, tool.name);
      }
    }
  }

  /** 解析别名 → 规范名 */
  resolveName(name: string): string {
    return this.aliases.get(name) ?? name;
  }

  /** 获取 handler（通过别名也可） */
  getHandler(name: string): ToolHandler | undefined {
    return this.tools.get(this.resolveName(name))?.handler;
  }

  /**
   * 执行工具（参数解析 + handler 调用 + 错误包装）。
   * 外部只需要调这个方法，不需要自己走 getHandler → parse → handler 三步。
   */
  async execute(
    toolName: string,
    rawArguments: string,
    context: ToolExecutionContext
  ): Promise<ToolExecutionResult> {
    const handler = this.getHandler(toolName);
    if (!handler) {
      return { ok: false, name: toolName, error: `Unknown tool: ${toolName}` };
    }

    // 解析 JSON 参数
    let args: Record<string, unknown>;
    try {
      const parsed = JSON.parse(rawArguments);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return {
          ok: false,
          name: toolName,
          error: "InputParseError: Tool arguments must be a JSON object.",
        };
      }
      args = parsed as Record<string, unknown>;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        ok: false,
        name: toolName,
        error:
          `InputParseError: Failed to parse tool arguments: ${message}. ` +
          "Ensure the tool call arguments are valid JSON. Prefer Edit over Write for large existing-file changes.",
      };
    }

    // 调用 handler
    try {
      return await handler(args, context);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { ok: false, name: toolName, error: message };
    }
  }

  /** 获取工具文档（通过 {{tool.xxx}} 的 name 查找，不区分大小写，_ → -） */
  getToolDoc(name: string): string | undefined {
    const normalizedTarget = name.toLowerCase().replace(/_/g, "-");
    // 先查规范名
    const canonical = this.resolveName(name);
    const direct = this.tools.get(canonical);
    if (direct) return direct.doc;
    // 再模糊查（大小写 + _/- 归一化）
    for (const [, tool] of this.tools) {
      if (tool.name.toLowerCase().replace(/_/g, "-") === normalizedTarget) {
        return tool.doc;
      }
    }
    return undefined;
  }

  /** 获取所有工具的定义（OpenAI function-calling 格式），可按 availableTools 过滤 */
  getToolDefinitions(filter?: string[]): ToolDefinition[] {
    let list: ToolRegistration[];
    if (filter && filter.length > 0) {
      list = [];
      for (const name of filter) {
        const tool = this.tools.get(name);
        if (tool) list.push(tool);
      }
    } else {
      list = [...this.tools.values()];
    }
    return list.map((t) => ({
      type: "function",
      function: {
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      },
    }));
  }

  /** 判断工具是否存在 */
  has(name: string): boolean {
    return this.tools.has(name) || this.aliases.has(name);
  }

  /** 获取所有注册的工具名 */
  getNames(): string[] {
    return [...this.tools.keys()];
  }
}
