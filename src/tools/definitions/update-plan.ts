/**
 * UpdatePlan — 工具定义
 *
 * 更新任务计划与进度。
 */

import { handleUpdatePlanTool } from "../handler/update-plan-handler";
import type { ToolRegistration } from "../registry";

export const updatePlanTool: ToolRegistration = {
  name: "UpdatePlan",
  description:
    "Update the current task plan. The plan argument must be the complete markdown task list to show as the latest progress state.",
  parameters: {
    type: "object",
    properties: {
      plan: {
        type: "string",
        description:
          "The complete markdown task list, including task status markers such as [ ], [>], [x], and optional notes.",
      },
      explanation: {
        type: "string",
        description: "Optional short reason for changing the plan.",
      },
    },
    required: ["plan"],
    additionalProperties: false,
  },
  handler: handleUpdatePlanTool,
  doc: `## UpdatePlan

Updates the current task plan and progress display.

Usage:
- Use this tool for non-trivial multi-step tasks when a task list helps track execution progress.
- Pass the complete current task list every time. The latest call replaces the previous visible plan.
- The \`plan\` argument is a markdown string, not an array of step objects. If the requirement is in Chinese, then use Chinese for the markdown as well.
- Keep exactly one task marked \`[>]\` while work is in progress.
- Update the plan before starting a task, immediately after completing a task, and whenever tasks are split, merged, reordered, blocked, or changed.`,
};
