/**
 * AskUserQuestion — 工具定义
 *
 * 向用户提问以澄清需求或获取决策。
 */

import { handleAskUserQuestionTool } from "../handler/ask-user-question-handler";
import type { ToolRegistration } from "../registry";

export const askUserQuestionTool: ToolRegistration = {
  name: "AskUserQuestion",
  description:
    "When the task has ambiguities or multiple implementation approaches, use this tool to pause execution and ask the user a question to get clarification or make a decision.",
  parameters: {
    type: "object",
    properties: {
      questions: {
        type: "array",
        description: "Questions to present to the user. Usually only one question is needed at a time.",
        items: {
          type: "object",
          properties: {
            question: {
              type: "string",
              description: "The question to ask the user.",
            },
            multiSelect: {
              type: "boolean",
              description: "Whether the user may choose multiple options.",
            },
            options: {
              type: "array",
              description: "A list of predefined options for the user to choose from.",
              items: {
                type: "object",
                properties: {
                  label: {
                    type: "string",
                    description: "The display text for the option.",
                  },
                  description: {
                    type: "string",
                    description:
                      "A detailed explanation or hint about this option to help the user understand what happens if they choose it.",
                  },
                },
                required: ["label"],
              },
            },
            context: {
              type: "string",
              description:
                "Optional context explaining why this question is being asked, to help the user understand what they are deciding on.",
            },
          },
          required: ["question"],
        },
      },
    },
    required: ["questions"],
    additionalProperties: false,
  },
  handler: handleAskUserQuestionTool,
  doc: `## AskUserQuestion

Use this tool when you need to ask the user questions during execution. This allows you to:
1. Gather user preferences or requirements
2. Clarify ambiguous instructions
3. Get decisions on implementation choices as you work
4. Offer choices to the user about what direction to take.

Usage notes:
- Users will always be able to select "Other" to provide custom text input
- Use multiSelect: true to allow multiple answers to be selected for a question
- If you recommend a specific option, make that the first option in the list and add "(Recommended)" at the end of the label`,
};
