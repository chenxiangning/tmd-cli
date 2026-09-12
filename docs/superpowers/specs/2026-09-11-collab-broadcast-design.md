# 横评广播:同一 prompt 并行喂 N 个引擎 + 活幕布真并排

日期:2026-09-11
状态:已废弃(2026-09-11 实施后用户验收否决广播编排交互;分屏红利以「会话 tab 平铺显示」简化形态落地——sessionTabs store tile 开关 + MainPanel 并排渲染,右键 tab 切换,无广播无编排。实现曾落地又整体拆除,本 spec 保留作鱼骨 DAG 重启时的参考)

## 背景与目标

09-06 协作模式原型(`docs/design/collaboration-mode-prototype.html`)设计了完整鱼骨 DAG 流水线(模板→多阶段串行 CLI→批准点→汇总),09-11 价值复核把它整条降级:跨引擎编排 + 模板管理 + 鱼骨渲染 + 批准流转四件套是全仓成本最高的候选,按选题权重基准(自用工具,增长型功能默认不排期)先做 1/10 的「横评广播」子集。本 spec 兑现这 1/10,并为鱼骨 DAG 保留退化路径(横评 = DAG 的并行特例)。

目标:

1. 把当前 composer 草稿作为公共题面,一次性并行发到用户勾选的 N 个 CLI 引擎(2-4 路),各引擎在干净上下文里独立作答;
2. 发完即横向分屏同看 N 路**真实幕布**——并行过程(谁快、谁卡、谁先追问)本身即可观测信息;
3. 横评会话发完即普通会话:进 tab 条、可续聊、ask/呼吸灯/归档全走现有链路,零新生命周期概念。

非目标(v1 明确不做):模板/阶段/批准点/上下文链式投喂(鱼骨 DAG 遗产)、附件广播、复用已有同引擎会话、只读结果抽取对比、横评组持久化。

## 方案取舍

**选定:活幕布真并排。** 发送后 canvas 段切换为水平 `PanelGroup`(react-resizable-panels 已装),每列一个真 `TerminalView`。理由:① `MainPanel` 的 canvas Panel 本就 keep-alive 全部 tab 会话(display:none 切换),分屏只是把同一批组件从"隐藏"改为"同屏",零新渲染机制;② PTY 字节原样透传铁律不碰——增强全在列头(幕布之外);③ 与 09-11 评审里成本最低的「分屏并排」候选在此汇合,一套布局两处受益。

**否决:tab 轮播 + 汇总面板。** N 路进现有 tab 条、另开汇总 tab 只看完成态 SUMMARY。改动最小,但切来切去失去并行视野,横评退化成"串行看结果"——卖点没了。

**否决:只读横评档案。** 跑完从各会话 PTY 字节副本抽"最终回答"并排展示。问题:"最终回答"在六家 CLI 输出流里的边界规则(哪个转义序列算轮次结束、哪家 TUI 重绘会撕碎文本)= 引擎私有知识,要么下沉进内核(踩「内核不理解 CLI 私有格式」铁律),要么每个 cli-* 插件补一个 extractFinalAnswer 适配器(横评插件反而给八家背适配债,正撞弃坑 codemoss 的矩阵债)。且"完成判定"难靠屏静止猜。

**否决:整条鱼骨 DAG 直接开工。** 09-11 复核结论,维持。本 spec 跑通后,DAG 自然退化为"横评的串行链式版"(多阶段 = 广播的时序化),模板/批准点契约届时再定。

## 交互设计

### 入口与选引擎

- composer 右缘 `composer.inputRail` 挂点贡献「⚡横评」按钮(与 assets 唤醒入口同列)。
- 点击弹层:候选 = `host.getCliProfiles()`(已注册 CLI),每行品牌字形 + 名称,多选;当前活跃会话的 profile 默认预选(题面在它输入框里)。已装引擎不足 2 个时按钮 disabled + tooltip。
- 题面 = 当前 composer 草稿;为空则「发送」置灰。v1 纯文本,附件条不参与。
- 上限 4 路(屏幕宽度 + `sessionTabsMax` 默认 4 对齐);勾选到第 5 个时提示。
- 弹层确认 → 逐路并行 `host.cli.createSession(profileId, cwd, workspaceId)`(cwd = 当前会话/工作区 cwd,并发安全由 spawn 在途闸兜底),每路喂入前过 `prepareSendPayload(profile, 题面)`(复用 composer 序列化管线,各引擎 translate/bracketedPaste 差异零新代码)→ 立即进分屏态 → composer 清草稿 + `recordPrompt(题面)` 记一次(不入 N 份)。

### 分屏态

- canvas Panel 内改为水平 `PanelGroup`:N 个等分 Panel,各挂真 `TerminalView`(active 恒 true,保证输入可达与光标渲染)+ 列头一行:引擎字形与名、会话状态点(复用 ask/呼吸灯态数据)、`⌥←/→` 聚焦指示、关列 `✕`。
- 列头即普通 div,不进幕布;xterm 字号/主题继承全局设置,不特调。
- 弹层确认 → 逐路并行 `host.createSession(profileId, cwd, workspaceId)`(cwd = 当前会话/工作区 cwd,并发安全由 spawn 在途闸兜底),每路喂入前过 `prepareSendPayload(profile, 题面)`(复用 composer 序列化管线,各引擎 translate/bracketedPaste 差异零新代码)→ 立即进分屏态 → composer 清草稿 + `recordPrompt(题面)` 记一次(不入 N 份)。
- 关列/退出分屏 = 只摘布局**不杀会话**;剩余会话照常留在 tab 条。任一列进程真退出:列头置死态,点列提示会话已退出,摘列走现有 removeSession 清场。
- 退出分屏 = 显式列头/角落「退出」按钮,回到 activeId 单幕布。切顶部 tab **不**强制退分屏(分屏是独立展示态,归 broadcast store 管,与 tab 条解耦)。

