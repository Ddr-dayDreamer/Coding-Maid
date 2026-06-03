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
│   ├── session.ts                   # [编排器] 会话生命周期协调，委托子模块
│   ├── session-types.ts             # 所有会话相关类型定义
│   ├── session-storage.ts           # 会话持久化（索引 JSON + 消息 JSONL）
│   ├── session-file-history.ts      # 文件变更可撤回（Git checkpoint）
│   ├── session-process.ts           # 子进程追踪与超时控制
│   ├── session-skills.ts            # 技能发现、匹配、加载
│   ├── session-message-builder.ts   # 消息构建 + OpenAI API 消息装配
│   ├── session-activator.ts         # LLM 主循环 + 上下文压缩
│   ├── session-notify.ts            # 提示上报 + 任务完成通知
│   ├── llm-stream.ts                # LLM 流式通信封装
│   ├── prompt.ts                    # System prompt 和工具定义
│   ├── preset-manager.ts            # [新增] 提示词预设管理器
│   ├── preset-macros.ts             # [新增] 宏引擎（MacroEngine）
│   └── tools/
│       ├── executor.ts              # Tool dispatch
│       ├── bash-handler.ts          # Persistent shell execution
│       ├── read-handler.ts          # File, image, notebook, and PDF reads
│       ├── write-handler.ts         # Full-file writes
│       ├── edit-handler.ts          # Scoped replacements
│       ├── ask-user-question-handler.ts
│       └── state.ts                 # Read/snippet tracking for tool safety
├── resources/
│   ├── webview.html                 # ~70 行 HTML 骨架
│   ├── webview.css                  # Webview styles
│   ├── webview/                     # TypeScript 模块源码（esbuild → bundle.js）
│   │   ├── main.ts                  # 入口，消息路由
│   │   ├── types.ts                 # 前后端共享消息类型
│   │   ├── state.ts                 # DOM 缓存 + 全局状态
│   │   ├── bundle.js                # 编译产物
│   │   ├── components/
│   │   │   ├── chat-view.ts         # 消息气泡渲染
│   │   │   ├── composer.ts          # 输入框 + 发送/中断
│   │   │   ├── context-meter.ts     # Token 用量环
│   │   │   └── session-list.ts      # 会话下拉框
│   │   └── utils/
│   │       └── formatting.ts        # 日期/路径格式化
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

**Location**: `src/session.ts`（编排器，~620 行）

> 原文件 ~2600 行，已拆分为 10 个子模块。

SessionManager 本身是**编排层**，不直接实现任何具体逻辑，而是将操作委托给子模块：

| 子模块                | 文件                         | 职责                                          |
| --------------------- | ---------------------------- | --------------------------------------------- |
| SessionStorage        | `session-storage.ts`         | 会话索引和消息的持久化（JSONL）               |
| SessionFileHistory    | `session-file-history.ts`    | Git-based 文件变更 checkpoint/undo            |
| SessionProcessManager | `session-process.ts`         | 子进程追踪、超时控制                          |
| SessionSkills         | `session-skills.ts`          | 技能发现、元数据解析、去重匹配                |
| SessionMessageBuilder | `session-message-builder.ts` | 构建 SessionMessage + 装配 OpenAI API payload |
| LlmStreamManager      | `llm-stream.ts`              | chat.completions.create 流式封装              |
| SessionActivator      | `session-activator.ts`       | LLM 主循环执行 + 上下文压缩                   |
| SessionNotifier       | `session-notify.ts`          | 提示上报 + 任务完成通知                       |

Responsible for:

- Session creation, updates, persistence, and active-session tracking
- Injecting the system prompt, optional `AGENTS.md` instructions, and selected skills（提示词管道）
- Running the tool-call loop via SessionActivator and appending assistant/tool/system messages
- Status tracking (`pending`, `processing`, `waiting_for_user`, `completed`, `failed`, `interrupted`)

Instruction lookup order:

- `./.deepcode/AGENTS.md`
- `~/.deepcode/AGENTS.md`

Storage layout:

- `~/.deepcode/projects/<projectCode>/sessions-index.json`
- `~/.deepcode/projects/<projectCode>/<sessionId>.jsonl`

