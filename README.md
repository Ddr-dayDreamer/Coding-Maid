# Coding Maid

Coding Maid是开源项目[Deep Code](https://marketplace.visualstudio.com/items?itemName=vegamo.deepcode-vscode) (https://github.com/lessweb/deepcode)的魔改版。
非常感谢原项目开发者的开发！

此agent工具致力于解决一个需要：让用户可以控制“所有提示词”。
基于这个目标，此工具将会提供类似sillytavern的“提示词预设”控制界面，让用户随时控制/修改所有提示词。

## 为什么？
玩airp玩的。
谁能拒绝一个一边帮你写代码，一边卖萌的agent呢？
~~有事鲸鱼干，没事干鲸鱼。~~

## 为什么不用其他自定义agent的方案？
因为大多数编程助手都不能控制**所有提示词**，而能控制提示词的方案大多都太折腾了。
你也不想你的agent被注入不知道哪里来的*安全声明*提示词吧？
你也不想你和agent的对话被外部审查吧？
你也不想看到“对不起，我不能帮你生成这个内容。”吧？

## 会影响模型输出质量吗？
当然会，模型的注意力是有限的，你让她一边角色扮演一边写代码，当然可能出问题。
~~但是出了bug不就可以好好调教了吗？~~


## 配置
暂时延续原方案，后续待调整
创建 `~/.deepcode/settings.json` 文件，内容如下：

```json
{
  "env": {
    "MODEL": "deepseek-v4-pro",
    "BASE_URL": "https://api.deepseek.com",
    "API_KEY": "sk-..."
  },
  "thinkingEnabled": true,
  "reasoningEffort": "max"
}
```

## 主要功能

### **Skills**
Deep Code 支持 agent skills，允许您扩展助手的能力：

- **User-level Skills**：从 `~/.agents/skills/` 目录中发现并激活 skills。
- **Project-level Skills**：从 `./.agents/skills/` 目录中加载项目专属 skills，并兼容旧的 `./.deepcode/skills/` 目录。

### **为 DeepSeek 优化**
- 专门为 DeepSeek 模型性能调优。
- 通过使用[上下文缓存](https://api-docs.deepseek.com/guides/kv_cache)来降低成本。
- 原生支持[思考模式](https://api-docs.deepseek.com/guides/thinking_mode)和思考强度控制。

## 支持的模型

- `deepseek-v4-pro`（推荐使用）
- `deepseek-v4-flash`
- 任何其他 OpenAI 兼容模型
