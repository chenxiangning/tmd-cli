# 文件标记(file-marks)设计 spec

- 日期:2026-09-18
- 状态:已定稿(council 两席评审 + 父裁决;memo 存档 `~/.omp/…/local/council-marks-memo.md`)
- 原型:`docs/design/file-mark-composer-d.html`(A 行间锚点为主 × B 全局标记中心,含数据契约段)

## 背景与目标

用户在阅读代码文件时需要对内容做标记与批注,并把标记发送到对话框让 AI 定位回锚点或按标记修改。核心诉求(用户原话级约束):

1. **全局存放点**:多文件并开、跨文件标记,标记聚合在一个全局中心,可批量发送;不是单文件局部功能。
2. **源文件零写入(0 容忍)**:标记绝不修改源文件内容、不动文档 buffer、不加隐藏字符;标记是纯覆盖层 + 独立存储。
3. **插件化独立**:完全独立的新插件模块,不侵入既有插件语义;新增面仅限宿主机制型 kernel 契约。

交互闭环(方案 D):任意文件选行 → 行间落锚点(默认折叠一行摘要条,点开成批注卡)→ 全局标记中心(右栏面板,跨文件分组,勾选批量发送)→ composer 生成引用(多文件芯片)→ AI 回复带回链胶囊 → 点击回链激活文件 tab 定位锚点。

## 方案取舍

### 选定:方案 D(A 为主 × B 全局化)

| 决定 | 选定方案 | 被否决方案与理由 |
|---|---|---|
| 行间锚点渲染 | kernel 级 `registerEditorExtension`(ctx 委派),marks 注册异步工厂 `Promise<Extension[] \| null>`,CM 动态 import 只在 factory 体内(保住 lazy 拆包) | ① 高层 registerFileDecoration DSL——单消费者违 YAGNI,出现第二消费者再重评;② marks 直 import files 插件内部——违反 R4;③ 自绘文件视图——重复造编辑器;④ marks 顶层 runtime import @codemirror——CM 全家桶回主 chunk,击穿首屏零加载 |
| 终端回链 | kernel 级终端链接提供者注册表,xterm `registerLinkProvider` 消费;纯幕布外增强 | ① 幕布内二次渲染——违反 PTY 幕布硬约束;② 首版砍掉回链——回链是「AI 回到标记」闭环的承重墙,不砍 |
| 存储 | 全局 sidecar `~/.tmd-cli/marks/<md5(cwd)>.json`(checkpoints/assets 同构,用户项目零污染;fs_* 通用 IPC,路径知识留插件);锚点 = `{id, path, startLine, endLine, 指纹, note, state, createdAt}`;指纹 = 标记区全文 hash 为主 + 上下文行 hash 校验(防空行/import 行误命中) | ① 写进源文件——0 容忍红线,直接否决;② 项目内 `.tmd/marks.json`——git status 污染 + gitignore 侵入性,违背「用户项目零污染」惯例(council reviewer P1-1);③ localStorage——不随工作区走 |
| 重定位 | 文件变更后按首尾行内容指纹 ±N 行模糊重定位;命中静默更新并标「漂移已重定位」,不命中标「失联」 | 只记行号——文件一改就指错行,违反「绝不静默指错行」 |
| 发送路径 | 现成 `kernel/composerExt.ts` 的 `ComposerSendTransform`(assets 先例):只序列化「待发送」标记,发送成功翻「已发送」不再注入;空集恒等返回 | 扩展 composer 附件类型契约——要动 composer 插件与 kernel 附件面,首版过重;「发送后保留勾选态」会把已发标记反复注入后续无关 prompt |
| 全局可见性 | 右栏标记中心面板(registerFilePanel)+ 编辑 tab ⚑n 徽标 + reveal 跳转(marks 自有 store 字段 + 既有 tabs.openTab 深链,Extension 内 StateEffect 定位闪烁) | 文件树行计数徽章——FileVisualHint 首中即止无法叠加,P2 再议;新增 kernel 定位契约——openTab 深链已够(git/diffTab 先例) |
| 设置 | registerSettingsSection(开关/漂移窗口);快捷键砍——点击驱动已覆盖闭环(YAGNI) | — |

### kernel 契约准入论证

两条新契约均为**宿主机制型注册表**(注册面本身零 marks 语义),与 `composerExt`/`filePanel`/`fileVisual` 同构,符合「跨插件契约进 kernel」准入;任何插件未来都可复用编辑器扩展与终端链接注册面。

## 验证

- 门禁:`pnpm typecheck && pnpm test && pnpm check:arch-boundary && pnpm check:file-size && pnpm build`
- 新增单元:指纹稳定性、±N 重定位命中/失联、sidecar 原子写、发送序列化
- 桩目检:选行落锚 → 面板聚合 → 批量发送 → 终端回链跳回(1421 真实 dev server)

(评审结论与裁决记录评审完成后补记)
