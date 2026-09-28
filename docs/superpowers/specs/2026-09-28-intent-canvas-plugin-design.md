# 意图画布插件(intent-canvas)设计 spec

- 日期:2026-09-28
- 状态:已完成实现 + 三轮评审修复(架构/功能完整性/正确性+UI 一致性;P0×2、P1×9、P2 若干已修,门禁全绿;待大仙真机验收)
- 源头:mossx `src/features/intent-canvas/`(27 文件约 7400 行,含 8 个测试文件)整体移植进 tmd-cli,并新增「对话中 AI 直接作画」能力

## 背景与目标

mossx 的意图画布是一块 Excalidraw 白板:管理页按时间分组管理多张画布(搜索/缩略图/批量删除/治理角标),编辑器双栏夹中央画布(左栏元数据与结构化关联,右栏 AI Context 指标与来源追溯),可把画布压缩成结构化 JSON 上下文附加到会话发送。用户要求:

1. **现有功能都包含**:mossx 意图画布的功能面整体搬进 tmd-cli。
2. **新能力**:tmd-cli 对话中让 AI 直接在画布里作画(生成相关文件并反映到画布),要有开关或调用入口。
3. **不提交**,做几轮多角度 review,用户最终验收;UI 风格必须与 tmd-cli 一致(浅色主题、`--tmd-*` 词汇),不能有突兀感。

移植边界(tmd-cli 事实约束):tmd-cli 无 project-map(mossx 语义图的导入源)、无 fs watch 原语、有 composer sendTransform / 中央 tab / 侧栏动作 / 插件词典 i18n / sidecar 存储先例(marks `~/.tmd-cli/marks/`)。

## 方案取舍

