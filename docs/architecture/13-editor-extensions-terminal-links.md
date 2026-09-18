# 13 · 编辑器扩展与终端链接宿主契约

- 日期:2026-09-18
- 状态:已落地(marks 插件首发消费;评审 memo 见 omp 会话 local/council-marks-memo.md)

## 契约

两条**宿主机制型** kernel 注册表(注册面零插件私有语义,与 filePanel/fileVisual 同构):

### 1. 编辑器扩展注册表(`src/kernel/editorExtensions.ts`)

- `registerEditorExtension(factory): () => void` —— 插件向文件代码视图(CodeMirror)注入扩展。
- 工厂签名:`({ path, dark }) => Promise<readonly Extension[] | null>`;**必须异步**;null = 该文件不注入;单厂抛错只丢该厂产物。
- 消费点:`kernel/cmEditor/FileCodeEditorImpl.tsx` extensions 数组第四组(theme/base/lang 之后),工厂清单变化即重跑。

**拆包红线**:本契约对 `@codemirror/*` 只允许 type-only 引用;插件工厂体内只允许动态 import。`allPlugins` 静态全量 import 插件,任何顶层 runtime import 都会把 CM 全家桶拖回主 chunk,击穿「未开代码文件首屏零加载」(先例:cmTheme/cmLanguage)。CM 依赖类(WidgetType 子类)定义在插件工厂闭包内或经参数注入(先例:`src/plugins/marks/widgets.ts`)。

### 2. 终端链接注册表(`src/kernel/terminalLinks.ts`)

- `registerTerminalLinkProvider(provider): () => void`;provider = `{ id, find(lineText) → hits, open(hit, lineText) }`,行内 0 基含头不含尾区间。
- `attachTerminalLinks(term)` 聚合全部 provider 为**单个** xterm `registerLinkProvider`(与 WebLinksAddon 同机制共存);provider 清单运行期动态生效。
- `find` 必须同步且对不匹配行快速返回空 —— provideLinks 逐行高频调用,慢实现拖垮整条幕布链接识别。
- PTY 幕布硬约束边界:本通道只做「可点击 + 回调」,零字节流触碰、零幕布内二次渲染。

### 3. PluginContext / contributionLedger

两通道均走 ctx 委派(合 plugin.ts「不存在旁路注册表」不变量;composerExt 直连 import 是既成例外,**不复制到新面**)。contributionLedger 对两通道入账退订(激活失败回滚/熔断摘除零残留)。

## 首发消费者

`src/plugins/marks/`(文件标记,设计 spec:`docs/superpowers/specs/2026-09-18-file-marks-design.md`):行间锚点(异步工厂内动态构建 StateField/Decoration)、终端回链(`path:Lx-Ly` 点击定位,与发送端 `serializeMark` 格式同文件锁定)。

## 跳转定位的既定形态

跨插件「打开文件并定位」**不新增 kernel 契约**:复用 `kernel/tabs.openTab` 深链(插件以 `file:<abs>` id 打开/激活)+ 消费方自有 store 的 reveal 请求字段 + 自有扩展 StateEffect 滚动/闪烁(marks 的 requestReveal/takeReveal 即此形态)。

## 验证

`pnpm test`(editorExtensions/terminalLinks/anchor 契约测试)+ `pnpm check:arch-boundary` + `pnpm check:file-size` + 浏览器桩目检(1421,addMark → 装饰/面板/发送变换/重锚全链路)。
