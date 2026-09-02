## Why

会话列表显示预算自 6a4e987 落地起即「断裂」:弹窗写入 `settings.sessionListBudget`,但会话列表的磁盘历史分页始终硬编码 `PAGE_INITIAL = 10`(`SessionList.tsx`),从未消费预算 —— 用户怎么改数字,列表都没有反应。

> 方向裁决(2026-09-02,用户):曾尝试把预算编辑迁入设置面板(registerSettingsSection 注册 section)并以深链替换 caption 入口,**实施后被用户否决并回退** —— caption 悬浮弹窗是用户需要的形态,保留为唯一编辑入口。本变更最终只做断裂修复与校验纯函数化。

## What Changes

- **修断裂**:每个 CLI 分组的磁盘历史初始露出条数改为 `resolveCliSessionQuota` 的解析结果;预算修改响应式生效(各组按新预算重新露出)。「更多...」翻倍语义保留;显式 0 配额的组初始不露出历史,首击「更多」从 10 条起翻倍。
- **UI 保持 caption 弹窗**:`BudgetPopover`(portal + fixed 定位)原样保留,配额行按 `host.getCliProfiles()` 动态枚举(现 8 个 CLI,禁用插件除外;新接入 CLI 零改动出现)。
- **校验纯函数化**:弹窗的提交校验抽到 `budgetCommit.ts`(项目无组件测试设施,纯函数进 vitest);写入基底一律先剪除已卸载 CLI 的残留 perCli key —— 修正原实现残留 key 虚增「已分配」导致总数被误拒的边界问题。
- **不动的部分**:预算语义(共享总数 + 按 CLI 配额 + 未配置均分)、合法域(1–100 / 默认 20)、sum(perCli) ≤ total、全局(跨工作区)作用域、kernel 对外 API 全部保持。

## Capabilities

### New Capabilities

- `session-list-budget`: 会话列表显示预算的语义、caption 弹窗编辑入口,与会话列表对预算的消费。

### Modified Capabilities

（无)

## Impact

- **新增**:`src/plugins/workspace/budgetCommit.ts`(提交校验纯函数)+ `budgetCommit.test.ts`
- **修改**:`src/plugins/workspace/SessionList.tsx`(初始 limit 接 quota)、`src/plugins/workspace/BudgetPopover.tsx`(校验迁移至纯函数,UI 不变)
- **保持**:`src/plugins/workspace/index.tsx`(caption 弹窗入口原样)、`src/styles/workspace-menu.css`(wsbudget 样式原样)、kernel 零改动
- **架构边界**:不破坏 —— 内核不 import 插件(R1);预算域逻辑仍在 kernel/settings(通用原语,注册表 id 由调用方传入)
- **门禁**:vitest 全绿 / `tsc --noEmit` 零错 / `check:file-size` / `check:arch-boundary`