| 决定 | 选定方案 | 被否决方案与理由 |
|---|---|---|
| 画布引擎 | 新增依赖 `@excalidraw/excalidraw ^0.18.1`(mossx 同款),lazy import 只进画布 chunk | ① mermaid/自研 SVG——重写数千行且缩放/吸附/协作级编辑保真度必然损失,违「现有功能都包含」;mossx 同为 Tauri+React 19 已验证可用,文件体积以 lazy chunk 承担 |
| 归属与挂点 | 新插件 `src/plugins/intent-canvas/` + `allPlugins` 一行;`registerTabContent`(kind `intent-canvas`,管理页↔编辑器内部路由)、`registerSidebarAction`(侧栏入口)、`registerCommand`(global `Cmd+Alt+I`,已核对空闲;Escape/⌘V/⌘C 不碰) | ① overlay 全屏(session-board 式)——画布是持续驻留的工作面,中央 tab 可与文件/终端并存切换;② 右栏面板——画布需要宽度,右栏放不下双栏编辑器 |
| 会话关联 | 复用 kernel `composerExt`:`contribute('composer.attachments')` 附件芯片 + `registerComposerSendTransform` 发送时尾拼画布 JSON 上下文(marks/assets 同构范式);编辑器「关联当前会话」= 塞芯片 | 扩展 composer 附件类型契约——动 composer 插件与 kernel 附件面,过重;自建发送通道——绕开注册面违规 |
| 存储 | sidecar `~/.tmd-cli/intent-canvas/<dirKey(cwd)>/`:`index.json` + 每画布 `canvas-*.intent-canvas.json`(mossx 同构目录;marks sidecar 先例,用户项目零污染);TS 层保留 mossx 的 canvasId 正则白名单与防御式 normalize;删除走 `ipc.fsTrashEntry`(废纸篓,同 mossx) | ① 工作区内 `.tmd/`——marks council 已否决(git status 污染);② kernel 新增 Rust project_canvas 命令组——`ipc.fs*` 通用原语已覆盖读写 trash,为单插件加 Rust 面违 kernel 准入;mossx 的 Rust 锁/原子写在单用户桌面 + 按钮驱动写入下收益趋零,先不做 |
| AI 作画通道 | **inbox 文件协议**:约定目录 `~/.tmd-cli/intent-canvas/<dirKey>/inbox/`,AI 会话写 `ai-draw-*.json`(轻量 shapes 指令),画布 tab 激活期 2s 轮询 `ipc.fsListDir`,导入成功后删除(失败移 `inbox/failed/` 留证) | ① PTY 字节解析——违反 PTY 幕布硬约束(零二次渲染)与「内核不理解 CLI 私有格式」;② Rust fs watch 新命令——无 watch 先例、改动面大,轮询在 tab 激活期成本可忽略,`ponytail:` 级取舍(用户显式要实时性再上 watch);③ 让 AI 直写完整 excalidraw scene JSON——schema 巨大极易写坏正式文档 |
| AI 输出格式 | 轻量指令 JSON:`{kind:"intent-canvas-ai-draw",version:1,target:{canvasId?|title?,mode:"new"|"append"},summary?,shapes:[{type:"rect"|"text"|"arrow"|"diamond"|"ellipse",x,y,w,h,label?,fontSize?,stroke?,fill?}]}`;shapes 经 scene.ts 既有 SeedShape→元素投影管线落画布(append 复用 `appendIntentCanvasDocumentFromRequest` 横向拼接) | 完整 scene JSON——见上;纯自然语言让 AI 改 .json 文档——同风险且无法审计 |
| AI 开关/入口 | 三重入口:① 画布工具栏「AI 作画」开关(开启后 `registerComposerSendTransform` 在发送 prompt 尾部追加指令段:inbox 绝对路径 + shapes schema + 当前画布摘要,AI 写文件即完成作画);② 设置分区 `intentCanvas`(默认开);③ 侧栏/快捷键入口本来就有 | 只做设置项——用户要求「对话中」直达,发送链自动注入才是闭环;只做 composer 按钮——画布侧无法感知与关闭 |
| project-map 导入 | **不移植数据源**(`relationshipProjector`/`relationshipImportQueries` 依赖 project-map,tmd-cli 无此插件,数据源不存在);但语义图数据面(`CanvasSemanticGraph`/`sourceAnchor`/`traceability`/`staleSignals` 及右栏追溯卡 UI)全部保留——纯数据驱动,mossx 本身 `importedGraphCount>0` 才显示,AI/未来扩展产出 semanticGraphs 即点亮同一条管线 | 连类型与追溯 UI 一起砍——「现有功能都包含」要求下,凡是 tmd-cli 上可成立的功能(追溯/角标/失联警示)都应保留;留桩假数据——违真实性 |
| i18n | kernel `t()` 范式:中文源串即 key,`locales.ts` + `locales/{en,ja}.ts` 随插件注册(mossx zh/en/ja 文案迁移改写) | 硬编码中文——tmd-cli 有三语词典体系,弃用即砍现有能力 |
| 图标/样式 | lucide → `@phosphor-icons/react` 逐一映射;`intent-canvas.css` 重写为 `--tmd-*` 变量 + Tailwind 语义,浅色主题为准(mossx 默认深色不照搬);excalidraw 内部主题跟随 app 外观 | 照抄 mossx 1410 行 css——视觉风格违验收要求 #3 |
| 300 行铁则 | 大文件强制拆分:scene(966)→ `scene/` 三模块(种子投影/语义图布局/sanitize+aiContext);storage(930)→ `storage/` 三模块(归一化 codec/索引/CRUD);Editor(706)→ 壳 + 左右栏组件;Manager(561)→ 状态机 + home;context(421)→ 压缩 + 格式化两模块 | 文件头 `file-size-exempt`——可拆则拆,豁免是最后手段 |

## 落地面

- `src/plugins/intent-canvas/`:types / semantic / scene/ / storage/ / components(Manager/Home/HomeCard/Editor/左栏/右栏/AttachmentCard)/ aiDraw(inbox 协议+轮询导入)/ sendTransform / store(芯片桥)/ locales / index.tsx + `intent-canvas.css`
- `src/plugins/index.ts`:`allPlugins` 注册一行
- `package.json`:+`@excalidraw/excalidraw`
- 测试迁移:mossx 归一化/era 分组/上下文压缩/staleSignals/relativeTime 等纯逻辑单测随迁适配;新增 inbox 投影与轮询导入状态机单测
- 契约沉淀:AI inbox 文件格式是跨进程契约(画布插件 × 外部 AI 会话),格式定义与消费方都在插件侧,不涉 kernel

## 验证

