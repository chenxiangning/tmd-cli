## 1. 断裂修复:SessionList 消费预算

- [x] 1.1 `workspace/SessionList.tsx`:`CliSessionGroup` 以 `resolveCliSessionQuota(...)` 为 `limit` 初值(曾硬编码 PAGE_INITIAL,设置从不生效);`useEffect([quota])` 同步预算修改;「更多」改 `setLimit(l => (l > 0 ? l * 2 : PAGE_INITIAL))`;`PAGE_INITIAL` 注释改为「0 配额组首击展开步长」

## 2. 校验纯函数化(弹窗 UI 不变)

- [x] 2.1 新建 `workspace/budgetCommit.ts` 纯函数:`commitTotal` / `commitQuota` / `prunePerCli`,返回 `{ ok, value } | { ok: false, hint }`;规则:1–100、sum ≤ total、非负整数、空串删 key、写入基底剪已卸载 CLI 残留(已分配按剪除后基底计,修正残留虚增误拒)
- [x] 2.2 `workspace/BudgetPopover.tsx`:提交校验迁移至纯函数调用,UI/交互/文案原样保留(portal 定位、Escape/backdrop/X 关闭、行内提示)

## 3. 方向回退(用户裁决:弹窗保留,不迁设置面板)

- [x] 3.1 删 `workspace/BudgetTab.tsx` 与 `workspace/index.tsx` 的 registerSettingsSection 注册;caption ListTree 按钮恢复弹出 BudgetPopover
- [x] 3.2 回退 kernel 深链:`kernel/settings.ts` 移除 `SettingsPanelTarget`/`panelTarget`,`openSettingsPanel` 还原无参签名;`settings/SettingsPanel.tsx` 移除定位 effect;`settings.test.ts` 移除深链用例
- [x] 3.3 恢复 `styles/workspace-menu.css` 的 `.wsbudget*` 样式块;grep 确认 BudgetTab/panelTarget 无残留引用

## 4. 测试与验证

- [x] 4.1 `budgetCommit.test.ts`:total 越界/小于已分配拒绝、配额非法/超 sum 拒绝、空串删 key、显式 0 合法、残留 key 剪除且不抬高已分配
- [x] 4.2 回归门禁:`vitest` 全绿、`tsc --noEmit` 零错、`check:file-size`(存量在途 resolve.rs 违规非本变更)、`check:arch-boundary`
- [ ] 4.3 冒烟:改预算 → 各 CLI 分组初始露出随 quota 变化;0 配额组「更多」可达;caption 弹窗打开/关闭/校验提示正常
