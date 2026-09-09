/**
 * 「插件开发提示词」—— 投喂给任意工作区 AI 的本地插件生成说明书。
 * 复制按钮把它放进剪贴板,用户在会话里粘贴 + 描述想要的能力即可对话造插件。
 */
export const DEV_PROMPT = `请为 tmd-cli 客户端生成一个本地插件,写到 ~/.tmd-cli/plugins/<插件id>/ 目录(两份文件,纯手工格式,无需构建):

1. plugin.json(清单,id 必须与目录名一致):
{
  "id": "<插件id>",
  "name": "<显示名>",
  "desc": "<一句话能力描述>",
  "abbr": "<两字母缩写>",
  "category": "feature",
  "version": "0.1.0",
  "apiVersion": 1,
  "permissions": ["mounts", "settings", "commands"]
}

2. index.js(单文件 ESM bundle,纯 JS 不用 TS/JSX):
- 默认导出一个 Plugin 对象:{ id(与清单一致), meta: { name, desc, abbr, category: "feature" }, activate(ctx), deactivate?() }
- UI 用从 "tmd-sdk" 导入的 createElement 写(不写 JSX);React hooks(useState 等)从 "react" 导入。
- bundle 不超过 16MB。

activate(ctx) 可用的注册面(与内置插件完全同规则):
- ctx.contribute(point, { component }) 挂 UI,point 可选:"header.right"(标题栏右区)、"composer.statusBar"(输入框状态条)、"leftSidebar.section"(左栏)、"editorCenter.welcome"(首页)等。
- ctx.registerCommand({ id, title, when?, handler }) 注册快捷键命令。
- ctx.events.on(topic, handler) 订阅内核事件总线;ctx.events.emit(topic, payload) 广播。
- 运行时能力直接从 "tmd-sdk" 导入:ipc(Tauri 命令面)、settings(读写设置)、host(查询门面)。

注意事项:
- activate 里不要 throw(会被隔离并显示「激活失败」);组件渲染抛错只塌该挂点,不影响客户端。
- 一切能力经 activate(ctx) 的 ctx 注册面登记,不要绕过。
- 生成后不需要构建或安装,客户端会自动扫描发现;首次启用需在插件市场页「本地插件」区点一次确认。

我想要的插件能力是:<在这里描述你的需求>`;
