# Coding Maid

Coding Maid是开源项目[Deep Code](https://marketplace.visualstudio.com/items?itemName=vegamo.deepcode-vscode)
(https://github.com/lessweb/deepcode)
的魔改版。
非常感谢原项目开发者的开发！

此agent工具致力于解决一个需要：让用户可以控制“所有提示词”。

基于这个目标，此工具将会提供类似sillytavern的“提示词预设”控制界面，让用户控制/修改所有提示词。

## 为什么倒腾这玩意？

玩airp玩的。

谁能拒绝一个一边帮你写代码，一边抽空卖萌的agent呢？

~~有事鲸鱼干，没事干鲸鱼。~~

~~为了让ai帮我开发airp游戏，我得让ai编程助手先帮我做一个可控的ai编程助手，这样我才能一边指挥ai干活一边逗ai玩~~

## 为什么不用其他自定义agent的方案？

因为大多数编程助手都不能控制**所有提示词**，而能控制提示词的方案大多都太折腾了。

你也不想你的agent被注入不知道哪里来的*安全声明*提示词吧？

你也不想你和agent的对话被外部审查吧？

你也不想看到“对不起，我不能帮你生成这个内容。”吧？

## 会影响模型输出质量吗？

如果你要求了角色扮演，那当然会，模型的注意力是有限的，你让她一边角色扮演一边写代码，当然可能出问题。

~~但是出了bug不就可以好好调教了吗？~~

## 配置

本插件由三种配置文件协同工作。分别是setting.json、profile.json、preset.json。

所有配置文件都放在~/.codingmaid/下（如果你是windows那就是"C:\Users\xxx\.codingmaid\"其他系统我没有也不知道）

### setting/插件设置

setting.json储存的是插件的设置，想要debug可以在这里打开，一般不用动。

### profile/api配置（插头）

profile.jsons可以有多个，储存的是api地址/key/模型/参数等信息

参数可以自己调整适配，比如流式传输、思考强度、温度之类的

格式如下：

```
{
  "name": "default",
  "model": "deepseek-v4-flash",
  "baseURL": "https://api.deepseek.com",
  "thinkingEnabled": true,
  "reasoningEffort": "max",
  "apiKey": "place_your_api_key_here",
  "params": {
    "stream": true
  }
}
```

你的apikey会被加密形式本地存储，用的算法叫啥来着？忘了，反正ai帮我写的。总之应该比明文保存好一些吧，大概。

### preset/提示词预设

发送给ai的所有提示词都在这里控制。

你需要把这个预设想要支持的默认工具tool写进预设文件里才能传输给模型用呢。

什么自定义tool？这个...我自己都没试过，以后在搞吧。

可以使用类酒馆宏来简化输入，已经支持的宏有：

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
| `{{user}}`                    | 当前用户名，在预设里自己定义               |
| `{{char}}`                    | 当前角色名，在预设里自己定义               |
| `{{workspace}}`               | 工作区路径                                 |
| `{{setvar::key::val}}`        | 设置会话级变量                             |
| `{{getvar::key}}`             | 读取会话级变量                             |

对话历史记录将会注入到身份为“chat_history”的条目位置。

## 主要功能

~~**Skills**~~

啊，暂时禁用了，反正默认只带了两个skill，自己开关条目一下得了

有空了在做复杂一点的skill系统吧。

### **为 DeepSeek 优化**

- 专门为 DeepSeek 模型性能调优。
- 通过使用[上下文缓存](https://api-docs.deepseek.com/guides/kv_cache)来降低成本。
- 原生支持[思考模式](https://api-docs.deepseek.com/guides/thinking_mode)和思考强度控制。

## 支持的模型

- `deepseek-v4-pro`（推荐使用）
- `deepseek-v4-flash`
- 任何其他 OpenAI 兼容模型
