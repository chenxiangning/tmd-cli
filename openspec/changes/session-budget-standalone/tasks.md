## 1. kernel:挂载点 + 激活态查询

- [x] 1.1 `kernel/plugin.ts`:`MountPoint` 增 `leftSidebar.workspaceCaption`(工作区标题行右侧动作区)
- [x] 1.2 `kernel/pluginLifecycle.ts` + `host.ts`:增 `isPluginActive(id)`(真实激活态,this.plugins.has),host 透传

## 2. session-budget 独立插件

- [x] 2.1 `src/plugins/session-budget/`:git mv 迁入 `BudgetPopover.tsx` / `budgetCommit.ts` / `budgetCommit.test.ts`;新建 `index.tsx`(id "session-budget",feature 类,CaptionBudgetButton 经挂载点贡献,按钮 + 弹窗自持状态)
- [x] 2.2 样式迁移:`.wsbudget*` 块自 `workspace-menu.css` 迁至 `styles/session-budget.css`,`global.css` 引入

## 3. workspace 剥离 + 消费门控

- [x] 3.1 `workspace/index.tsx`:删预算按钮/budgetPos/BudgetPopover 引用,caption 动作区渲染 `<Mounts point="leftSidebar.workspaceCaption" />`
- [x] 3.2 `workspace/SessionList.tsx`:initialLimit 门控 —— `host.isPluginActive("session-budget")` 激活 = resolveCliSessionQuota,未激活 = PAGE_INITIAL(完全断电);effect 同步

## 4. 清单 / 测试 / 文档

- [x] 4.1 `plugins/index.ts` 注册 sessionBudgetPlugin(cli-* 之后、workspace 之前)
- [x] 4.2 `host.plugins.test.ts` 补 isPluginActive 断言(激活 true / 被拔 false / 未注册 false)
- [x] 4.3 架构文档挂载点地图 13 → 14(session-budget 贡献关系入图)
- [x] 4.4 回归门禁:`vitest` 全绿、`tsc --noEmit` 零错、`check:file-size`、`check:arch-boundary`
- [ ] 4.5 冒烟:插排出现「会话列表预算」插头;拔出重启 → 入口消失 + 列表回 10 条/页;重插重启 → 预算恢复生效
