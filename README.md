# Coding Maid

Coding Maid是开源项目[Deep Code](https://marketplace.visualstudio.com/items?itemName=vegamo.deepcode-vscode)
(https://github.com/lessweb/deepcode)
的重构魔改版。
非常感谢原项目开发者的开发！

此agent工具致力于解决一个需要：让用户可以控制“所有提示词”。

基于这个目标，此工具将会提供类似sillytavern的“提示词预设”控制界面，让用户控制/修改所有提示词。

## 为什么倒腾这玩意？

玩airp玩的。

谁能拒绝一个一边帮你写代码，一边抽空卖萌的agent呢？

~~有事鲸鱼干，没事干鲸鱼。~~

## 为什么不用其他自定义agent的方案？

因为大多数编程助手都不能控制**所有提示词**，而能控制提示词的方案大多都太折腾了。

你也不想你的agent被注入不知道哪里来的*安全声明*提示词吧？

你也不想你和agent的对话被外部审查吧？

你也不想看到“对不起，我不能帮你生成这个内容。”吧？

## 会影响模型输出质量吗？

如果你要求了角色扮演，那当然会，模型的注意力是有限的，你让她一边角色扮演一边写代码，当然可能出问题。

如果你不要求什么角色扮演，只是追求完全的提示词控制，那输出质量就都是你的提示词决定了。

# 初次使用
- 设置api：在界面里打开配置界面，新建/修改现有配置，填写地址、模型等信息。你的api key会被加密保存在本地。需要更新apikey的时候只要替换  "apiKey": "place_your_api_key_here"就行
- 设置/修改预设：默认会带有一个内置预设的，你也可以使用预设编辑器新建。
- 检查审批模式：我已经把可能危险的写入操作、bash指令设置为需要审批了，不过你最好还是检查一下
- 开始对话

## 详细配置

本插件由三种配置文件协同工作。分别是setting.json、profile.json、preset.json。

所有配置文件都放在~/.codingmaid/下（如果你是windows那就是"C:\Users\xxx\.codingmaid\"其他系统我没有也不知道）

### setting/插件全局设置

setting.json储存的是插件的设置，想要debug可以在这里打开，一般不用动。

审批模式也在这个文件里，不过前端界面就有交互了应该不用手动改吧。

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
| `{{tool.$toolname}}`          | 内置对应工具的内置描述prompt                |
| `{{skill.agent-drift-guard}}` | 内建 skill 文档（agent-drift-guard）       |
| `{{skill.plan-and-execute}}`  | 内建 skill 文档（plan-and-execute）        |
| `{{runtime_context}}`         | 运行时环境信息（日期、系统、路径、版本等） |
| `{{global_memory}}`          | 全局记忆目录中的文件内容                   |
| `{{repo_memory}}`            | 项目记忆目录中的文件内容                   |
| `{{date}}`                    | 当前日期                                   |
| `{{time}}`                    | 当前准确时间                               |
| `{{model}}`                   | 当前模型名                                 |
| `{{user}}`                    | 当前用户名，在预设里自己定义               |
| `{{char}}`                    | 当前角色名，在预设里自己定义               |
| `{{workspace}}`               | 工作区路径                                 |
| `{{editor_selection}}`        | 当前 VS Code 编辑器中选中内容（含定位）    |
| `{{active_file}}`             | 当前活动编辑器的文件全文                   |
| `{{attached_files}}`          | 用户附加的所有文件内容                     |
| `{{active_file_path}}`        | 当前活动编辑器的文件路径                   |
| `{{attached_files_path}}`     | 用户附加的所有文件路径列表                 |
| `{{lastUserMessage}}`         | 当前会话中最后一条用户消息原文             |
| `{{setvar::key::val}}`        | 设置会话级变量                             |
| `{{getvar::key}}`             | 读取会话级变量                             |
| `{{plan}}`                    | 模型使用updateplan更新的plan内容           |

“对话历史记录”将会注入到身份为“chat_history”的条目位置。

## 如何提高deepseek的缓存命中

注意，想要确保缓存命中高，你需要将任何可能变化的提示词放到后面（“对话历史记录”后面），包括但不限于：{{time}}、{{plan}}、{{attached_files}}这样的随时可能变化的宏。

- 注意不要在“对话历史记录”后面使用系统身份(system)的提示词，经过测试，我的推测是：deepseek会把传入参数里的tools数组中的那些schema格式注入到最后一个系统身份的提示词的位置。在变化内容后使用了系统身份的话这些东西可能不会命中的。

## 关于连续工具调用的提示词
工具调用不会重新应用预设提示词而是在用户发送消息的提示词后追加工具消息

说白了就是会缓存命中的

## ~~**自定义Skills**~~

啊，暂时禁用了，反正默认只带了两个skill，自己开关条目一下得了

有空了在做复杂一点的skill系统吧。

## 支持的模型

- `deepseek-v4-pro`（推荐使用）
- `deepseek-v4-flash`（虽然推荐pro但是我穷的平时只用flash，也就是说这个插件也是...）
- 任何其他 OpenAI 兼容模型（不知道，用不起，没测试）


## 审批系统
每个工具都可以自己设置审批模式：自动执行/需要手动确定

bash、edit、write工具有一些内置的检查，应该会自动拒绝非常危险的操作。但是都是ai写的我也不知道是不是全面、好用、安全的。

至于为什么不测试...要是测试结果把我的根目录文件全删了那不是炸了吗~

## debug
设置文件里吧debug打开后，所有的信息都会存放在~/.codingmaid/logs里面

这里有整个发送请求，想要查看宏是否展开/提示词是否起效，都可以自己检查。

## 记忆/指引
全局记忆文件在~/.codingmaid/memory/下
仓库记忆文件在/.codingmaid/memory/下
使用记忆宏自己注入提示词。

## 总结
理论上，你发给ai的所有信息都会经过预设preset、配置profile控制。
（ai开始执行任务并连续调用工具时，走的是快速路径，并不会重新按预设组装提示词，每次用户发送消息的时候就会重新组装）
所以，尽情的享受ai吧。


### 还需要完成的地方
- 接入mcp还没实现
- 聊天记录过滤也许也要做（已经隐藏了过往消息的思维链）
- 多语言化？

不过基本够我用了，随缘吧。