**⚠️ 缺失功能 — 删除会话**：

- 目前后端**没有**删除单条会话的方法
- `SessionStorage.removeSessionMessages()` 仅在 `trimSessionsIndex`（超出数量限制时自动丢弃旧会话）时被调用
- 前端 `webview.html` 中**没有**删除按钮或菜单
- 需实现：后端 `SessionManager.deleteSession(sessionId)` → `SessionStorage` 删除索引条目 + 消息文件 → 前端 `deleteSession` 消息类型 + UI 按钮

### ToolExecutor

**Location**: `src/tools/executor.ts`

Responsible for:

- Parsing tool calls from model responses
- Executing tool handlers (`bash`, `read`, `write`, `edit`, `AskUserQuestion`)
- Formatting tool results into JSON strings for tool messages

### Webview Frontend

**Location**: `resources/webview/`（TypeScript 模块，esbuild 打包为 `bundle.js`）

Responsible for:

- Rendering chat bubbles for user, assistant, system, and tool messages
- Managing session selection, prompt history, and loading state
- Rendering AskUserQuestion forms

**模块结构**：

| 模块             | 文件                                            | 职责                                  |
| ---------------- | ----------------------------------------------- | ------------------------------------- |
| main.ts          | `resources/webview/main.ts`                     | 入口，消息路由，初始化                |
| types.ts         | `resources/webview/types.ts`                    | 前后端共享消息协议类型                |
| state.ts         | `resources/webview/state.ts`                    | DOM 缓存 + 全局状态变量               |
| chat-view.ts     | `resources/webview/components/chat-view.ts`     | 消息气泡渲染，折叠/展开，连接线       |
| composer.ts      | `resources/webview/components/composer.ts`      | 输入框，发送/中断，自动调整，历史导航 |
| context-meter.ts | `resources/webview/components/context-meter.ts` | Token 用量环可视化                    |
| session-list.ts  | `resources/webview/components/session-list.ts`  | 会话下拉框，搜索，日期分组            |
| formatting.ts    | `resources/webview/utils/formatting.ts`         | 日期/路径格式化工具                   |

HTML 模板 `resources/webview.html` 仅 67 行骨架，不含任何 JavaScript 逻辑。

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
| `deleteSession`    | `{ sessionId: string }`                    | 删除指定会话（前端内联确认后发送）                   |
| `restoreSession`   | `{ sessionId: string, messageId: string }` | 回退到指定消息节点（截断对话 + 恢复文件）            |

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

> **初始化不依赖 `ready` 消息**：`resolveWebviewView` 中设置完 `webview.html` 后
> 立即调用 `loadInitialSession()`。`ready` 仍由前端发送，但后端忽略它。
> 原因：VS Code 视图复用时 `ready` 可能不会重新发送，导致初始化永不触发。

1. `resolveWebviewView` → 设置 HTML → **立即调用 `loadInitialSession()`**
2. 后端读取 `sessions-index.json`，发送 `loadSession` 或 `initializeEmpty`
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

3. **ignore**
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

### ⚠️ 已知缺失功能

| 功能                 | 说明                                                                                                  | 状态      |
| -------------------- | ----------------------------------------------------------------------------------------------------- | --------- |
| **删除会话**         | 后端无 `deleteSession` 方法，前端无删除按钮。需新增 `deleteSession` 消息类型 + UI 确认对话框          | ❌ 待实现 |
| **Webview 拆分**     | `resources/webview.html` ~1500 行→67 行骨架，逻辑拆至 `resources/webview/` 7 个 TS 模块，esbuild 打包 | ✅ 已完成 |
| **会话重命名**       | 会话自动取前 100 字符做标题，无手动重命名                                                             | ❌ 待实现 |
| **Webview 类型定义** | `resources/webview/types.ts` 前后端消息协议共享类型定义                                               | ✅ 已完成 |

---

## Summary

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