- 门禁:`pnpm typecheck && pnpm test && pnpm check:arch-boundary && pnpm check:file-size && pnpm build`
- 桩目检(1421 真实 dev server,浅色主题):列表空态→新建→画布绘制→保存→缩略图/搜索/era 分组→批量删除→关联会话→composer 芯片+发送注入→AI inbox 写入→2s 内画布出现图形→开关关闭后不注入
- review:三轮独立(架构合规 / 功能完整性对照 mossx / UI 风格一致性)+ 主审机械扫描,发现项全部修复后复验
- 提交:本任务全程不提交(用户要求),验收后另行收口

## 评审记录(2026-09-28 三轮 + 主审复验)

修复的关键发现(全部已修并复验):

1. **P0 存储**:saveIntentCanvasDocument 直接 `fsCreateDir`(严格「新建」语义,撞已存在即报错)→ 每工作区第二次保存必失败。改 marks 同款两级幂等建目录(catch 吞掉),测试桩改为「已存在即 reject」钉死契约。
2. **P0 响应式**:composer.attachments 挂点的 `usePendingAttachments` 空桶每次返回新 `[]`,违反 useSyncExternalStore 快照稳定契约(无限重渲染崩溃)。改模块级 EMPTY 常量。
3. **P1×N**:切工作区编辑器残留旧文档跨桶写(加 root 变更清文档);sendTransform 消费名单跨发送残留(marks 同款失效闸);AI 元素 id 前缀进 repair 去重白名单;@keyframes 被 CSS 压缩脚本损坏(空动画体);设置页开关读 store 未订阅;工作区 boot 非响应式读取(Manager 改 useWorkspaces 订阅);i18n 词典 8 处标点全半角错配 + 22 词条补齐(en/ja)。
4. **P2×N**:轮询 in-flight 闸(双层)、AI shapes 上限 200 改拒绝 + 1MB 体积闸 + 坐标 clamp、缩略图 innerHTML 改 data-URI img(纵深防御)、AI 新建画布透传真实 workspace、批量删除失败可见、ja 语言 excalidraw 落 en、无活动会话禁用「关联当前会话」、messageContext 反向解析在 tmd-cli 幕布架构下不可接线(删,见下方取舍追记)。

取舍追记:AI inbox 轮询仅在画布 tab 激活期运行(无 fs watch 原语,首次使用需先开一次画布 tab);mossx 消息反向解析(messageContext→附件卡)依赖会话 transcript 渲染层,tmd-cli 幕布为 PTY 原样透传,无挂载点,不接线;project-map 导入按本 spec 不移植,语义图数据面/追溯 UI 保留(AI/未来扩展可点亮)。

补遗(2026-09-28 大仙真机反馈「缺管理入口」):侧栏动作注册漏 `rail: true`,没进 ⋯ 面板钉住清单——补上后意图画布出现在 rail 直挂钮 + ⋯ 管理清单(橙勾,默认钉住),行点击开 tab。

补遗 2(同日真机反馈「样式不对」,巨型锁图标):Excalidraw 只引了 JS 没引样式表——图标失去尺寸约束渲染成满屏巨 SVG、提示文案裸奔。修法 = lazy chunk 内 `await import("@excalidraw/excalidraw/index.css")` 与 JS 同分包(生产产物 `prod-*.css` 独立 chunk,主包零加载)。顺带画布区专业重构:editor-body 列轨 `auto→minmax(0,·)`(右栏 pre 长行 min-content 会把 1fr 挤到 20px)、行轨 `minmax(0,1fr)`(excalidraw 内部全绝对定位,隐式 auto 行高塌 0)、中央画布改凹陷画框(bg-sunken + 圆角边框,与三栏嵌入同族)。

补遗 3(同日真机反馈「列表无法点开画布」):点卡片本走「确认气泡 → 打开」,但气泡 absolute 定位在卡片内、卡片 `overflow: hidden` 把气泡整体裁掉,表现为点了没反应。修法 = ① 打开是非破坏动作,点卡片直接切换编辑器(免确认);② 复制/删除保留确认气泡,裁切收敛到缩略图层(`overflow: hidden` 从卡片移到 `.intent-canvas-thumb`),气泡完整浮出卡片下方。
