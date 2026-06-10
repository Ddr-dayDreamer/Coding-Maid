# Edit 工具显示效果扩展

## 方案 B：改用 editor.edit() API（类似 Copilot 的残影效果）

当前实现是通过 `fs.writeFileSync()` 直接写磁盘，VS Code 检测到外部变更后静默重载文件，无法触发 VS Code 内置的 diff 渲染机制。

如果改用 VS Code 的 `workspace.applyEdit()` 或 `editor.edit()` API：

- 文档进入 dirty 状态，VS Code 自动在编辑器内显示 diff 标记
- 被删除的行显示为灰色文字 + 红色背景（残影效果）
- 新增的行显示为绿色背景
- 用户保存时才写磁盘

### 代价

- `edit-handler` 需要拿到 VS Code 的 `TextEditor` 实例（当前是纯 Node.js 层，不依赖 vscode API）
- 需要改造 handler 调用链以传递 editor 引用
- dirty 状态的文件如果被外部修改或用户关闭标签页，需要处理冲突恢复逻辑

目前使用方案 A（decoration 装饰），方案 B 暂未实现。