| 优先级 | 模块                                     | 改造内容                                                                                 | 状态      |
| ------ | ---------------------------------------- | ---------------------------------------------------------------------------------------- | --------- |
| P0     | 新增 `src/preset-manager.ts`             | 提示词预设管理器：扫描、CRUD、渲染（委托给 MacroEngine）                                 | ✅ 已完成 |
| P0     | 新增 `src/preset-macros.ts`              | MacroEngine：`{{...}}` 宏解析器、变量存储、工具/skill/上下文读取                         | ✅ 已完成 |
| P0     | `src/prompt.ts`                          | 去掉 EJS；`getTools()` 支持 `availableTools` 过滤                                        | ✅ 已完成 |
| P0     | `src/session.ts`                         | 预设驱动提示词管道；`chat_history` 角色；`replySession` 重渲染预设                       | ✅ 已完成 |
| P0     | 创建默认预设                             | `templates/buildin_preset.json`，首次启动自动写入 `~/.codingmaid/presets/default/`       | ✅ 已完成 |
| P1     | `src/settings.ts`                        | 简化配置结构，去掉多层 env 合并，改为连接预设系统                                        | ✅ 已完成 |
| P1     | 新增 `src/common/crypto-utils.ts`        | AES-256-GCM 加密工具                                                                     | ✅ 已完成 |
| P1     | 新增 `src/common/connection-profiles.ts` | 连接预设管理器（CRUD、加密存储）                                                         | ✅ 已完成 |
| P1     | `src/extension.ts`                       | 接入新配置系统、管理加密密钥、添加预设管理消息类型                                       | ✅ 已完成 |
| P1     | `package.json`                           | 添加 `contributes.configuration` 设置面板                                                | ✅ 已完成 |
| P1     | `resources/webview.html` + `.css`        | 增加连接预设选择器、提示词预设编辑器 UI                                                  | ⏳ 待开始 |
| P2     | `src/extension.ts`                       | 添加预设管理前端消息处理（`listPresets` / `loadPreset` / `savePreset` / `deletePreset`） | ⏳ 待开始 |

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

### 第一点五阶段：核心模块拆分 ✅ （已完成）

```
目标：将 ~2600 行的 session.ts 按关注点拆分为 10 个小模块，为预设系统铺路
```

1. **`src/session-types.ts`** — 所有类型定义抽出（纯数据层）
2. **`src/session-storage.ts`** — 存储层（索引 JSONL + 消息 JSONL）
3. **`src/session-file-history.ts`** — 文件历史/Checkpoint
4. **`src/session-process.ts`** — 进程管理
5. **`src/session-skills.ts`** — 技能管理
6. **`src/session-message-builder.ts`** — 消息构建 + OpenAI 装配
7. **`src/llm-stream.ts`** — LLM 流式通信
8. **`src/session-activator.ts`** — LLM 主循环 + 上下文压缩
9. **`src/session-notify.ts`** — 通知
10. **`src/session.ts`** — 降级为 ~620 行的编排器

**关键收益**：

- `SessionMessageBuilder` 成为将来预设系统的天然对接点
- 每个子模块可独立测试
- `activateSession` + `compactSession` 移入 `SessionActivator`，主循环逻辑独立

### 第二阶段：提示词预设系统

```
目标：让提示词可以被用户选择和切换，完全替代当前硬编码的提示词流水线
```

#### 设计概要

一个预设 = 一个 `preset.json` 文件，包含元信息 + 工具开关 + 条目数组。

- **条目**按数组 index 顺序注入会话（`0` 最先，`N` 最后），排序由 UI 拖拽决定
- **完全替换**当前硬编码提示词管道，不做合并
- **无 EJS** — 全部使用类 SillyTavern 的 `{{...}}` 宏语法
- **工具控制分两层**：
  - API 层面：`availableTools` 控制注册到 OpenAI `tools` 参数的 function calling schema
  - 提示词层面：`{{tool.bash}}`、`{{tool.read}}` 等逐个宏控制工具描述文本的插入
- **模型参数**（temperature 等）走连接预设（Connection Profiles），预设不控制

#### 宏系统

