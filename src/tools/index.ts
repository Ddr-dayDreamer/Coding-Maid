/**
 * 工具 barrel 文件
 *
 * 注册所有内置工具并导出 registry 实例。
 * 加工具只需：在 src/tools/definitions/ 新建定义，在这里加一行 register()。
 * webview 那边的工具名列表维护在 src/tools/builtin-tools.ts（纯数据，零依赖）。
 *
 * 使用方式:
 *   import { registry } from "./tools"
 *   registry.getNames()            // 获取所有注册的工具名
 *   registry.getToolDefinitions()  // 获取 OpenAI schema
 *   registry.getHandler(name)      // 获取 handler
 *   registry.getToolDoc(name)      // 获取 {{tool.xxx}} 文档
 */

import { ToolRegistry } from "./registry";
import { bashTool } from "./definitions/bash";
import { readTool } from "./definitions/read";
import { writeTool } from "./definitions/write";
import { editTool } from "./definitions/edit";
import { askUserQuestionTool } from "./definitions/ask-user-question";
import { updatePlanTool } from "./definitions/update-plan";
import { searchTool } from "./definitions/search";
import { listDirTool } from "./definitions/list-dir";
import { findReferencesTool } from "./definitions/find-references";
import { renameSymbolTool } from "./definitions/rename-symbol";
import { getErrorsTool } from "./definitions/get-errors";
import { fetchWebpageTool } from "./definitions/fetch-webpage";
import { memoryTool } from "./definitions/memory";

export const registry = new ToolRegistry();

registry.register(bashTool, ["Bash", "BASH"]);
registry.register(readTool, ["Read", "READ"]);
registry.register(writeTool, ["Write", "WRITE"]);
registry.register(editTool, ["Edit", "EDIT"]);
registry.register(askUserQuestionTool);
registry.register(updatePlanTool);
registry.register(searchTool);
registry.register(listDirTool);
registry.register(findReferencesTool);
registry.register(renameSymbolTool);
registry.register(getErrorsTool);
registry.register(fetchWebpageTool);
registry.register(memoryTool);

export type { ToolRegistry, ToolRegistration, ToolDefinition } from "./registry";