### 状态模型

- `src/kernel/broadcast.ts`(新,内核唯一改动文件):分屏态 store = `{ ids: string[], focusId: string | null }`,`createSubscribable` 惯例 + `openBroadcast(ids)/closeBroadcast()/setFocus()/removeColumn(id)`;ids 空即非分屏态。旁挂 `composerDraftRef` 模块级桥(composer 挂载时交接 `get()/clear()` 闭包,`composerSendRef` 同构先例)。
- 挂点新增 `"editorCenter.broadcast"`(MountPoint 联合类型加一行)。

## 架构落点与改动面

|件|改动|
|---|---|
|`src/plugins/collab-broadcast/`(新插件)|inputRail 按钮 + 选引擎弹层 + 分屏覆盖组件 + 广播编排(prompt 喂入循环);一切经 `activate(ctx)` 注册|
|`src/plugins/index.ts`|`allPlugins` 注册一行|
|`src/kernel/broadcast.ts`(新)|分屏态 store + composerDraftRef 桥|
|`src/kernel/plugin.ts`|MountPoint 加 `"editorCenter.broadcast"`|
|`src/app-shell/MainPanel.tsx`|canvas Panel 内约 10 行分支:分屏态渲染 `Mounts("editorCenter.broadcast")` 替代 kept-map|
|`src/plugins/composer/view/Composer.tsx`|挂载期交接 composerDraftRef(约 3 行)|

内核准入检查:broadcast.ts 只有"哪几列同屏 + 焦点指针"的宿主机制,零引擎知识(选谁/怎么喂全在插件)——符合"单插件语义不入 kernel"。R3/R4 边界零触碰;新插件不 import app-shell。

## 失败路径

- 某路 spawn 拒绝/秒退:现有 `sessionStartFailed` toast 逐条兜底(路径已含 crashTail),存活列照常分屏;全部失败则不进分屏、草稿不清(可改引擎重试)。
- 分屏中会话被外部删除(归档批量删/进程退出):插件订阅 `kernel.sessions.changed`,把 broadcast store 里已从活表消失的列剪除;剪空自动退分屏。
- 弹层勾选引擎含 `singleInstance` profile(dsh):`createSession` 的 guarded 会聚焦既有会话而不 spawn 新进程——广播循环对"返回的 id 已有活会话且非本次新建"的列打 toast 提示"该引擎单实例,已聚焦既有会话,题面未广播",不静默丢题。

## 边界与兼容(同日 WSL 调研的接缝)

WSL 支持调研(2026-09-11,`docs/prototypes/wsl-{1,2,3}.html`)与广播共用 spawn 唯一收口(`session_spawn → pty_spawn.rs`),结论是广播**零新代码继承 WSL**,但须钉死四条边界:

- 列的 cwd 一律继承当前会话/工作区 cwd,走现成 kind 路由 / `spawnTransform`;当前是 WSL 工作区则 N 列全在 distro 内,**不设计混合列**(本地引擎 × WSL 引擎同屏 = 题面文件上下文不一致,语义不成立)。
- 选引擎弹层不做「distro 内已安装」探针(探针是 Windows 侧 PATH 语义):未装 → spawn 被拒 → 走既有 `sessionStartFailed` toast,失败路径原样兜住。
- 广播会话磁盘身份落 distro(UNC `\\wsl.localhost\...` 喂现有 fs 原语),`identityTrack`/listSessions 复用 cli-shared 链路——与 WSL 调研「UNC 喂现有原语零改动」结论一致;9P 延迟只影响历史回放,不影响广播(PTY 流式,不读文件)。
- 分屏列组件(列头 + `TerminalView` 列)实现时保持独立文件,未来鱼骨 DAG 的节点 PTY 全屏(09-06 原型态④)可直接复用——这是两个设计的正当汇合点,但不是现在做抽象的理由,v1 不做通用列协议。

## 验证

- 单测:`kernel/broadcast.ts` store 语义(空 ids 即非分屏、removeColumn 剪空自动 close、focusId 悬挂时回落首列);插件侧广播喂入循环 mock 断言每路 `prepareSendPayload` + `writeSession` 各一次、`recordPrompt` 恰一次。
- 桩目检(1421 + Tauri 桩配方):假 profile ×3 走全旅程——选引擎→分屏三列渲染→⌥←/→ 焦点→关列→退分屏;spawn 失败一路时 toast + 两列存活。
- 真机 `pnpm tauri:dev`:claude + omp + codex 三路真广播,目检各引擎自动提交与首答;kill 一路进程看死态列。
- 全量门禁:`pnpm typecheck && pnpm test && pnpm check:arch-boundary && pnpm check:file-size && pnpm build`。

## 配套文档义务

- `docs/README.md` 本 spec 登记一行(随提交)。
- 落地后结论沉淀 `docs/architecture/`(广播态契约),同步修订 09-06 原型条目状态为"部分落地(横评广播)"。
- 顺手修已知漂移(与本 spec 无关但同批):FEATURES.md:359「改键 UI 未实装」改为已落地。
