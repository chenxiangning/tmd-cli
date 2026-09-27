# 6 小时提交评审(2026-09-27)

- 日期:2026-09-27
- 状态:已完成,发现的问题当轮修复
- 范围:2026-09-26 19:14 ~ 21:40 共 12 个非 merge 提交(ea1e77c..b55c404),主题 = worktree 关联管理(Rust 拆分 + Git 面板常驻区 + 侧栏归簇 + panic 钩子加固)
- 方法:3 路并行审查(按功能区切片:Rust / git 插件前端 / workspace+CSS+i18n)+ 主审机械扫描(arch-boundary / file-size / 词典死键 / 死导出 / CSS 搬移类名 diff),全部发现逐条对源码核实后修复;修复后全量门禁复验

## 结论

五维度骨架干净:R1/R3/R4 零违规、300 行铁则全达标、@shell/插件绕过零、CSS 拆分零类名丢档、panic 钩子加固(app_setup.rs safe_eprintln + 钩子内禁再 panic)实现正确且 eprintln 迁移无漏网(唯一残留在 env-gated 测试探针)。真问题集中三类,已全部修复:

1. **刷新链路与竞态**:WorktreeZone 拉取无 stale 防线(切仓竞速旧响应覆盖新结果)、常驻区移除不 bumpGitRefresh(弹窗路径有)、useWorktreeBranchGroups 不订阅 nonce(移除后残留已删树的空组头)、Rust worktree 三条写命令走只读 `run` 不 evict 缓存句柄(add -b 后新分支在陈旧 Repository 里不可见)。
2. **重复实现漂移**:弹窗移除流复制 worktreeOps 且路径比较未归一(Windows 摘不掉侧栏死卡)、同仓 worktree 列表面板期双拉、GitPanelMain 对 panelStore 双 import。
3. **归簇残留死面**:d1a85ad 撤卡片徽章后 en/ja 各 5 个 git 域键零消费;clusterBuckets 后到主仓卡覆盖 main 槽吞渲染(addWorkspace 零判重使同 root 双卡可达);probe 失败无负缓存(每次 store emit 对非仓目录真起 git 进程)。

## 按提交分组(问题 → 修复)

### Rust:ea1e77c / 3bda564 / 8942e03

| 提交 | 判定 | 问题与修复 |
|---|---|---|
| ea1e77c | pass | wt/ 前缀与移除清分支的 git 语义正确(-d 未合并被拒、跨树检出跳过判定齐全) |
| 3bda564 | P1+P2→已修 | ① git_worktree_add/remove/prune 走只读 `run` 不 evict_cwd,违反「外部 CLI 写命令必须 run_mut」纪律 → 三条改 run_mut;② 校验用 trim 后 `branch_t` 执行推原 `branch`(尾空格绕过预检,以费解 fatal 落地)→ 统一 branch_t;③ ensure_branch_free `.is_ok()` 把 spawn 失败/超时折叠成「分支不存在」放行 → match 分流,仅 Shell 类放行;④ path 参数无前导 '-' 闸(branch 有)→ 补同款 |
| 8942e03 | pass | panic 钩子改为直写 + 忽略错误(无再入 panic 路径);safe_eprintln 迁移覆盖完整(grep 实证残留仅 proc_run.rs 测试探针) |
| 拆分审计 | P3 记录 | worktree_parse.rs 纯函数拆分语义等价、porcelain 解析边界干净;`--porcelain` 未配 `-z`(含换行路径理论碎裂,现网不可达,report-only);rebase_porcelain_paths 在 Windows verbatim 前缀下近似 no-op(前端 normalizeRoot 兜住,report-only) |

### git 插件前端:5e89e50 / bd8a973 / 8792662 / 7a56900

| 提交 | 判定 | 问题与修复 |
|---|---|---|
| 5e89e50 | P1+P2→已修 | ① WorktreeZone.load 无 alive/token 防线(同切片 DirtBadge/useWorktreeBranchGroups 两正确先例独漏)→ reqRef token;② byTree/main 组分支行仍渲染删除钮 = git 必拒的失败按钮 → deletable={false} 门禁(右键菜单删除同口径,失败文案原样透出可接受);③ useWorktreeBranchGroups 不订阅 refreshNonce → 订阅;④ 面板期同仓双拉 → worktreeOps.listWorktrees 在途合并(不做 TTL,新鲜度优先);⑤ GitPanelMain 双 panelStore import(7a56900 收口漏此处)→ 合并;⑥ validateDirName 返回串即 i18n 键的隐式契约 → 注释锚;worktreePathFor Windows 混分隔符口径 → 注释防顺手改 |
| bd8a973 | P2→已修 | 5 键 ×en/ja 死键(d1a85ad 撤徽章后零消费):`{n} 棵树`/`本仓库的 worktree 数`/`检出分支(worktree)`/`有未提交变更`/`worktree 目录已被外部删除…` → 删净 |
| 8792662 | P2→已修 | bump 通道只覆盖弹窗路径,常驻区 TreeCard.remove 漏 bump → 补;WorktreeManageDialog.remove 整段复制 removeWorktreeWithCleanup 且已分叉(路径比较未归一、分支共享判定缺 bare/空分支条件)→ 改调共享层,删重复实现 |
| 7a56900 | pass | 行数收口正确 |

### workspace + CSS + docs:e9653c7 / d1a85ad / 5256817 / b55c404 / d831a1f

| 提交 | 判定 | 问题与修复 |
|---|---|---|
| e9653c7 | pass | 归簇主逻辑正确;唯一死导出 WORKTREE_BRANCH_PREFIX 实有测试消费(P3 扫描假阳性,排除) |
| d1a85ad | P1+P2→已修 | 渲染循环断链修复经逐环核实成立(roots useMemo 钉住 + setState 等值兜底);但 ① clusterBuckets `bucket.main = it` 无条件覆盖,同 root 重复卡(addWorkspace 零判重可达)被静默吞渲染 → main 槽先到先得守卫 + 回归测试;② probe 失败路径不落缓存,每次 store emit 对非仓目录重起 git → 10s 负缓存;③ meta 只增不减(P3 记录,量级=历史 root 数,不修) |
| 5256817 | P2→已修 | CSS sidebar→row 搬移零类名丢档(集合 diff 实证);spec 实现面段未随二次修订更新(仍写缩进+徽章形态)→ 补修订段 |
| b55c404 | pass | minmax(0,1fr) + ellipsis 修轨道撑爆,口径正确 |
| d831a1f | pass | spec 四段齐全、docs/README 登记齐(三行) |

## 已知限制(report-only)

- 归簇同仓判定为字符串相等(normalizeRoot),symlink 双路经/盘符大小写变体不聚簇(P3,接受)。
- worktreeDialogRequest 在 GitToolbar 未挂载时留 store、下次挂载重放一次——重放的是同一意图,可接受(P3)。
- addWorkspace 零判重是 P1 吞卡的上游面;收口在 add 面属另一议题,本轮以渲染侧守卫止血。

## 修复后门禁

typecheck / check:arch-boundary / check:file-size / build / react-doctor 100 全绿;vitest 2973 中 2971 过,2 个失败为并行会话 HEAD 遗留(bf46eca 升 CHANGELOG 0.2.4 未随更 updateCheck.test.ts 钉版本断言,与本评审无关,移交其会话);cargo test 309 过 + clippy -D warnings + fmt 全绿。
