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
    hooks?: ToolExecutionHooks
  ): Promise<ToolExecutionResult> {
    const toolName = toolCall.function.name;

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

  private formatToolResult(result: ToolExecutionResult): string {
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

    return JSON.stringify(payload, null, 2);
  }
}