| 宏                            | 说明                                       |
| ----------------------------- | ------------------------------------------ |
| `{{tool.bash}}`               | bash 工具描述文档                          |
| `{{tool.read}}`               | read 工具描述文档                          |
| `{{tool.write}}`              | write 工具描述文档                         |
| `{{tool.edit}}`               | edit 工具描述文档                          |
| `{{tool.ask_user_question}}`  | AskUserQuestion 工具描述文档               |
| `{{tool.web_search}}`         | WebSearch 工具描述文档                     |
| `{{tool.update_plan}}`        | UpdatePlan 工具描述文档                    |
| `{{skill.agent-drift-guard}}` | 内建 skill 文档（agent-drift-guard）       |
| `{{skill.plan-and-execute}}`  | 内建 skill 文档（plan-and-execute）        |
| `{{runtime_context}}`         | 运行时环境信息（日期、系统、路径、版本等） |
| `{{agents_md}}`               | AGENTS.md 指令内容                         |
| `{{date}}`                    | 当前日期                                   |
| `{{time}}`                    | 当前准确时间                               |
| `{{model}}`                   | 当前模型名                                 |
| `{{user}}`                    | 当前用户名                                 |
| `{{char}}`                    | 当前角色名，在预设里定义                   |
| `{{workspace}}`               | 工作区路径                                 |
| `{{setvar::key::val}}`        | 设置会话级变量                             |
| `{{getvar::key}}`             | 读取会话级变量                             |

#### 实现步骤

1. **新增 `src/preset-manager.ts`**
   - 预设列表扫描（`~/.codingmaid/presets/`）
   - 预设的 CRUD
   - `{{...}}` 宏解析器（内置宏 + setvar/getvar）
   - 渲染预设条目为 `SessionMessage[]`
   - 预设导入/导出

2. **重构 `src/prompt.ts`**
   - 去掉 EJS 依赖
   - `getTools()` 支持 `availableTools` 参数过滤

3. **修改 `src/session.ts`**（提示词组装管道化）
   - `startSession()` 中 6 步硬编码流水线 → 读取预设 → 解析宏 → 生成消息
   - 预设条目支持 `role: "chat_history"`，在此位置展开全部历史对话消息
   - `replySession()` 重渲染预设，替换旧条目，`chat_history` 自动展开包括新消息
   - 预设注入的消息标记 `meta.isPreset: true`，方便后续过滤

4. **创建默认预设** `templates/buildin_preset.json`
   - 首次启动自动写入 `~/.codingmaid/presets/default/preset.json`
   - 支持顶层字段 `char` / `user` 为 `{{char}}` / `{{user}}` 提供默认值

### 第三阶段：UI 与打磨

```
目标：用户可以在界面上管理和编辑预设
```

5. **`resources/webview.html`** — 预设管理 UI
   - 预设选择器（下拉/侧面板）
   - 预设编辑器（拖拽排序、启用/禁用条目、编辑内容、管理宏）
   - 预设管理（新建、复制、导入、导出）

6. **`src/extension.ts`** — 新增预设管理前后端消息类型
   - `listPresets` / `loadPreset` / `savePreset` / `deletePreset`
   - `importPreset` / `exportPreset`

7. **完善宏系统**
   - 按需添加新宏
   - 支持宏嵌套等高级用法

### 第四阶段：清理与打磨

```
目标：移除多余模块，完善细节
```

8. 移除 MCP 相关代码（按需保留或彻底移除）
9. 完善文档与示例预设

---

## 技能系统设计

> 从 Deep Code 继承的 `SessionSkills`（`src/session-skills.ts`）已于 2026-06 移除。
> 以下记录其遗留设计以及未来的重构方向。

### 已移除的旧系统（SessionSkills）

旧系统的工作方式：

1. **扫描路径**：从 `~/.agents/skills/`、`.deepcode/skills/`、`.agents/skills/` 三个目录收集 `SKILL.md`
2. **LLM 匹配**：`identifyMatchingSkillNames()` 额外调用一次 LLM，根据 name + description 判断哪些 skill 与用户输入相关
3. **独立注入**：匹配到的 skill 文档作为独立的 system message **追加到预设之后**，绕过预设系统

**移除原因**：

- 与"所有提示词由预设控制"的设计原则冲突 — 技能文档在预设渲染完成后才追加，存在第二条注入路径
- 消息顺序不合理 — 技能文档在用户消息**之后**注入，LLM 看到用户消息时才获得上下文
- `isLoaded` 去重标记脆弱 — 依赖扫描已有消息的 `meta.skill` 字段判断是否已注入
- `gray-matter` 依赖仅用于解析 SKILL.md 的 YAML frontmatter，性价比低

