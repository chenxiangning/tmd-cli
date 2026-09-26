# Worktree 编排(git 面板内建:列表/新建/移除/清理悬空)

> 日期:2026-09-26 · 状态:已落地(真机目检待大仙)
> 上游:能力盘点 `docs/research/client-capability-gap-analysis.md`(P1-5;worktree 隔离是 table stakes,官方 Claude Code Desktop 已下场验证)

## 目标

「worktree 原语存在但编排层缺失」「悬空 worktree 积压成灾」(盘点 §2.1,高普遍度)。git 面板工具条新增 Worktree 管理弹窗:列表、新建(新分支基于 HEAD 或检出已有分支)、移除、清理悬空;新建成功即 `addWorkspace` 进侧栏 —— 一个 worktree 一个并行任务,配平铺/广播输入即成完整并行工作流。

## 范围边界

| 面 | 做 | 不做(去向) |
|---|---|---|
| 原语 | `git worktree list --porcelain / add / remove / prune` 四命令(shell-out,commands_worktree 自 commands.rs 拆件,先例 commands_pr) | libgit2 worktree 路径(锁/prune 语义残缺,CLI 是唯一全功能面) |
| 新建形态 | `-b` 新分支基于当前 HEAD(默认)/ 检出已有分支;目录名自动推导可改;路径恒为 `主仓父目录/<名>` | 自由路径输入(路径拼接面收敛,防误写);已有远程分支跟踪配置(后议) |
| 工作区联动 | 创建成功即 addWorkspace(侧栏可见) | 自动 spawn 新会话(留给用户;后续可做「创建即开 omp」选项) |
| UI | git 面板工具条 TreeStructure 钮 → 管理弹窗 | 分支右键菜单加项(codemoss 11 项对齐面不动;二期再评估) |

## 方案取舍

| 决策 | 选定 | 否决与理由 |
|---|---|---|
| 移除确认 | 行内两段式(首点变「确认移除」) | window.confirm 阻塞渲染且与面板确认弹窗风格不一 |
| 锁定 worktree | 列表标「已锁」,移除不加 --force(由 git 拒绝) | 静默强拆 = 丢别人标定的保护态 |
| 目录推导 | 分支名转义(`/` `:` 空白等 → `-`,合并连字) | 原样用分支名做目录——`feature/x` 会造出嵌套目录 |
| 权限 | 四命令登记 `ipc.git`(穷尽守卫测试逼出,已补) | null 内核保留——本地 git 操作无外部攻击面 |

## 风险

| 风险 | 对策 |
|---|---|
| 已检出分支被另一 worktree 检出 | git 自校验拒绝,错误文案原样透出 |
| worktree 内未提交内容遭移除 | remove 不带 force,git 拒绝即停在错误展示 |
| 大仓 worktree add 慢 | 按钮 busy 态;创建是低频操作可接受 |

## 验证

- 门禁:cargo clippy/fmt/test(含 porcelain 解析新测)+ 前端五闸 + react-doctor 100。
- 单测:Rust `parse_worktree_list`(全字段/空输出);TS `dirName`(转义/校验/路径拼接)。
- 真机:面板工具条开管理弹窗 → 新建(基于 HEAD)→ 侧栏出现 worktree 工作区 → 移除/清理,由大仙目检。
