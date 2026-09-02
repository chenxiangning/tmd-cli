## 1. 设置面板深链(kernel)

- [ ] 1.1 `kernel/settings.ts`:`SettingsState` 增 `panelTarget: { sectionId: string; tabId?: string } | null`;`openSettingsPanel(target?)` **每次都写 target**(有参 = 定位目标,无参 = null,杜绝旧 target 残留定位);`closeSettingsPanel` 不清 target
- [ ] 1.2 `settings/SettingsPanel.tsx`:`useEffect` 消费 —— `panelOpen` 翻真且 `panelTarget` 存在时 `setActiveSectionId/setActiveTabId`;无参打开不定位(记住上次选中,现状不变)

## 2. workspace 插件:section 注册 + 预算编辑器

- [ ] 2.1 新建 `workspace/budgetCommit.ts` 纯函数:`commitTotal(budget, registeredIds, raw)` / `commitQuota(budget, cliId, registeredIds, raw)`,返回 `{ ok, value } | { ok: false, hint }`;规则平移自 BudgetPopover(1–100、sum ≤ total、非负整数、空串删 key、写入基底剪已卸载 CLI 残留)
- [ ] 2.2 新建 `workspace/BudgetTab.tsx`:总数行 + 每 `host.getCliProfiles()` 一行(图标 + 名称 + 配额输入,placeholder = `resolveCliSessionQuota` 现值);blur/Enter 提交,非法拒绝 + `role="alert"` 行内提示;复用 `pref-card/pref-row`,零新增 CSS
- [ ] 2.3 `workspace/index.tsx`:`activate` 注册 section `{ id: "workspace", title: "会话列表", tabs: [显示预算] }`;caption ListTree 按钮改 `openSettingsPanel({ sectionId: "workspace", tabId: "budget" })`;删 `budgetPos` 态与 `BudgetPopover` 引用

## 3. 断裂修复:SessionList 消费预算

- [ ] 3.1 `workspace/SessionList.tsx`:`CliSessionGroup` 以 `resolveCliSessionQuota(...)` 为 `limit` 初值;`useEffect([quota])` 同步预算修改;「更多」改 `setLimit(l => (l > 0 ? l * 2 : PAGE_INITIAL))`;`PAGE_INITIAL` 注释改为「0 配额组首击展开步长」

## 4. 清理

- [ ] 4.1 删 `workspace/BudgetPopover.tsx`(含 `clampBudgetPosition`)与 `styles/workspace-menu.css` 的 `.wsbudget*` 块
- [ ] 4.2 全局 grep `wsbudget|BudgetPopover|clampBudgetPosition` 确认无残留引用

## 5. 测试与验证

- [ ] 5.1 新建 `budgetCommit.test.ts`:total 越界/小于已分配拒绝、配额非整数/负数/超 sum 拒绝、空串删 key、残留 key 剪除、合法写入值
- [ ] 5.2 `settings.test.ts`:补 `panelTarget` 深链态用例(有参写入/无参不覆盖)
- [ ] 5.3 回归门禁:`vitest` 全绿、`tsc --noEmit` 零错、`check:file-size`、`check:arch-boundary`
- [ ] 5.4 冒烟:改预算 → 各 CLI 分组初始露出随 quota 变化;0 配额组「更多」可达;入口按钮直达预算 tab;齿轮/侧栏入口不受影响
