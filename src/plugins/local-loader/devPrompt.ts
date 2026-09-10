/**
 * 「插件开发提示词」—— 投喂给任意工作区 AI 的本地插件生成说明书。
 * 复制按钮把它放进剪贴板,用户在会话里粘贴 + 描述想要的能力即可对话造插件。
 * 契约与 plugin-hardening 提案同步:manifest.permissions 生效,apiVersion 纪元 2。
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
  "apiVersion": 2,
  "permissions": []
}

2. index.js(单文件 ESM bundle,纯 JS 不用 TS/JSX):
- 默认导出一个 Plugin 对象:{ id(与清单一致), meta: { name, desc, abbr, category: "feature" }, activate(ctx) }
- UI 用从 "tmd-sdk" 导入的 createElement 写(不写 JSX);React hooks(useState 等)从 "react" 导入。
- bundle 不超过 16MB。

permissions 能力声明(最小授权,只列真正需要的;不声明 = 纯 UI 插件):
- 可选类别:"ipc.terminal"(会话/PTY)、"ipc.exec"(执行进程)、"ipc.fs.read"(读文件)、"ipc.fs.write"(写文件)、"ipc.config"(工作区配置)、"ipc.git"、"ipc.checkpoints"、"ipc.net"(网络请求)、"ipc.sql"、"ipc.ssh"、"ipc.util"、"settings.read"、"settings.write"、"host"、"events"。
- 未声明的类别在运行时访问会直接抛错;用户启用前会在卡片上看到你要的能力清单。
- events 权限同时控制 ctx.events 事件总线的可用性。

activate(ctx) 可用的注册面(与内置插件完全同规则):
- ctx.contribute(point, { component }) 挂 UI,point 可选:"header.right"(标题栏右区)、"composer.statusBar"(输入框状态条)、"leftSidebar.section"(左栏)、"editorCenter.welcome"(首页)等。
- ctx.registerCommand({ id, title, run }) 注册快捷键命令(id 约定 "<插件id>.<动作>")。
- 有 "events" 权限时:ctx.events.on(topic, handler) 订阅内核事件总线;ctx.events.emit(topic, payload) 广播。
- 有对应权限时,从 "tmd-sdk" 导入:ipc(Tauri 命令面,按类别裁剪)、settings(设置门面)、host(宿主编排门面)。

注意事项:
- activate 里不要 throw(会回滚全部已注册贡献并显示「激活失败」);组件渲染抛错只塌该贡献位,同一插件累计崩 3 次会被熔断摘除(重启恢复)。
- 一切能力经 activate(ctx) 的 ctx 注册面登记,不要绕过。
- 生成后不需要构建或安装,客户端会自动扫描发现;首次启用需在插件市场页「本地插件」区点一次确认,权限变更后需重新确认。

我想要的插件能力是:<在这里描述你的需求>`;
