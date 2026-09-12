> **状态:已废弃(2026-09-11)** —— 实现曾整体落地,用户验收否决广播编排交互(「感觉交互不太行…根本不需要广播」);分屏红利改以「会话 tab 平铺显示」落地(sessionTabs tile 开关,右键切换,无编排)。广播代码已全部拆除,本提案与 spec 留档备鱼骨 DAG 重启参考。

# 提案:横评广播(collab-broadcast)

## Why

09-06 协作模式原型(鱼骨 DAG)经 09-11 价值复核整条降级:跨引擎编排 + 模板管理 + 鱼骨渲染 + 批准流转四件套是全仓成本最高候选。复核保留其 1/10 红利子集 = 横评广播:同一 prompt 并行喂 N 个引擎。设计已定稿并通过交互评审(2026-09-11):spec `docs/superpowers/specs/2026-09-11-collab-broadcast-design.md`(cb4bf61 + 1d5511d WSL 边界节)+ 四态原型 `docs/design/collab-broadcast-prototype.html`(05fc3f6)。

直接命中自用核心场景:本机常驻 8+ 引擎,"这题哪家答得好"是每周都碰的问题;且分屏列组件顺手兑现 09-11 复核里成本最低的「分屏并排」候选,一份实现两份收益。

## What Changes

- **入口**:composer 右缘 `composer.inputRail` 挂点贡献「⚡横评」按钮(新插件 collab-broadcast 经 `activate(ctx)` 登记);点击弹层多选引擎(候选 = `host.getCliProfiles()`,当前会话 profile 预选,上限 4,singleInstance(dsh)与未安装置灰)。
- **广播**:题面 = 当前 composer 草稿;逐路并行 `host.createSession(profileId, cwd, workspaceId)`,每路过 `prepareSendPayload(profile, 题面)` 后 `writeSession` 喂入(复用 composer 序列化管线,translate/bracketedPaste 差异零新代码);`recordPrompt` 记一次;清草稿。
- **分屏展示**:canvas 段水平 `PanelGroup`(react-resizable-panels 已装),N 列各 = 真 `TerminalView` + 列头(引擎字形/状态点/⌥←→ 聚焦/✕ 关列);composer 隐藏,打字直进焦点列(shell"幕布即输入面"语义)。
- **生命周期**:普通会话 + 一次性分屏——关列/退屏只摘布局不杀会话;N 路此后就是普通 tab。广播态 store 归 kernel(`broadcast.ts`:ids + focusId,零引擎知识);分屏中会话外部删除 → 订阅 `kernel.sessions.changed` 剪列,剪空自动退屏。
- **失败路径**:某路 spawn 拒绝走既有 `sessionStartFailed` toast,存活列照常;全失败不进分屏不清草稿;singleInstance 命中既有会话时 toast「题面未广播」,不静默丢题。
- **不做**(v1 明确):模板/批准点/上下文链式投喂(鱼骨遗产)、附件广播、混合 cwd 列(WSL 边界节)、只读 SUMMARY 对比、横评组持久化、通用列协议抽象(仅约定列组件独立文件,为鱼骨态④留汇合点)。

## Capabilities

### New Capabilities

- `collab-broadcast`: 同一 prompt 并行广播至 N 个 CLI 引擎并以活幕布分屏同看的发起、展示与失败语义。

### Modified Capabilities

(无 —— tab/归档/ask/呼吸灯全走现有链路,零契约变更)

## Impact

- **新增**:`src/plugins/collab-broadcast/`(插件:按钮+弹层+分屏组件+编排循环)+ `src/kernel/broadcast.ts`(分屏态 store + composerDraftRef 桥)+ 对应单测
- **修改**:`src/plugins/index.ts`(allPlugins 一行)、`src/kernel/plugin.ts`(MountPoint 加 `"editorCenter.broadcast"`)、`src/app-shell/MainPanel.tsx`(canvas Panel 约 10 行分支)、`src/plugins/composer/view/Composer.tsx`(挂载期交接草稿桥约 3 行)
- **架构边界**:R1 不破坏(broadcast.ts 只有宿主机制);R4 不破坏(插件不 import @shell);PTY 铁律不碰(列头在幕布外);≤300 行铁则(Mounts 拆分件各立文件)
- **门禁**:`pnpm typecheck && pnpm test && pnpm check:arch-boundary && pnpm check:file-size && pnpm build` + 桩目检四态 + 真机 tauri:dev 三路广播目检
- **文档**:落地后结论沉淀 `docs/architecture/`(广播态契约);docs/README spec 条目状态改「已落地」
