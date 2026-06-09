import { registry } from "./index";
import type { McpManager } from "../mcp/mcp-manager";
import type {
  CreateOpenAIClient,
  ProcessTimeoutControl,
  ToolCall,
  ToolExecutionContext,
  ToolExecutionResult,
} from "./types";

export type ToolExecutionHooks = {
  onProcessStart?: (processId: string | number, command: string) => void;
  onProcessExit?: (processId: string | number) => void;
  onProcessStdout?: (processId: string | number, chunk: string) => void;
  onProcessTimeoutControl?: (processId: string | number, control: ProcessTimeoutControl | null) => void;
  onBeforeFileMutation?: (filePath: string) => void;
  onAfterFileMutation?: (filePath: string) => void;
  shouldStop?: () => boolean;
};

export type ToolCallExecution = {
  toolCallId: string;
  content: string;
  result: ToolExecutionResult;
};

export class ToolExecutor {
  private readonly projectRoot: string;
  private readonly createOpenAIClient?: CreateOpenAIClient;
  private readonly mcpManager?: McpManager;

  constructor(projectRoot: string, createOpenAIClient?: CreateOpenAIClient, mcpManager?: McpManager) {
    this.projectRoot = projectRoot;
    this.createOpenAIClient = createOpenAIClient;
    this.mcpManager = mcpManager;
  }

  async executeToolCalls(
    sessionId: string,
    toolCalls: unknown[],
    hooks?: ToolExecutionHooks
  ): Promise<ToolCallExecution[]> {
    const parsedCalls = toolCalls
      .map((toolCall) => this.parseToolCall(toolCall))
      .filter((toolCall): toolCall is ToolCall => Boolean(toolCall));

    const executions: ToolCallExecution[] = [];
    for (const toolCall of parsedCalls) {
      if (hooks?.shouldStop?.()) {
        break;
      }
      const result = await this.executeToolCall(sessionId, toolCall, hooks);
      executions.push({
        toolCallId: toolCall.id,
        content: this.formatToolResult(result),
        result,
      });
      if (hooks?.shouldStop?.()) {
        break;
      }
    }
    return executions;
  }

  private parseToolCall(toolCall: unknown): ToolCall | null {
    if (!toolCall || typeof toolCall !== "object") {
      return null;
    }

    const record = toolCall as {
      id?: unknown;
      type?: unknown;
      function?: { name?: unknown; arguments?: unknown };
    };

    if (typeof record.id !== "string") {
      return null;
    }

    const functionRecord = record.function;
    if (!functionRecord || typeof functionRecord !== "object") {
      return null;
    }

    if (typeof functionRecord.name !== "string") {
      return null;
    }

    const rawArguments = typeof functionRecord.arguments === "string" ? functionRecord.arguments : "";

    return {
      id: record.id,
      type: "function",
      function: {
        name: functionRecord.name,
        arguments: rawArguments,
      },
    };
  }

  private async executeToolCall(
    sessionId: string,
    toolCall: ToolCall,
    hooks?: ToolExecutionHooks,
    /** 跳过审批检查（审批通过后的执行路径） */
    skipApprovalCheck?: boolean
  ): Promise<ToolExecutionResult> {
    const toolName = toolCall.function.name;

    // ── 审批检查 ──
    // 在执行前检查此工具是否需要用户审批，或是否被工具级预检器自动拒绝
    if (!skipApprovalCheck) {
      const approvalCheck = registry.checkApproval(toolName, toolCall.function.arguments);
      if (approvalCheck.autoReject) {
        return {
          ok: false,
          name: toolName,
          error: approvalCheck.rejectReason ?? "Tool call was rejected by pre-check.",
          autoReject: true,
          autoRejectReason: approvalCheck.rejectReason,
        };
      }
      if (approvalCheck.requiresApproval) {
        return {
          ok: true,
          name: toolName,
          pendingApproval: {
            toolCallId: toolCall.id,
            toolName,
            params: approvalCheck.parsedArgs,
            summary: approvalCheck.summary,
          },
          awaitUserResponse: true,
        };
      }
    }

    // MCP 工具走独立路由
    if (this.mcpManager?.isMcpTool(toolName)) {
      try {
        const parsed = JSON.parse(toolCall.function.arguments || "{}");
        const args = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
        return this.mcpManager.executeMcpTool(toolName, args);
      } catch {
        return this.mcpManager.executeMcpTool(toolName, {});
      }
    }

    // 内置工具通过 registry.execute（含参数解析 + 错误包装）
    return registry.execute(toolName, toolCall.function.arguments, {
      sessionId,
      projectRoot: this.projectRoot,
      toolCall,
      createOpenAIClient: this.createOpenAIClient,
      onProcessStart: hooks?.onProcessStart,
      onProcessExit: hooks?.onProcessExit,
      onProcessStdout: hooks?.onProcessStdout,
      onProcessTimeoutControl: hooks?.onProcessTimeoutControl,
      onBeforeFileMutation: hooks?.onBeforeFileMutation,
      onAfterFileMutation: hooks?.onAfterFileMutation,
    });
  }

  /**
   * 解析 tool call 用于审批检查。
   * 返回 { id, name, rawArguments } 或 null。
   */
  parseToolCallForApproval(toolCall: unknown): { id: string; name: string; rawArguments: string } | null {
    if (!toolCall || typeof toolCall !== "object") return null;
    const record = toolCall as { id?: unknown; function?: { name?: unknown; arguments?: unknown } };
    if (typeof record.id !== "string") return null;
    const fn = record.function;
    if (!fn || typeof fn !== "object") return null;
    if (typeof fn.name !== "string") return null;
    return {
      id: record.id,
      name: fn.name,
      rawArguments: typeof fn.arguments === "string" ? fn.arguments : "",
    };
  }

  /**
   * 公开版本：执行单个 tool call（用于审批后的执行）。
   * 跳过审批检查，因为调用方已确保用户已批准。
   */
  async executeToolCallRaw(
    sessionId: string,
    toolCall: ToolCall,
    hooks?: ToolExecutionHooks
  ): Promise<ToolExecutionResult> {
    return this.executeToolCall(sessionId, toolCall, hooks, true);
  }

  formatToolResult(result: ToolExecutionResult): string {
    const payload: Record<string, unknown> = {
      ok: result.ok,
      name: result.name,
    };

    if (typeof result.output !== "undefined") {
      payload.output = result.output;
    }

    if (result.error) {
      payload.error = result.error;
    }

    if (result.metadata && Object.keys(result.metadata).length > 0) {
      payload.metadata = result.metadata;
    }

    if (result.awaitUserResponse === true) {
      payload.awaitUserResponse = true;
    }

    if (result.autoReject === true) {
      payload.autoReject = true;
      payload.autoRejectReason = result.autoRejectReason;
    }

    return JSON.stringify(payload, null, 2);
  }
}
