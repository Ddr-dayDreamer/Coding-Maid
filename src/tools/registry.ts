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

import type { ToolHandler, ToolExecutionContext, ToolExecutionResult, ToolApprovalChecker } from "./types";
import type { ApprovalMode, ApprovalConfig } from "../utils/global-settings";

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
  /**
   * 可选的工具级审批预检器。
   * 在 checkApproval() 中被调用，可以返回：
   * - allow:  直接放行（覆盖 settings 中的模式）
   * - reject: 自动拦截，不执行，向 LLM 返回错误原因
   * - require: 走正常审批流程（兜底）
   */
  approvalChecker?: ToolApprovalChecker;
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

  // ═══════════════════════════════════════════════════════
  //  审批配置
  // ═══════════════════════════════════════════════════════

  private approvalConfig: ApprovalConfig = {};

  /** 设置审批配置（来自 settings.json） */
  setApprovalConfig(config: ApprovalConfig | undefined): void {
    this.approvalConfig = config ?? {};
  }

  /** 获取当前审批配置的快照 */
  getApprovalConfig(): ApprovalConfig {
    return { ...this.approvalConfig };
  }

  /**
   * 获取某工具的审批模式。
   * 未在 settings 中配置的工具 → 默认 "require"（安全优先）。
   */
  getApprovalMode(toolName: string): ApprovalMode {
    const canonical = this.resolveName(toolName);
    const configured = this.approvalConfig[canonical];
    if (configured === "none" || configured === "require") {
      return configured;
    }
    // 未配置 → 默认 require
    return "require";
  }

  /**
   * 检查工具调用是否需要审批。
   * 返回是否需要审批 + 参数解析结果 + 人类可读摘要。
   *
   * 流程：
   * 1. 先运行工具级 approvalChecker（如果有）→ 可能 allow / reject / require
   * 2. 再查 settings 中的审批模式 → none / require
   * 3. 综合决定是否拦截
   */
  checkApproval(
    toolName: string,
    rawArguments: string
  ): {
    requiresApproval: boolean;
    autoReject: boolean;
    rejectReason?: string;
    parsedArgs: Record<string, unknown>;
    summary: string;
  } {
    const canonical = this.resolveName(toolName);
    const tool = this.tools.get(canonical);

    // 解析参数（工具级检查器和展示都需要）
    let parsedArgs: Record<string, unknown> = {};
    try {
      const parsed = JSON.parse(rawArguments);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        parsedArgs = parsed as Record<string, unknown>;
      }
    } catch {
      // 参数解析失败，不阻断流程
    }

    // 1. 优先运行工具级审批预检器
    if (tool?.approvalChecker) {
      const checkResult = tool.approvalChecker(parsedArgs);
      if (checkResult.action === "reject") {
        return {
          requiresApproval: false,
          autoReject: true,
          rejectReason: checkResult.reason,
          parsedArgs,
          summary: this.buildApprovalSummary(toolName, parsedArgs),
        };
      }
      if (checkResult.action === "allow") {
        return {
          requiresApproval: false,
          autoReject: false,
          parsedArgs,
          summary: this.buildApprovalSummary(toolName, parsedArgs),
        };
      }
      // "require" → 继续走 settings 模式检查
    }

    // 2. 查 settings 中的审批模式
    const mode = this.getApprovalMode(canonical);
    if (mode === "none") {
      return {
        requiresApproval: false,
        autoReject: false,
        parsedArgs,
        summary: this.buildApprovalSummary(toolName, parsedArgs),
      };
    }

    return {
      requiresApproval: true,
      autoReject: false,
      parsedArgs,
      summary: this.buildApprovalSummary(toolName, parsedArgs),
    };
  }

  private buildApprovalSummary(toolName: string, args: Record<string, unknown>): string {
    switch (toolName) {
      case "bash":
        return String(args.command ?? "");
      case "write":
        return `写入 ${args.file_path ?? "?"}`;
      case "edit":
        return `编辑 ${args.file_path ?? "?"}`;
      case "read":
        return `读取 ${args.file_path ?? "?"}`;
      case "search":
        return `搜索: ${String(args.query ?? "").slice(0, 100)}`;
      default:
        return `${toolName}(${JSON.stringify(args).slice(0, 200)})`;
    }
  }
}