### 当前实现（预设宏）

内置技能通过预设宏 `{{skill.xxx}}` 加载，由 `MacroEngine` 从 `templates/skills/xxx.md` 读取：

```jsonc
// 预设中的技能条目
{
  "name": "skills/技能",
  "role": "system",
  "content": "{{skill.agent-drift-guard}}\n\n{{skill.plan-and-execute}}",
  "enabled": true,
}
```

渲染时宏展开为对应 .md 文件的完整内容。**所有提示词走同一条流水线**，不存在第二条注入路径。

### 未来设计方向

当前实现有两个缺失：

1. **AI 无法主动选择技能** — 技能文档通过宏直接灌给 AI，AI 没有"要不要看"的选择权
2. **无法支持用户自定义技能** — `{{skill.xxx}}` 宏只读取 `templates/skills/` 下的内置文件

计划引入以下机制解决：

#### 宏系统扩展

| 宏                       | 作用                                                              | 状态      |
| ------------------------ | ----------------------------------------------------------------- | --------- |
| `{{skill.xxx}}`          | 加载指定内置技能文档（`templates/skills/xxx.md`）                 | ✅ 现有   |
| `{{skill_catalog}}`      | 所有可用技能的目录（仅 name + description），让 AI 知道有什么可选 | ❌ 待实现 |
| `{{skill_detail::name}}` | 加载指定技能的完整指引文档                                        | ❌ 待实现 |

#### AI 主动请求技能

```
{{skill_catalog}} → AI 看到目录 → AI 决定需要某个技能 →
调用 read_skill 工具 → 系统注入完整指引
```

需要一个 `read_skill` 工具（类似现有的 `read` 工具但专门用于技能加载），当 AI 在预设中看到 `{{skill_catalog}}` 生成的目录后，可以主动调用此工具加载需要的技能完整内容。工具返回的 skill 文档作为 system message 注入对话。

#### 用户自定义技能支持

`{{skill_catalog}}` 和 `{{skill_detail::name}}` 应该同时支持：

- **内置技能**：`templates/skills/xxx.md`
- **用户技能**：`~/.codingmaid/skills/xxx/SKILL.md`（统一路径，去掉旧系统的三个冗余路径）

用户技能放在 `~/.codingmaid/skills/` 下，每个技能一个目录，包含 `SKILL.md` 文件（YAML frontmatter + Markdown 正文），结构与旧系统一致但路径统一。

### Skill vs Instruction 的概念边界

| 维度             | Skill（技能）                                                   | Instruction（指引/指令）                   |
| ---------------- | --------------------------------------------------------------- | ------------------------------------------ |
| **文件形态**     | `SKILL.md`，带 YAML frontmatter                                 | `AGENTS.md`，纯 Markdown                   |
| **存放位置**     | `~/.codingmaid/skills/<name>/SKILL.md`                          | `./AGENTS.md`、`.deepcode/AGENTS.md`       |
| **粒度**         | 单一、专注（"如何做计划"、"如何防漂移"）                        | 宏观、全局（项目结构、编码约定、安全规则） |
| **加载方式**     | 预设宏 `{{skill_catalog}}` → AI 主动请求                        | 预设宏 `{{agents_md}}` 自动展开            |
| **元数据**       | 有 name/description，用于 AI 判断是否匹配                       | 无元数据，纯内容                           |
| **预设中的位置** | `{{skill_catalog}}` 生成目录，`{{skill_detail::name}}` 加载内容 | `{{agents_md}}` 直接展开                   |
| **类比**         | 工具书中的特定技巧"如何做 X"                                    | 项目规章制度"本项目用 pnpm"                |

**总结**：Instructions 是**规则**（不管问什么都要遵守），Skills 是**能力**（特定场景下才启用）。两者在预设中各有对应的宏，但加载方式不同。

## 预设目录结构设计

```
~/.codingmaid/
├── settings.json              # 全局配置
├── presets/
│   ├── default/               # 默认预设（兼容原有行为）
│   │   └── preset.json
│   ├── minimal/               # 极简预设
│   │   └── preset.json
│   └── <user-presets>/
│       └── preset.json
└── skills/                    # 统一 skill 路径
    └── ...
```

