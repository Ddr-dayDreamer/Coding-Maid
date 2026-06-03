import * as path from "path";
import { fileURLToPath } from "url";

/** 工具选项，控制哪些工具注册到 API */
type PromptToolOptions = {
  model?: string;
  webSearchEnabled?: boolean;
  /** 仅在此列表中的工具会被注册到 API，未指定时返回全部 */
  availableTools?: string[];
};

export function getExtensionRoot(): string {
  // Prefer `__dirname` which is always available in the CJS bundle output.
  // Fall back to `import.meta.url` for ESM test environments (tsx --test).
  if (typeof __dirname !== "undefined") {
    return path.resolve(__dirname, "..");
  }

  const currentFilePath = fileURLToPath(import.meta.url);
  return path.resolve(path.dirname(currentFilePath), "..");
}

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

export function getTools(_options: PromptToolOptions = {}, externalTools: ToolDefinition[] = []): ToolDefinition[] {
  const { availableTools } = _options;

  const allTools: ToolDefinition[] = [
    {
      type: "function",
      function: {
        name: "bash",
        description: "Execute shell commands in a persistent bash session.",
        parameters: {
          type: "object",
          properties: {
            command: {
              type: "string",
              description: "The shell command to execute",
            },
            description: {
              type: "string",
              description:
                'Clear, concise description of what this command does in active voice. Never use words like "complex" or "risk" in the description - just describe what it does.',
            },
          },
          required: ["command"],
          additionalProperties: false,
        },
      },
    },
    {
      type: "function",
      function: {
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
                },
                required: ["question", "options"],
              },
            },
          },
          required: ["questions"],
          additionalProperties: false,
        },
      },
    },
    {
      type: "function",
      function: {
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
      },
    },
    {
      type: "function",
      function: {
        name: "read",
        description: "Read files from the filesystem (text, images, PDFs, notebooks).",
        parameters: {
          type: "object",
          properties: {
            file_path: {
              type: "string",
              description: "UNIX-style path to file",
            },
            offset: {
              type: "number",
              description: "Line number to start reading from",
            },
            limit: {
              type: "number",
              description: "Number of lines to read",
            },
            pages: {
              type: "string",
              description: 'Page range for PDF files (e.g., "1-5", "3", "10-20"). Only applicable to PDF files.',
            },
          },
          required: ["file_path"],
          additionalProperties: false,
        },
      },
    },
    {
      type: "function",
      function: {
        name: "write",
        description: "Create files or overwrite them with a complete string payload. Prefer edit for existing files.",
        parameters: {
          type: "object",
          properties: {
            file_path: {
              type: "string",
              description: "Absolute path to file",
            },
            content: {
              type: "string",
              description: "Complete file content as a single string. Serialize JSON documents before writing.",
            },
          },
          required: ["file_path", "content"],
          additionalProperties: false,
        },
      },
    },
    {
      type: "function",
      function: {
        name: "edit",
        description: "Perform scoped string replacements in files.",
        parameters: {
          type: "object",
          properties: {
            file_path: {
              type: "string",
              description: "Absolute path to file. Optional when snippet_id is provided.",
            },
            snippet_id: {
              type: "string",
              description:
                "Snippet id returned by the Read or Edit tool to scope the search range after a partial read.",
            },
            old_string: {
              type: "string",
              description: "Exact text to replace inside the file or snippet scope",
            },
            new_string: {
              type: "string",
              description: "Replacement text (must differ from old_string)",
            },
            replace_all: {
              type: "boolean",
              description: "Replace all occurences of old_string (default false)",
              default: false,
            },
            expected_occurrences: {
              type: "number",
              description: "Expected number of matches, especially useful as a safety check with replace_all",
            },
          },
          required: ["old_string", "new_string"],
          additionalProperties: false,
        },
      },
    },
  ];

  allTools.push({
    type: "function",
    function: {
      name: "WebSearch",
      description: "Perform web searching using a natural language query.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description:
              "A search query phrased as a clear, specific natural language question or statement that includes key context.",
          },
        },
        required: ["query"],
        additionalProperties: false,
      },
    },
  });

  for (const tool of externalTools) {
    allTools.push(tool);
  }

  if (availableTools && availableTools.length > 0) {
    const allowed = new Set(availableTools.map((t: string) => t.toLowerCase()));
    return allTools.filter((t) => allowed.has(t.function.name.toLowerCase()));
  }

  return allTools;
}
