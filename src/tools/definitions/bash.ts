/**
 * bash — 工具定义
 *
 * 执行 shell 命令。
 */

import { handleBashTool } from "../handler/bash-handler";
import { bashApprovalChecker } from "../approval-checkers";
import type { ToolRegistration } from "../registry";

export const bashTool: ToolRegistration = {
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
  handler: handleBashTool,
  approvalChecker: bashApprovalChecker,
  doc: `## Bash

Executes a given bash command. Working directory persists between commands; shell state (everything else) does not. The shell environment is initialized from the user's profile (bash or zsh).

On Windows, Bash runs through Git Bash (MSYS2/MinGW). This is NOT native Linux and NOT WSL — use POSIX syntax, but be aware:
- Some GNU tools (e.g. \`rg\`, \`tree\`, \`realpath\`) may NOT be installed. If a command reports "command not found", avoid retrying the same approach — prefer the dedicated tools listed below.
- In bash, file paths use POSIX form (e.g. /c/Users/...). In file tools (read/write/edit/list_dir/search), use Windows form (e.g. C:\\Users\\...).
- Output from Windows-native programs may be GBK-encoded. If you see mojibake, prefer the dedicated tools below.

This tool is best suited for development operations like git, npm, pnpm, docker, builds, and tests. For file operations, prefer the dedicated tools — they are more reliable across platforms:
- Listing a directory: prefer list_dir over ls / find
- Reading a file: prefer read over cat / head / tail
- Editing a file: prefer edit over sed / awk
- Writing a file: prefer write over echo > / cat <<EOF
- Searching file contents: prefer search over rg / grep -r / find
- Finding files by name: prefer search with mode="file" over find
- Getting compile/lint errors: prefer get_errors

IMPORTANT: Prefer purpose-built tools over ad-hoc shell pipelines when they are more accurate, safer, faster, or easier to understand:
- Use \`jq\` when you need to inspect, filter, or transform JSON output; prefer it over ad-hoc parsing with \`sed\`, \`awk\`, or Python one-liners.
- Prefer the \`search\` tool over \`rg\`/\`grep -r\`/\`find\` for code search — it works natively on every platform.

Before executing the command, please follow these steps:

1. Directory Verification:
   - If the command will create new directories or files, first use \`ls\` to verify the parent directory exists and is the correct location
   - For example, before running "mkdir foo/bar", first use \`ls foo\` to check that "foo" exists and is the intended parent directory

2. Command Execution:
   - Always quote file paths that contain spaces with double quotes (e.g., cd "path with spaces/file.txt")
   - Examples of proper quoting:
     - cd "/Users/name/My Documents" (correct)
     - cd /Users/name/My Documents (incorrect - will fail)
     - python "/path/with spaces/script.py" (correct)
     - python /path/with spaces/script.py (incorrect - will fail)
   - After ensuring proper quoting, execute the command.
   - Capture the output of the command.

Usage notes:
  - The command argument is required.
  - It is very helpful if you write a clear, concise description of what this command does. For simple commands, keep it brief (5-10 words). For complex commands (piped commands, obscure flags, or anything hard to understand at a glance), add enough context to clarify what it does.
  - If the output exceeds 30000 characters, output will be truncated before being returned to you.
  - Always prefer using the dedicated tools for these commands:
    - Read files: Use Read (NOT cat/head/tail)
    - Edit files: Use Edit (NOT sed/awk)
    - Write files: Use Write (NOT echo >/cat <<EOF)
    - Communication: Output text directly (NOT echo/printf)
  - When issuing multiple commands:
    - If the commands are independent and can run in parallel, make multiple Bash tool calls in a single message. For example, if you need to run "git status" and "git diff", send a single message with two Bash tool calls in parallel.
    - If the commands depend on each other and must run sequentially, use a single Bash call with '&&' to chain them together (e.g., \`git add . && git commit -m "message" && git push\`). For instance, if one operation must complete before another starts (like mkdir before cp, Write before Bash for git operations, or git add before git commit), run these operations sequentially instead.
    - Use ';' only when you need to run commands sequentially but don't care if earlier commands fail
    - DO NOT use newlines to separate commands (newlines are ok in quoted strings)
  - Try to maintain your current working directory throughout the session by using absolute paths and avoiding usage of \`cd\`. You may use \`cd\` if the User explicitly requests it.
    <good-example>
    pytest /foo/bar/tests
    </good-example>
    <bad-example>
    cd /foo/bar && pytest tests
    </bad-example>

\`\`\`json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "command": {
      "description": "The command to execute",
      "type": "string"
    },
    "description": {
      "description": "Clear, concise description of what this command does in active voice. Never use words like \\"complex\\" or \\"risk\\" in the description - just describe what it does.\\n\\nFor simple commands (git, npm, standard CLI tools), keep it brief (5-10 words):\\n- ls → \\"List files in current directory\\"\\n- git status → \\"Show working tree status\\"\\n- npm install → \\"Install package dependencies\\"\\n\\nFor commands that are harder to parse at a glance (piped commands, obscure flags, etc.), add enough context to clarify what it does:\\n- find . -name \\"*.tmp\\" -exec rm {} \\\\; → \\"Find and delete all .tmp files recursively\\"\\n- git reset --hard origin/main → \\"Discard all local changes and match remote main\\"\\n- curl -s url | jq '.data[]' → \\"Fetch JSON from URL and extract data array elements\\"",
      "type": "string"
    }
  },
  "required": [
    "command"
  ],
  "additionalProperties": false
}
\`\`\``,
};