### 预设文件格式

每个预设是 json 文件，内置预设为 `templates/buildin_preset.json`：

```jsonc
{
  "name": "默认编程助手",          // 预设显示名
  "char": "Coding Maid",           // {{char}} 默认值（未设置时使用 name）
  "user": "user",                  // {{user}} 默认值（未设置时使用 "用户"）
  "description": "...",
  "availableTools": ["bash", "read", ...],
  "entries": [
    {
      "name": "系统设定",
      "role": "system",            // system | user | assistant | chat_history
      "content": "You are {{char}}...",
      "enabled": true
    }
  ]
}
```

- `char` / `user`：预设顶层字段，为 `{{char}}` / `{{user}}` 宏提供默认值
- `availableTools`：仅在此列表中的工具会被注册到 OpenAI API 的 `tools` 参数
- `entries`：按数组顺序注入，`enabled: false` 的条目被跳过
- `role: "chat_history"`：特殊角色，在此位置展开全部历史对话消息（作为独立 user/assistant/tool 消息，不是文本拼接），用于实现**后置指令**——预设条目中在 `chat_history` 之后的条目会出现在历史对话之后

## 存储路径迁移

| 原路径                      | 新路径                        | 说明               |
| --------------------------- | ----------------------------- | ------------------ |
| `~/.deepcode/settings.json` | `~/.codingmaid/settings.json` | 全局配置           |
| `~/.deepcode/projects/`     | `~/.codingmaid/projects/`     | 会话存储           |
| `~/.deepcode/logs/`         | `~/.codingmaid/logs/`         | 日志               |
| `~/.agents/skills/`         | `~/.codingmaid/skills/`       | 统一 skill 路径    |
| `./.agents/skills/`         | （移除）                      | 只保留用户级路径   |
| `./.deepcode/skills/`       | （移除）                      | 兼容路径，不再支持 |

---

## 调试指南

### 调试日志系统

日志写入 `~/.codingmaid/logs/debug.log`（JSONL 格式），通过 `codingmaid.debugLogEnabled` 设置控制：

```typescript
import { logDebug } from "./common/debug-logger";

// 写入一行到 debug.log
logDebug("函数名", "描述信息", { sessionId, 变量名: value });
```

开启方式（`settings.json` 或 VS Code 设置面板）：

```json
{
  "codingmaid.debugLogEnabled": true
}
```

日志路径：`~/.codingmaid/logs/debug.log`（每行一个 JSON 对象）。

### API 错误日志

自动记录到 `~/.codingmaid/logs/error.log`，保留最近 20 条。无需手动开启。

### 调试原则

1. **先确认代码路径是否执行**：在怀疑没跑到的函数第一行加 `vscode.window.showInformationMessage()`，这个一定会显示
2. **再逐层深入**：路径确认后，用 `logDebug` 记录变量值
3. **修完清理**：临时的 `showInformationMessage` 和 `console.log` 用完即删

### 历史坑

| 问题                 | 根因                                                                       | 解决                                                              |
| -------------------- | -------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `ready` 消息收不到   | VS Code 视图复用时不重发 `ready`                                           | `resolveWebviewView` 中直接初始化，不依赖 `ready`                 |
| 初始化后会话列表为空 | `handleLoadSession` 用 `state.allSessions`（永远 `[]`）而非 `msg.sessions` | 改为 `updateSessionDropdown(msg.sessions)`                        |
| 回退按钮点击无效     | `sessionId` 未映射到前端 → `data-session-id="undefined"`                   | `loadSession` 消息映射加 `sessionId: m.sessionId`                 |
| 回退按钮不显示       | 前端本地创建的用户消息无 `checkpointHash`                                  | `sendMessage` 中调用 `onAssistantMessage` 把真实消息发回前端      |
| 回退按钮不显示（2）  | `handleAppendMessage` 条件 `message.checkpointHash && ...` 太严格          | 去掉 `checkpointHash` 判断，按钮直接加                            |
| 回退执行失败         | `restoreSessionConversation` 先截断消息，`restoreSessionCode` 找不到目标   | 交换顺序：先 `restoreSessionCode` 再 `restoreSessionConversation` |
