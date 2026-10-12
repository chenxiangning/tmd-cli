# 工作台任务详情细化:右栏垂直占满 + 任务执行记录(AI 回写)设计

- 日期:2026-10-12
- 状态:已实施(门禁全绿 + react-doctor 100 + 1421 桩目检双态;按大仙指令未提交)

## 背景与目标

任务详情内嵌视图(`TaskDetailView`)两个痛点:

1. 右侧「基本信息」aside 是 `align-self: start`,只包住字段高度,左列内容一长右下大片空白,观感差。
2. 左列只有「描述/附件」「关联会话」两块,缺任务生命周期内的执行描述:任务关联会话干活后,关键处理动作/结果没有回写沉淀,任务详情看不到「这个任务做了什么」。

目标:

- 右栏随左列垂直占满,消除空白;
- 新增第三模块「执行记录」:由关联会话中的 AI 按约定把关键处理动作/结果回写到任务上,在详情页按时间正序展开追加。

## 方案取舍

### 执行记录来源(核心分叉)

| 方案 | 内容 | 取舍 |
|---|---|---|
| A. AI 按约定回写(选定) | 扩 `AI-TASKS.md` 约定:`ProjectTask` 加 `updates[]`,AI 在开始推进/关键进展/交付完成时追加条目;前端只做存储+渲染 | 与现有 status 磁盘回写完全同路,前端零新运行时逻辑;AI 自己最清楚干了什么,内容质量最高。代价:依赖 AI 守约,漏写就没记录——大仙认可 |
| B. 会话退出自动提炼(否决) | 订阅 `kernel.sessions.exited`,命中关联会话时经 CLI 适配器读转录 + `renderTranscriptDigest` 压缩自动追加 | 全自动不依赖守约,但转录噪音大、要处理 7 家 CLI 读取失败/去重/主线程开销,代码量数倍于 A |
| C. A + 退出时自动补「会话结束」系统事件(否决) | 两条写入路径 | 大仙拍板:系统事件不进时间线,只要执行记录 |

### 数据形态

复用项目级已存在的 `ProjectUpdate { id, at, kind: note|progress|blocker|decision, text }`,`ProjectTask` 新增**必填** `updates: ProjectUpdate[]`(与 attachments/sessions 同风格);`normalizeProject` 防御式归一化,磁盘缺省落 `[]`,旧数据零迁移。不新增第二套条目类型。

### 写入与刷新路径

- AI 直改 `index.json`(整文件重写,version=2 不变——纯增量字段);刷新语义与 status 回写一致:顶栏「从磁盘同步」重读。
- `AI_RULES_CONTENT` 扩允许字段:`tasks[].updates[]` 只追加不改不删;`ensureAiRulesFile` 从「存在即不动」改为「内容与模板不一致即重写」(该文件是 app 生成的规则件,非用户数据;否则老用户永远拿不到新约定)。
- `taskPrompt.ts` 预填文本补一句三阶段回写约定,开新会话即带入。

### 展示

- `TaskDetailView` 在「关联会话」之后加「执行记录」section:复用项目「进展记录」的 `wb-update-list/wb-update-row/wb-update-dot/wb-update-body/wb-update-meta` + `is-<kind>` 样式与 `UPDATE_KIND_LABELS`;时间正序(新条目追加在下,贴合「在下面展开追加」语义);无删除钮(AI 管理,UI 不提供改删)。空态一行引导文案。
- 右栏:`.wb-taskdetail-side` `align-self: start → stretch`,`gap 10px → 12px`,状态选择器与信息行之间加细分隔线分组。

### 显式不做

- 不做手动追加入口(AI 回写已覆盖,需要时再说);
- 不做会话退出自动提炼(方案 B 已否决);
- 系统事件(状态变更/会话关联)不进时间线(大仙拍板)。

## 验证

- `pnpm typecheck && pnpm test && pnpm check:arch-boundary && pnpm check:file-size && pnpm build` 全绿;
- 新增纯函数测试:`normalizeProject` 对 `task.updates` 的归一化(正常条目保留/坏形状落缺省/缺省为 []);`taskPrompt` 含执行记录回写约定文案;
- 1421 桩目检:任务详情右栏垂直占满、执行记录模块空态与有条目两态;
- `npx react-doctor@latest -y` 100 分(提交收口前)。

## 追加(同日二轮:删除确认盘点 + 右栏去卡片化)

按大仙「工作台删除 icon 补齐二次确认 + 右栏不要卡片边框、上下占满」指令:

- 盘点结论:已有确认 = 任务删除、进展记录删除、清空全部/示例、丢弃未保存修改;**无确认** = 附件删除(`ui.tsx` WbAttachmentSection,任务+文档两处共用)、项目文档删除(DrawerDocsTab)、解除会话关联(TaskDetailView)、日志后台任务行移除(journal TaskPanel)。
- 补齐:前三者统一走既有 `WbConfirm` 弹窗(含条目名插值);任务行移除用 journal 自身「两击确认」惯例(`dj-btn-confirm`,首击武装、次击删除)——只清记录行不动产物,弹窗过重。
- 右栏:去掉边框/圆角/背景小卡片,改 `border-left` 细分隔线上下占满;补「创建时间/更新时间/完成」三行让栏有实质内容。词典键「创建/更新」与 kernel 撞键(同键异值「Create/Update」)被 locales 契约测试拦下,改「创建时间/更新时间」。
- 复杂度拆分:`TaskSessionsSec` 独立成文件(react-doctor no-high-complexity + 300 行铁则双约束)。
- 误判记录:桩种子误用旧签名 `attachTaskFile(pid,tid,name,b64,mime)` 致 `{name}` 未插值 + `NaN KB`,实为种子 bug 非代码 bug,现签名是 `(pid, tid, { name, bytesBase64, size })`。
