## Why

会话列表显示预算自 6a4e987 落地起即「断裂」:弹窗写入 `settings.sessionListBudget`,但会话列表的磁盘历史分页始终硬编码 `PAGE_INITIAL = 10`(`SessionList.tsx`),从未消费预算 —— 用户怎么改数字,列表都没有反应。同时该设置的 UI 是 workspace 插件里一套自制悬浮弹窗(portal + 视口夹取定位 + 专用 CSS),没有走项目设置域插件化的标准路径(`registerSettingsSection` 注册表);弹窗高度受视口裁剪,8 个已注册 CLI 只能滚出来 4 个,「全量 CLI 适配」形同虚设。

## What Changes

- **修断裂**:每个 CLI 分组的磁盘历史初始露出条数改为 `resolveCliSessionQuota` 的解析结果;预算修改响应式生效(各组按新预算重新露出)。「更多...」翻倍语义保留;显式 0 配额的组初始不露出历史,首击「更多」从 10 条起翻倍。
- **UI 插件化**:删除自制悬浮弹窗(`BudgetPopover.tsx` + `clampBudgetPosition` + `wsbudget` CSS + `budgetPos` 态);workspace 插件通过 `registerSettingsSection` 注册「会话列表」section(显示预算 tab),渲染走设置面板壳,样式复用 `pref-card/pref-row` 体系。
- **全量 CLI 自适应**:配额行按 `host.getCliProfiles()` 动态生成(现 8 个:omp/pi/kimi/codex/claude/grok/qoder/qoder-cn,禁用插件除外);新接入 CLI 零改动出现在设置与配额解析中。
- **入口深链**:工作区标题旁的 ListTree 按钮保留,点击深链打开设置面板并定位到「会话列表 / 显示预算」(`openSettingsPanel` 加可选定位参数,现有无参调用不受影响)。
- **不动的部分**:预算语义(共享总数 + 按 CLI 配额 + 未配置均分)、合法域(1–100 / 默认 20)、sanitize 规则、全局(跨工作区)作用域全部保持。

## Capabilities

### New Capabilities

- `session-list-budget`: 会话列表显示预算的语义、设置面板编辑(注册表驱动的 section)、会话列表对预算的消费,与工作区入口深链。

### Modified Capabilities

（无 —— 设置面板注册表机制无既有 spec 基线;本变更不改变其它设置项行为)

## Impact

- **新增**:`src/plugins/workspace/BudgetTab.tsx`(设置面板 tab)、`src/plugins/workspace/budgetCommit.ts`(提交校验纯函数)+ `budgetCommit.test.ts`
- **修改**:`src/plugins/workspace/SessionList.tsx`(初始 limit 接 quota)、`src/plugins/workspace/index.tsx`(注册 section + 入口改深链)、`src/kernel/settings.ts`(`openSettingsPanel` 可选定位)、`src/plugins/settings/SettingsPanel.tsx`(消费定位)、`src/styles/workspace-menu.css`(删 wsbudget 块)
- **删除**:`src/plugins/workspace/BudgetPopover.tsx`
- **架构边界**:不破坏 —— 内核不 import 插件(R1);预算域逻辑仍在 kernel/settings(通用原语,注册表 id 由调用方传入);UI 归 workspace 插件,经标准注册表扩展点贡献
- **门禁**:vitest 全绿 / `tsc --noEmit` 零错 / `check:file-size` / `check:arch-boundary`
