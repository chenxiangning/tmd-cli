## Context

预算功能内嵌 workspace 插件,插件市场不可见、不可拔。项目已有两条协作机制可复用:挂载点(contribute + Mounts 渲染器,插件间 UI 协作的标准通道)与 `disabledPlugins` 拔插语义(activateAll 过滤,重启生效)。缺的只是:预算无自己的挂点入口、无激活态查询 API(SessionList 无法感知插件是否在位)。

## Goals / Non-Goals

**Goals**
- 预算成为独立插头:插排可见(feature 类,可拔),插件身份 = 入口 + 弹窗 + 校验
- workspace 与 session-budget 零直接依赖:入口经 `leftSidebar.workspaceCaption` 挂载点贡献
- 拔出 = 完全断电:入口消失 + 列表回默认分页;数值保留,重插生效

**Non-Goals**
- 不改预算语义、弹窗 UI、校验规则(见 session-list-budget 变更,全部保持)
- 不做运行期热插拔(遵循现有「拔插 = 重启生效」全局语义)
- 不给 settings 加任何新字段

## Decisions

1. **入口经挂载点而非 workspace 反查插件。** 新增 `leftSidebar.workspaceCaption` 挂点,workspace 用 kernel Mounts 渲染,预算按钮由 session-budget 贡献(组件自持按钮 + 弹窗状态)。备选「workspace 检查插件 id 决定是否渲染自己的按钮」被否:那是把预算 UI 留在 workspace、仅用布尔开关,插件化不彻底。依赖方向:两插件都只指向 kernel,零直接依赖。

2. **消费门控用 `isPluginActive(真实激活态)` 而非 `listPluginStates(启用态)`。** 拔插 = 重启生效:运行期真实激活态定格,而 `enabled` 会随市场页切换即时变化 —— 若门控读它,未重启列表行为就变,违背全局拔插语义。pluginLifecycle 增 `isPluginActive(id)`(this.plugins.has),host 透传。

3. **拔出 = 完全断电(用户裁决)。** 入口消失 + SessionList 回默认分页(PAGE_INITIAL=10 起步)。数值是持久化数据,不随拔插清除;重插即恢复消费。门控点收在 SessionList 的 initialLimit 一处:未激活 → PAGE_INITIAL,激活 → resolveCliSessionQuota。

4. **文件整体迁移 + CSS 独立成档。** BudgetPopover/budgetCommit(+test)git mv 进 `src/plugins/session-budget/`;`.wsbudget*` 样式自 workspace-menu.css 迁至 `styles/session-budget.css`(global.css 引入),与 composer-*/welcome 等按功能分档惯例一致。

## Risks / Trade-offs

- **两个插件以字符串 id "session-budget" 弱耦合**(SessionList 门控、无 dependsOn):接受 —— 拔掉 session-budget 时 workspace 必须独立存活(门控的 false 分支即默认行为),无需 dependsOn 强约束;这与 manifest dependsOn 的 id 引用同级别。
- **拔出后预算「静默失效」**:用户在插排拔掉插件后列表回 10 条/页,可能一时不知所改预算为何不生效。接受 —— 插排「拔掉即停」的全局隐喻一致;重插恢复。
- **挂点现在只有一个贡献者**:接受 —— 挂点成本仅一个 union 常量 + 一行 Mounts 渲染,换来了插件清单与动作位的开放扩展。
