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
  description:
    "Execute shell commands in a persistent bash session. " +
    "Best suited to git, npm/pnpm, docker, builds, tests and other CLI operations. " +
    "For file operations (listing, reading, writing, editing, searching, error checking) the dedicated tools are a better fit — list_dir / read / write / edit / search / get_errors.",
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

### Prefer the dedicated tools for file operations

This tool is mainly for development/CLI operations: git, npm, pnpm, docker, builds, tests, running scripts.

For file operations the dedicated tools are the better choice — they are more reliable, cross-platform, and token-efficient:
- Listing a directory → \`list_dir\` (better than \`ls\`, \`dir\`, \`find\`, \`tree\`, \`Get-ChildItem\`)
- Reading a file → \`read\` (better than \`cat\`, \`head\`, \`tail\`, \`Get-Content\`)
- Editing a file → \`edit\` (better than \`sed\`, \`awk\`)
- Writing a file → \`write\` (better than \`echo >\`, \`cat <<EOF\`)
- Searching file contents → \`search\` (better than \`rg\`, \`grep -r\`, \`find\`)
- Finding files by name → \`search\` with \`mode: "file"\` (better than \`find\`)
- Getting compile/lint errors → \`get_errors\`
- Renaming a symbol → \`rename_symbol\`

So when you want to see what is in a folder, \`list_dir\` is the tool to reach for rather than \`ls\` / \`Get-ChildItem\`.

On Windows, Bash runs through Git Bash (MSYS2/MinGW). This is NOT native Linux and NOT WSL — use POSIX syntax, but be aware:
- Some GNU tools (e.g. \`rg\`, \`tree\`, \`realpath\`) may NOT be installed. If a command reports "command not found", avoid retrying the same approach — prefer the dedicated tools listed above.
- In bash, file paths use POSIX form (e.g. /c/Users/...). In file tools (read/write/edit/list_dir/search), use Windows form (e.g. C:\\Users\\...).
- Output from Windows-native programs may be GBK-encoded. If you see mojibake, prefer the dedicated tools above.

IMPORTANT: Prefer purpose-built tools over ad-hoc shell pipelines when they are more accurate, safer, faster, or easier to understand:
- Use \`jq\` when you need to inspect, filter, or transform JSON output; prefer it over ad-hoc parsing with \`sed\`, \`awk\`, or Python one-liners.
- Prefer the \`search\` tool over \`rg\`/\`grep -r\`/\`find\` for code search — it works natively on every platform.

Before executing the command, please follow these steps:

1. Directory Verification:
   - If the command will create new directories or files, first call the \`list_dir\` tool to verify the parent directory exists and is the correct location — it gives a clearer result than \`ls\` here
   - For example, before running "mkdir foo/bar", first call \`list_dir({ path: "<...>/foo" })\` to check that "foo" exists and is the intended parent directory

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
  - The dedicated tools are the better choice for these:
    - List directories: \`list_dir\` (cleaner than ls/dir/find/tree)
    - Read files: \`read\` (cleaner than cat/head/tail)
    - Edit files: \`edit\` (cleaner than sed/awk)
    - Write files: \`write\` (cleaner than echo >/cat <<EOF)
    - Search files: \`search\` (cleaner than rg/grep -r/find)
    - Communication: Output text directly (better than echo/printf)
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
