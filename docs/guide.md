# Deep Code Extension Guide

Technical guide for the Deep Code VS Code extension as implemented in the current codebase.

---

## Table of Contents

- [Overview](#overview)
- [Features](#features)
- [Code Structure](#code-structure)
- [Entry Points](#entry-points)
- [Core Components](#core-components)
- [Webview Communication Architecture](#webview-communication-architecture)
- [Data Flow](#data-flow)
- [Configuration](#configuration)
- [Dependencies](#dependencies)
- [UI Design](#ui-design)

---

## Overview

**Deep Code** is a VS Code sidebar extension that provides a persistent AI chat interface with tool execution, skill loading, and support for DeepSeek defaults as well as OpenAI-compatible APIs.

### Key Characteristics

- Webview-based chat UI with HTML/CSS templates under `resources/`
- Persistent sessions stored under `~/.deepcode/projects/<projectCode>/`
- Tool execution pipeline for `bash`, `read`, `write`, `edit`, and `AskUserQuestion`
- Skill discovery from `~/.agents/skills/`, `./.agents/skills/`, and legacy `./.deepcode/skills/`
- DeepSeek-first defaults with configurable OpenAI-compatible API settings

---

## Features

1. **Sessioned Chat** - Multiple conversations with persisted history and status
2. **Skills** - Discover, select, auto-match, and inject skill documents into a session
3. **Tool Calls** - Supports shell, file operations, and structured user clarification
4. **Markdown Rendering** - Assistant responses are rendered with `markdown-it`
5. **Interrupt** - Stop an active session from the UI
6. **Persistent Storage** - Session index and message history are stored on disk

---

## Code Structure

```text
deepcode/
├── src/
│   ├── extension.ts                 # VS Code activation + webview wiring
│   ├── session.ts                   # Session manager, storage, status, skills
│   ├── prompt.ts                    # System prompt and tool definitions
│   └── tools/
│       ├── executor.ts              # Tool dispatch
│       ├── bash-handler.ts          # Persistent shell execution
│       ├── read-handler.ts          # File, image, notebook, and PDF reads
│       ├── write-handler.ts         # Full-file writes
│       ├── edit-handler.ts          # Scoped replacements
│       ├── ask-user-question-handler.ts
│       └── state.ts                 # Read/snippet tracking for tool safety
├── resources/
│   ├── webview.html                 # Webview markup and frontend logic
│   ├── webview.css                  # Webview styles
│   └── deepcoding_icon.png
├── docs/
│   └── guide.md
├── package.json
└── tsconfig.json
```

---

## Entry Points

### 1. Extension Activation

**Location**: `src/extension.ts`

- Registers `DeepcodingViewProvider` for the sidebar view
- Registers the `deepcode.openView` command
- View type: `"deepcode.chatView"`

### 2. Extension Deactivation

**Location**: `src/extension.ts`

- Currently a no-op

---

## Core Components

### DeepcodingViewProvider

**Location**: `src/extension.ts`

Responsible for:

- Webview initialization and backend/frontend message handling
- Creating the OpenAI-compatible client from `~/.deepcode/settings.json`
- Rendering assistant Markdown to HTML before sending it to the UI
- Loading sessions, updating session status, and sending skill lists

### SessionManager

**Location**: `src/session.ts`

Responsible for:

- Session creation, updates, persistence, and active-session tracking
- Building OpenAI chat payloads from session history
- Injecting the system prompt, optional `AGENTS.md` instructions, and selected skills
- Running the tool-call loop and appending assistant/tool/system messages
- Status tracking (`pending`, `processing`, `waiting_for_user`, `completed`, `failed`, `interrupted`)

Instruction lookup order:

- `./.deepcode/AGENTS.md`
- `~/.deepcode/AGENTS.md`

Storage layout:

- `~/.deepcode/projects/<projectCode>/sessions-index.json`
- `~/.deepcode/projects/<projectCode>/<sessionId>.jsonl`

### ToolExecutor

**Location**: `src/tools/executor.ts`

Responsible for:

- Parsing tool calls from model responses
- Executing tool handlers (`bash`, `read`, `write`, `edit`, `AskUserQuestion`)
- Formatting tool results into JSON strings for tool messages

### Webview Frontend

**Location**: `resources/webview.html`

Responsible for:

- Rendering chat bubbles for user, assistant, system, and tool messages
- Managing session selection, prompt history, and loading state
- Rendering skill selection UI and AskUserQuestion forms

---

## Webview Communication Architecture

The extension uses VS Code's Webview API for bidirectional communication between the extension backend and the UI frontend.

### Frontend -> Backend Message Types

| Type               | Payload                                    | Description                                          |
| ------------------ | ------------------------------------------ | ---------------------------------------------------- |
| `ready`            | `{}`                                       | Webview signals it is ready to receive initial state |
| `requestSkills`    | `{}`                                       | Request the currently available skill list           |
| `userPrompt`       | `{ prompt: string, skills?: SkillInfo[] }` | Submit a prompt with optional selected skills        |
| `interrupt`        | `{}`                                       | Interrupt the active session                         |
| `createNewSession` | `{}`                                       | Start a new session                                  |
| `selectSession`    | `{ sessionId: string }`                    | Load a specific session                              |
| `backToList`       | `{}`                                       | Return to the session list view                      |

### Backend -> Frontend Message Types

| Type               | Payload                                              | Description                                                    |
| ------------------ | ---------------------------------------------------- | -------------------------------------------------------------- |
| `initializeEmpty`  | `{ sessions, status }`                               | Show an empty composer state                                   |
| `loadSession`      | `{ sessionId, summary, status, sessions, messages }` | Load a session and its visible messages                        |
| `showSessionsList` | `{ sessions }`                                       | Refresh the session dropdown data                              |
| `skillsList`       | `{ skills }`                                         | Update the available skill list                                |
| `sessionStatus`    | `{ sessionId, status }`                              | Update the status of the current session                       |
| `userMessage`      | `{ content }`                                        | Append the raw user text bubble                                |
| `assistant`        | `{ html }`                                           | Append a direct assistant HTML message, typically for failures |
| `appendMessage`    | `{ message, shouldConnect }`                         | Append a structured session message generated during execution |
| `loading`          | `{ value: boolean }`                                 | Toggle the loading indicator                                   |

### Communication Flow Overview

1. Webview sends `ready`
2. Backend replies with the latest session or an empty state
3. Webview requests skills with `requestSkills`
4. User submits a prompt through `userPrompt`
5. Backend posts `userMessage`, sets `loading`, and hands off to `SessionManager`
6. `SessionManager` calls the model, appends messages, executes tools, and updates status
7. Backend pushes incremental updates with `appendMessage`, `sessionStatus`, `showSessionsList`, and `skillsList`

---

## Data Flow

```text
User Input
  ↓
Webview sends "userPrompt" with optional selected skills
  ↓
SessionManager creates or updates the session
  ↓
Inject system prompt, optional `AGENTS.md` instructions, and loaded skills
  ↓
Build chat.completions payload from session history
  ↓
Call chat.completions.create()
  ↓
Append assistant message
  ↓
If tool calls exist: execute tools, append tool messages, loop
  ↓
If AskUserQuestion is returned: set status to waiting_for_user
  ↓
Persist state and notify the webview
```

---

## Configuration

### 配置文件架构（Coding Maid 改造后）

Coding Maid 将配置拆分为两层：

#### 1. 连接预设（Connection Profiles）

**路径**: `~/.codingmaid/profiles/<name>.json`

每个连接预设是一个独立的 JSON 文件，方便切换模型/渠道：

```json
{
  "name": "default",
  "model": "deepseek-v4-pro",
  "baseURL": "https://api.deepseek.com",
  "apiKeyEncrypted": "iv:tag:ciphertext",
  "thinkingEnabled": true,
  "reasoningEffort": "max"
}
```

- API Key 使用 **AES-256-GCM** 加密存储，加密密钥存在 VS Code 的 `globalState` 中（与机器绑定）
- 用户可以在插件 UI 中切换预设
- 支持导入/导出预设

#### 2. 全局设置（Global Settings）

**路径**: `~/.codingmaid/settings.json`

```json
{
  "activeProfile": "default",
  "notify": "~/.codingmaid/notify.sh",
  "debugLogEnabled": false,
  "debugPromptEnabled": false,
  "mcpServers": {}
}
```

#### 3. VS Code 设置面板

非敏感配置也暴露在 VS Code 的 `settings.json` 中：

| 设置 ID                         | 类型    | 默认值      | 说明               |
| ------------------------------- | ------- | ----------- | ------------------ |
| `codingmaid.activeProfile`      | string  | `"default"` | 当前激活的连接预设 |
| `codingmaid.debugLogEnabled`    | boolean | `false`     | 启用 API 调试日志  |
| `codingmaid.debugPromptEnabled` | boolean | `false`     | 显示完整提示词     |
| `codingmaid.notify`             | string  | `""`        | 通知脚本路径       |

#### 加密方案

- `src/common/crypto-utils.ts` — AES-256-GCM 加密/解密
- 加密密钥由 `generateEncryptionKey()` 生成，存储在 `context.globalState` 中
- API Key 在磁盘上是加密状态，仅在运行时解密到内存
- 加密格式：`iv:tag:ciphertext`（全部 hex 编码）

#### 存储路径变更

| 原路径                      | 新路径                               |
| --------------------------- | ------------------------------------ |
| `~/.deepcode/settings.json` | `~/.codingmaid/settings.json`        |
| 无                          | `~/.codingmaid/profiles/*.json`      |
| 无                          | `~/.codingmaid/presets/`（后续阶段） |

---

## Dependencies

From `package.json`:

### Runtime Dependencies

1. **openai**
   - OpenAI SDK used for chat completion calls
   - Works with DeepSeek defaults and other compatible base URLs

2. **markdown-it**
   - Markdown parser and renderer
   - Converts assistant responses into HTML for the webview

3. **gray-matter**
   - Parses skill frontmatter from `SKILL.md`
   - Used when discovering skill name and description metadata

4. **ignore**
   - Applies `.gitignore`-style matching in the read tool
   - Helps avoid ambiguous or ignored file-path matches

### Development Dependencies

1. **@types/vscode**
   - TypeScript definitions for the VS Code API

2. **@types/markdown-it**
   - TypeScript definitions for `markdown-it`

3. **@types/node**
   - Node.js type definitions

4. **typescript**
   - TypeScript compiler

---

## UI Design

### Theme

- Uses VS Code theme variables rather than a fixed custom theme
- Distinct bubble treatments for user, assistant, system, and tool messages
- Loading indicator for in-progress requests

### UI Assets

- HTML template: `resources/webview.html`
- CSS styles: `resources/webview.css`

### Behaviors

- Auto-scrolls to the newest messages
- `Enter` sends the prompt
- `Shift + Enter` inserts a newline
- `ArrowUp` and `ArrowDown` navigate prompt history when the caret is at the boundary
- Session list, session switching, and new-session creation
- Skill picker in the composer

### Message Bubble Types

- `role === "user"`: plain text user bubble
- `role === "assistant"` and `meta.asThinking !== true`: standard assistant bubble with rendered Markdown HTML. When this message is appended during active processing, the frontend marks the session as completed and hides the loading indicator.
- `role === "assistant"` and `meta.asThinking === true`: collapsible intermediate bubble (used for thinking messages or status updates like context compaction). The loading indicator remains visible after appending this message.
- `role === "system"` with `meta.skill`: collapsible skill bubble that shows the loaded skill name and description
- `role === "tool"`: collapsible tool bubble with success or error state; `AskUserQuestion` tool output renders an interactive form when the session status is `waiting_for_user`

---

## Summary

Deep Code is a VS Code AI assistant extension with:

- Session-based persistence under `~/.deepcode`
- A webview chat UI driven by structured backend/frontend messages
- DeepSeek-oriented defaults with configurable OpenAI-compatible API access
- Skill discovery and loading for session-specific behavior
- A multi-step tool execution loop including structured user clarification

---

# Coding Maid 改造计划

> 本文档记录从 Deep Code 到 Coding Maid 的改造方向与计划。

## 改造目标

**核心目标**：让用户能够控制**所有提示词**（system prompt、工具定义、行为指令等），提供类似 SillyTavern 的"提示词预设"控制界面。

**设计原则**：

- 保持编程助手的完整功能（工具执行、文件操作、会话管理等核心能力不变）
- 提示词可控是手段，角色扮演是自然衍生结果，不是改造目标本身
- 不牺牲编程助手的安全机制（如 file-history 的文件变更可撤回）

## 架构评估

### ✅ 保留的核心功能

| 模块         | 文件                                     | 理由                              |
| ------------ | ---------------------------------------- | --------------------------------- |
| 文件变更历史 | `src/common/file-history.ts`             | AI 改文件的撤回机制，编程助手必备 |
| Bash 执行    | `src/tools/bash-handler.ts`              | 核心工具之一                      |
| 文件读取     | `src/tools/read-handler.ts`              | 核心工具之一                      |
| 文件写入     | `src/tools/write-handler.ts`             | 核心工具之一                      |
| 文件编辑     | `src/tools/edit-handler.ts`              | 核心工具之一                      |
| 用户询问     | `src/tools/ask-user-question-handler.ts` | 需要澄清时与用户交互              |
| 进程树管理   | `src/common/process-tree.ts`             | Windows 下中断进程必备            |
| 思考模式     | `src/common/openai-thinking.ts`          | DeepSeek 思考模式支持             |
| 错误日志     | `src/common/error-logger.ts`             | 排查问题需要                      |
| 调试日志     | `src/common/debug-logger.ts`             | 排查问题需要                      |
| 通知脚本     | `src/common/notify.ts`                   | 任务完成通知                      |
| 状态管理     | `src/tools/state.ts`                     | 文件读取/片段追踪的安全保障       |
| Shell 工具   | `src/common/shell-utils.ts`              | Shell 路径解析等                  |

### ⚠️ 可简化/合并的模块

| 模块                       | 问题                                                                          | 方案                         |
| -------------------------- | ----------------------------------------------------------------------------- | ---------------------------- |
| 三个 Skill 发现路径        | `~/.agents/skills/`、`./.agents/skills/`、`./.deepcode/skills/` 冗余          | 统一为一个路径               |
| 配置合并层 (`settings.ts`) | 四层合并（user env → project env → system env → DEEPCODE\_ env vars）过于复杂 | 简化为单一配置源             |
| Skill 自动匹配             | `identifyMatchingSkillNames()` 额外发一次 LLM 调用                            | 改为用户手动选择，不自动匹配 |

### 🔧 需要改造的核心模块

| 优先级 | 模块                                     | 改造内容                                                                        | 状态      |
| ------ | ---------------------------------------- | ------------------------------------------------------------------------------- | --------- |
| P0     | `src/prompt.ts`                          | 从硬编码 System Prompt 改为**预设模板引擎**，支持从预设目录加载完整的提示词配置 | ⏳ 待开始 |
| P0     | `src/session.ts`                         | 将提示词组装流水线改为**可配置的模板管道**                                      | ⏳ 待开始 |
| P1     | `src/settings.ts`                        | 简化配置结构，去掉多层 env 合并，改为连接预设系统                               | ✅ 已完成 |
| P1     | 新增 `src/common/crypto-utils.ts`        | AES-256-GCM 加密工具                                                            | ✅ 已完成 |
| P1     | 新增 `src/common/connection-profiles.ts` | 连接预设管理器（CRUD、加密存储）                                                | ✅ 已完成 |
| P1     | `src/extension.ts`                       | 接入新的配置系统，管理加密密钥                                                  | ✅ 已完成 |
| P1     | `package.json`                           | 添加 `contributes.configuration` 设置面板                                       | ✅ 已完成 |
| P1     | 新增 `src/preset-manager.ts`             | 提示词预设管理器，负责预设的 CRUD、模板渲染                                     | ⏳ 待开始 |
| P1     | `resources/webview.html` + `.css`        | 增加连接预设选择器、提示词预设编辑器 UI                                         | ⏳ 待开始 |
| P2     | `src/extension.ts`                       | 添加新的前后端消息类型用于预设管理                                              | ⏳ 待开始 |

### ❓ 暂不确定的模块

| 模块                                  | 说明                                                             |
| ------------------------------------- | ---------------------------------------------------------------- |
| Web Search (`web-search-handler.ts`)  | 编程时查文档有用，但非核心，可后续按需加入                       |
| UpdatePlan (`update-plan-handler.ts`) | 计划更新工具，比较小众，评估是否保留                             |
| 上下文压缩 (COMPACT_PROMPT_BASE)      | DeepSeek V4 有 1M token 上下文，短期内压力不大，可保留但暂不优化 |

> **MCP** (`src/mcp/`)：模型上下文协议，当前保留。虽然暂时用不上，但到处都能看到它，说明是行业趋势，先留着不动。

## 改造路线图

### 第一阶段：配置系统重构 ✅ （已完成）

```
目标：将配置从四层 env 合并简化为连接预设系统，API Key 加密存储
```

1. **`src/common/crypto-utils.ts`** — 新增 AES-256-GCM 加密工具
2. **`src/common/connection-profiles.ts`** — 新增连接预设管理器（CRUD、加密解密）
3. **`src/settings.ts`** — 简化，去掉四层 env 合并逻辑，改为调用连接预设
4. **`src/extension.ts`** — 接入新配置系统，通过 `context.globalState` 管理加密密钥
5. **`package.json`** — 添加 `contributes.configuration` 设置面板

### 第二阶段：提示词预设系统

```
目标：让提示词可以被用户选择和切换
```

1. **`src/prompt.ts`** — 重构为预设模板引擎
   - 将当前硬编码的 `SYSTEM_PROMPT_BASE`、`loadSystemPromptBase()`、`getSystemPrompt()`、`getTools()` 整合
   - 从 `~/.codingmaid/presets/` 读取预设
   - 每个预设是一个目录，包含 `system.md`（系统提示词）、`tools.json`（工具定义/开关）、`config.json`（模型参数等）

2. **`src/session.ts`** — 提示词组装管道化
   - 将 `buildChatPayload()` 中逐段拼接提示词的逻辑改为可配置
   - 用户预设决定：是否插 skills、是否插 AGENTS.md、system prompt 内容、工具定义内容等

3. **新增 `src/preset-manager.ts`**
   - 预设列表扫描
   - 预设的读取、保存、删除
   - 预设模板渲染（支持变量替换）
   - 预设导入/导出

### 第三阶段：UI 与打磨

```
目标：用户可以在界面上管理和编辑预设
```

4. **`resources/webview.html`** — 预设管理 UI
   - 预设选择器（下拉/侧面板）
   - 预设编辑器（内联编辑 system prompt、调整工具开关等）
   - 预设管理（新建、复制、导入、导出）

5. **`src/extension.ts`** — 新增消息类型
   - `listPresets` / `loadPreset` / `savePreset` / `deletePreset`
   - `importPreset` / `exportPreset`

### 第四阶段：清理与打磨

```
目标：移除多余模块，完善细节
```

7. 移除 MCP 相关代码（按需保留或彻底移除）
8. 统一 Skill 发现路径
9. 完善预设模板系统（支持角色卡片 JSON、变量插值等）
10. 完善文档与示例预设

## 预设目录结构设计（草案）

```
~/.codingmaid/
├── settings.json              # 全局配置
├── presets/
│   ├── default/               # 默认预设（Deep Code 原始行为）
│   │   ├── system.md          # System prompt
│   │   ├── tools.json         # 工具定义
│   │   └── config.json        # 模型参数
│   ├── minimal/               # 极简预设
│   │   └── ...
│   └── <user-presets>/
│       └── ...
└── skills/                    # 统一 skill 路径
    └── ...
```

### 预设文件格式（草案）

**system.md** — System prompt 主体，支持 EJS 模板变量：

```markdown
你是 Coding Maid，一个全能的编程助手。

当前模型：<%= model %>
当前日期：<%= date %>

<%= tools %>
```

**tools.json** — 工具开关与定义：

```json
{
  "enabled": ["bash", "read", "write", "edit", "AskUserQuestion"],
  "disabled": ["WebSearch", "UpdatePlan"],
  "customDefinitions": {}
}
```

**config.json** — 预设级别的模型配置：

```json
{
  "model": "deepseek-v4-pro",
  "thinkingEnabled": true,
  "reasoningEffort": "max",
  "temperature": 0.7
}
```

## 存储路径迁移

| 原路径                      | 新路径                        | 说明               |
| --------------------------- | ----------------------------- | ------------------ |
| `~/.deepcode/settings.json` | `~/.codingmaid/settings.json` | 全局配置           |
| `~/.deepcode/projects/`     | `~/.codingmaid/projects/`     | 会话存储           |
| `~/.deepcode/logs/`         | `~/.codingmaid/logs/`         | 日志               |
| `~/.agents/skills/`         | `~/.codingmaid/skills/`       | 统一 skill 路径    |
| `./.agents/skills/`         | （移除）                      | 只保留用户级路径   |
| `./.deepcode/skills/`       | （移除）                      | 兼容路径，不再支持 |
