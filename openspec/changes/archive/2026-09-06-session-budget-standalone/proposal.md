## Why

「会话列表显示预算」目前内嵌在 workspace 插件里(caption 入口按钮 + 弹窗 + 校验),不是独立插头 —— 插件市场(插排)上看不到它,也无法插拔。项目的架构叙事是「一切能力皆插件,客户端是插排」:预算作为用户可感知的独立能力,应自己的插件身份出现在插排上,可拔可插。

## What Changes

- **独立插件** `session-budget`(feature 类,可拔):持有 caption 入口按钮 + BudgetPopover + budgetCommit 校验纯函数(整体自 workspace 迁出,git mv 保留历史);样式自 `workspace-menu.css` 迁至 `styles/session-budget.css`。
- **新挂载点** `leftSidebar.workspaceCaption`:工作区标题行右侧动作区;workspace 渲染该挂点(kernel Mounts 公共渲染器),不再硬编码预算入口 —— workspace 与 session-budget 零直接依赖,协作仅经挂载点。
- **拔出语义 = 完全断电(用户裁决)**:拔出后 caption 入口消失,且 SessionList 不再消费预算,回默认分页(每组初始 10 条 + 更多翻倍);预算数值保留在 `settings.sessionListBudget`,重新插入插件后继续生效。SessionList 经 `host.isPluginActive("session-budget")` 门控(拔插 = 重启生效,激活态运行期定格)。
- **kernel 小幅扩展**:plugin.ts 增挂载点常量;pluginLifecycle/host 增 `isPluginActive(id)`(真实激活态查询,供特性门控)。
- **不动的部分**:预算语义、合法域、sanitize、弹窗 UI 与交互、校验规则全部保持。

## Capabilities

### New Capabilities

- `session-budget-plug`: 预算功能作为独立可插拔插件的插排身份、挂载点入口协作,与拔出完全断电语义。

### Modified Capabilities

（无 —— 预算语义与编辑 UI 见 `session-list-budget` 变更,均不变)

## Impact

- **新增**:`src/plugins/session-budget/`(index.tsx / BudgetPopover.tsx / budgetCommit.ts + test,自 workspace 迁入)、`src/styles/session-budget.css`
- **修改**:`src/plugins/index.ts`(清单注册)、`src/plugins/workspace/index.tsx`(剥预算 UI,渲染挂点)、`src/plugins/workspace/SessionList.tsx`(拔出门控)、`src/kernel/plugin.ts` + `pluginLifecycle.ts` + `host.ts`(挂载点 + isPluginActive)、`src/styles/global.css`、`src/kernel/host.plugins.test.ts`
- **架构边界**:不破坏 —— workspace 与 session-budget 零直接依赖(经挂载点协作,依赖方向仍指向 kernel);kernel 不 import 插件(R1)
- **文档**:架构文档挂载点地图 13 → 14
- **门禁**:vitest 全绿 / `tsc --noEmit` 零错 / `check:file-size` / `check:arch-boundary`
