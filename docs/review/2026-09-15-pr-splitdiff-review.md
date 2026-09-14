# v0.1.8 前置批次评审(双栏 diff / 创建 PR / 历史行拆分)

- 日期:2026-09-15
- 状态:已完成(3 P1 修 2 + 9 P2 修 7;门禁全绿 react-doctor 100)

## 背景与目标

4e53ab9..HEAD(18 提交 + 发版 3 提交,v0.1.8 前置批次)三切片并行深审:双栏 diff 自绘系列 / 创建 PR 工作流(Rust gh 链 + 前端态机)/ 历史行拆分与顶栏微调。主会话并行跑全套机械门禁并对发现项落修。

## 结论先行

无 P0。12 条发现(3 P1 + 9 P2):修复 9 条,report-only 3 条(PatchLines 重载下偶发测试污染、PR 工作流持锁跨网络调用、Windows 经典滚动条 12px 漂移)。修复后 vitest 204 文件 1629 用例 / cargo 235 + clippy + fmt / file-size / arch-boundary / build / react-doctor 100 全绿。上轮欠账 HistoryView 336 行已由 33dd175 拆分(HistoryRow.tsx)消掉;上轮在途 PatchLines dParts/iParts 崩溃已修净;react-diff-view 依赖撤干净(package.json/lock/src 零残留)。

## 修复明细

### P1(3 条修 2)
1. **PR compare 选非当前分支 → 推 HEAD + `-u` 重接 upstream = PR 内容错位 + 跟踪改写**(pr_workflow.rs:101):push 前加当前分支 == head_branch 前置闸,不符软失败「需先检出」,不做隐式跨分支推送。
2. **useCommitFiles 新 cwd 永不领养**:多仓切仓后 put 闸 `prev.cwd === cwd` 恒 false,历史展开无声失效(基线既有洞,665ebd6 注释把闸误述为完备):ensure 换代时补一次领养写(旧 cwd 迟到响应仍被闸丢弃),注释同步两职分工。

### P2(9 条修 7)
- pr_gh parse_github_repo 子串 `find("github.com")` → 剥 scheme 后 host 精确等于 github.com(notgithub.com/github.company.com 不再误归一);连带函数迁 pr_defaults.rs(唯一消费方,也解了 pr_gh 行数),伪 host 三用例钉住。
- ensure_pr 复用查找 state=all → state=open:closed/merged 旧 PR 不再挡新建。
- wordDiff tokenRe 加 u 标志:星面字符按码点整配,公共 emoji 不再渲染成 U+FFFD;emoji 回归测试钉住。
- patchRowKey 重复 meta 行(双 \ No newline)重复 React key:解析期标出现序数(内容组合键,不用数组下标——react-doctor 规则,1a31d5f 先例),回归测试钉住 key 唯一性。
- SplitHalves 每 mod 对左右各跑一遍 wordDiff DP(同一计算 ×2)→ useMemo 一次算两份下传。
- CommitDetailsPanel/WorktreeDiffPanel 不传 mode:全局双栏偏好贯通(hooks 提到叶组件顶部,无条件调用)。
- 创建 PR spec 文档四处「范围闸门」残留按头部修订横幅就地修订(含 pr_gate.rs→pr_defaults.rs 文件清单更正)。

## report-only(3 条)
1. **PatchLines.test 重载偶发红**:与 cargo/react-doctor 并跑时 vitest 文件执行顺序漂移致测试间污染;单文件与串行全量均稳定绿,复跑两轮 204/1627 全绿。追法:锁 --sequence.shuffle=false 单 worker 跑压力轮,不值当现在做。
2. **PR 工作流全程持 per-cwd 仓库锁跨约 7 次网络调用**(commands_pr.rs):最坏 ~30min 冻结该仓 git 命令;正解是 gh 调用移出锁外(不触仓库句柄),涉及 run_mut 签名链重构,留独立提交。
3. **双栏 nowrap 模式经典滚动条平台(Windows WebView2)~12px 底部漂移**:macOS 覆盖式滚动条无此问题;若 Windows 反馈可见再改共享滚动面。

## 验证
typecheck / vitest 204 文件 1629 / build / arch-boundary / file-size / cargo test 235 + clippy -D warnings + fmt / react-doctor 100。新增回归:wordDiff emoji 整配、patchModel 重复 meta key 唯一、parse_github_repo 伪 host ×3。UI 交互差异(双栏词级标注/PR 四步卡)建议 tauri:dev 目检顺带过。
