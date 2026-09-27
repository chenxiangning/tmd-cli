# 会话粒度用量估算(检索结果行展示)

> 日期:2026-09-26 · 状态:已落地(真机目检待大仙)
> 上游:能力盘点 `docs/research/client-capability-gap-analysis.md`(P1-7)

## 目标

「长任务/并行任务吞 token 无感」。把既有 token 提取能力下探到会话粒度:会话检索结果的每一行显示该会话的 token/成本短文案(`≈ 12.3k tok · $0.041`),让"这个会话烧了多少"在看到它的那一刻可见。

## 范围边界

| 面 | 做 | 不做(去向) |
|---|---|---|
| 数据 | 复用 welcome TOKENS 的行型解析(omp/pi/claude/codex 四家实证行型)下沉 cli-shared/sessionUsage;头窗口 256KB 近似(同既有策略) | 全文扫描(头窗口妥协既有先例,ponytail 注记随迁);实时增量估算 |
| 展示 | session-search 命中行徽标 | 侧栏常驻徽标(行高预算);导出 CSV |
| 换算 | 各家自带 cost 直接展示;无 cost = 仅 token | 自设汇率换算(各家计费口径不一,不猜) |

## 方案取舍

| 决策 | 选定 | 否决与理由 |
|---|---|---|
| 代码归属 | 纯解析层下沉 `cli-shared/sessionUsage`(welcome + session-search 两 feature 联合消费同一磁盘格式知识,准入达成);welcome/tokens.ts 转发导出,既有测试零改 | session-search 里复制一份——行型知识双份真相必漂移 |
| 读取时机 | 索引 step() 内顺带头读(256KB,mtime 缓存同寿命) | 独立二次轮询——I/O 翻倍 |
| 提取窗口 | 头 256KB(早期会话代表大头,先例注记随迁) | 全文扫描——长会话 MB 级读放大量级 |

## 风险

| 风险 | 对策 |
|---|---|
| 头窗口低估长会话后段 | 徽标前缀 `≈` 明示估算;与首页 TOKENS 同一妥协口径 |
| 行型漂移(各家 JSONL 变更) | 解析单源 cli-shared,改一处;失败静默 = 不显徽标 |

## 验证

- 门禁:`pnpm typecheck && pnpm test && pnpm check:arch-boundary && pnpm check:file-size && pnpm build` + react-doctor 100。
- 单测:`sessionUsage.test.ts`(k/M 缩写/无 cost/cache 归并/codex 快照末次)沿用 tokens.test.ts 15 例(转发导出零改通过)。
- 真机:会话检索浮层命中行看用量徽标,由大仙目检。
