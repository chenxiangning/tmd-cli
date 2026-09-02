# 2026-09-02 全天提交整体评审(晚间)

- 范围:当日全部 53 个提交(15a661b..9580793,369 文件 +48942/−4676)+ 工作区在途 composer 命令抽屉改动(24 改 + 13 新)。
- 结论:**方向未偏离,架构铁则守住**;R1(kernel↛plugins)/ R3(ipc 唯一通道)/ R4(plugins↛app-shell)经 check-arch-boundary 与人工 grep 双确认,插件零互相依赖(session-budget/workspace 仅经 `isPluginActive` 字符串门控与内核挂点协作,属设计内弱耦合)。预算 saga 的两次方案反转均有用户裁决记录与 openspec 留痕,最终态一致。
- 发现并修复:1 个 CI 红灯(500 行铁则)、4 个后端挂死类 bug、6 个前端真实 bug、1 个预算算法矛盾、~30 处文档失同步。修复后四件套 + cargo 全绿(vitest 483 / tsc 零错 / file-size ✅ / arch-boundary ✅ / cargo 44)。

## 一、已修复问题(代码)

### P1 · 铁则违规

| # | 问题 | 位置 | 修复 |
|---|---|---|---|
| 1 | `resolve.rs` 531 行超 500 行铁则,`check:file-size` 红(67 个提交未推送,CI 从未运行故未拦) | src-tauri/src/resolve.rs | 拆为 `resolve/{mod,path_cache,which}`(51/384/120 行),`crate::resolve::*` 路径 API 零变 |

### P0/P1 · 后端挂死类(与 11eb80d「挂死根治」同族,本次补完)

| # | 问题 | 位置 | 修复 |
|---|---|---|---|
| 2 | probe `--version` 用 `wait_with_output()` 读管道到 EOF 无超时;被探 CLI fork 的守护进程握管道写端 → 探针永久不返回 | probe.rs `run_version` | spawn 后即刻双管道并发排空 + `recv_timeout(1s)` 收 stdout(resolve.rs 同模式) |
| 3 | git 远端操作**成功路径** `join()` 读线程无界,且全程持 per-cwd 互斥锁;ssh ControlMaster/GCM 孙进程握管 → `git_status` 轮询对该 cwd 永久冻结 | git/remote_ops.rs | `drain_pipe` 改回执 channel,成功路径 `recv_timeout(5s)` 有限等待,不 join |
| 4 | installer 泵线程 `join()` 无界,npm 拉起的孙进程(node 脚本可守护化)→ `cli_install_run` 超时后仍不返回,`done:fail` 也不发 | installer.rs `run_install` | 泵完成经 channel 回执,`recv_timeout(5s)`;放弃等待后泵线程继续排空防写阻塞 |
| 5 | pty reader→emitter 无界 channel:emitter 聚合节流上限 ~100MB/s,`cat` 大文件/构建刷屏时队列无界膨胀 | pty.rs | `sync_channel(64)`:队列满 reader 阻塞 → 内核 PTY 缓冲回压子进程 |
| 6 | PATH 快路径入库前 kick `-ilc` 升级线程,升级先完成会被旧值覆写(Ready(fast) 盖掉 Ready(full)) | resolve/path_cache.rs `compute_and_store` | 先入库再 kick |

### P0/P1 · 前端(含在途抽屉 WIP)

| # | 问题 | 位置 | 修复 |
|---|---|---|---|
| 7 | `translatePrompt` 用 lookbehind 正则;Safari <16.4(旧 macOS WKWebView)`new RegExp` 直接 SyntaxError → 5/8 个 CLI 完全无法发送(vitest 跑在 V8 测不出) | serialize.ts | 前缀捕获组 `(^|[^\w$])` 等价替代 lookbehind |
| 8 | 9fbd736 声称修了 `$HOME` 误改写,实际大写开头 token 仍被翻成 `/skill:HOME` | serialize.ts | token 起始收紧为 `[a-z]`(技能名恒小写;漏译透传优于静默改写) |
| 9 | 附件「全部清除」逐个 `onRemove`,同批闭包 value 连续 `setValue` 只剩最后一个 → N 个附件只删 1 个(9fbd736 刚修的同族 bug) | Composer.tsx `removeTokenForAttachment` | 函数式更新 `setValue(v=>…)`,同批调用自然聚合 |
| 10 | 抽屉下拉三分支(ArrowUp/Down、Enter/Tab)不查 `isComposing`:中文组词期 Enter 上屏会被 `applyPick` 替换成下拉首项(违反自家 design §6「IME → 下拉 → …」契约) | Composer.tsx onKeyDown | 三分支统一 `!composing` 守卫 |
| 11 | 抽屉关闭态仅 `aria-hidden`:Tab 仍可落进屏外控件,焦点不归还输入框(键盘"失灵"感) | CommandDrawer.tsx | `inert={!open}` + 关闭转换时焦点归还 `#composer-textarea` |
| 12 | `sendFromDrawer` 无会话时静默不发但 toast 仍报「已发送」(违反 spec 静默守卫场景),且 toast 显示 translate 前文本 | Composer.tsx / CommandDrawer.tsx | 空串 = 静默(不 flash/不 toast/不关);toast 改显 wire 文本 |
| 13 | `moveActive(-1)` 从未选中(-1)起步落到 `len-2` 而非最后一项;flashKey 永不清除;320ms 关闭定时器会误杀快速重开的抽屉 | CommandDrawer.tsx | 未选中特判回卷;flash 480ms 自清;定时器回调 `isDrawerOpen()` 复查 |
| 14 | ⌘K 绕过工具栏的 noSession 门控(无会话也开空抽屉),无 `e.repeat` 防抖;profile 变 null 时抽屉残留上一 CLI 条目 | Composer.tsx | ⌘K 与按钮同门控 + repeat 守卫;profile null → 只留插件区条目 |
| 15 | 拖拽遮罩用未定义 token `--n`/`--n-soft`(实际渲染 currentcolor) | Composer.tsx | `--tmd-accent`/`--tmd-accent-soft` |

### P1 · 内核/预算算法

| # | 问题 | 位置 | 修复 |
|---|---|---|---|
| 16 | `resolveCliSessionQuota` 的 `allocated` 求和含已卸载 CLI 残留 key:残留配额挤占未配置组(20−14=6 均分 7 组 = 0 条/组),且与弹窗展示(剪残留基底)自相矛盾 | kernel/settings.ts | `allocated` 只计注册集内 key,与 `budgetCommit.prunePerCli` 同不变式;+回归测试 |
| 17 | `budgetCommit` 用 `Number.parseInt`("30x"→30 通过),宽于「非整数拒绝」契约 | session-budget/budgetCommit.ts | `Number()` 严格解析;+拒绝测试 |
| 18 | adoptSpawned 两次订阅 await 之间 removeSession 插入 → 退订表查不到,泄漏 2 个 Tauri 监听 + 幽灵登记 | kernel/host.ts `adoptSpawned` | 订阅完成复查存活,已删即成对退订不登记 |
| 19 | removeSession 删尽会话时 `activeSessionChanged` 不广播 null 转换(与 428e3e5 自己的「隐式切换也要广播」理由相悖) | kernel/host.ts | 无条件广播(含 null);host.ts 全程守在 499/500 行内 |

### P2/P3 · 韧性补强

- welcome:新增 ENGINE_METAS ↔ allPlugins 注册 profile 双向契约测试(补上「引擎卡片静默消失」盲区,与 08c5419 的安装侧契约对齐);`latestVersion` 模块级 5min TTL 缓存(免每次回首页 8 连发 registry 请求);EngineCard `doneFired` 去重(成功安装双触发 onDone)。
- PluginMarketPage 插排插头 div → button(键盘可达,UA 样式重置)。
- 注释校准:composerStage「三段/40%」→「四段/30%」、ComposerToolbar 同步、settings.ts 残留「设置面板写入剪除」表述改为实际路径(session-budget 弹窗)。

## 二、方向与架构判定

- **方向**:插件化(session-budget 拆独立、市场插排、挂点扩张)、openspec 流程(提案→裁决→反转留痕)执行一致;无越权改动。
- **架构**:三铁则 + 500 行 + 插件隔离全部成立。压力点:host.ts 499 行贴线(下个特性前建议拆 spawn/adopt/identity 模块);composer 在途 WIP 捆绑了 3 个相邻小改(四段高度/拖放守卫/附件条改版)未单独立 change —— 已在 proposal Impact 留痕,建议后续拆分。
- **openspec 卫生**:无归档约定(无 changes/archive、无 README)。按「任务全勾 + 代码核实」标准,add-ask-sound、add-qoder-cli、git-right-panel、session-budget-standalone、session-list-budget-plugin 均达归档线(各余 1 项手动冒烟);composer-command-drawer 在途不归档。是否引入归档约定留给用户决策。

## 三、文档同步校准(~30 处)

- **02-code-architecture.md**:§1 插件子图补 qoder/qoder-cn/session-budget/settings + git 去「占位」;§2 12→15 插件、×6→×8 profile;§4 `fsWriteTemp` 落点改系统临时目录;§5.1 五家→八家(grok summary.json 真源、qoder claude 同构);§6 overlay 补 settings 贡献;§8 命令表 29→45 全量重写(含 15 个 git 命令、`fs_remove_file`→`fs_remove_path`、git_status 改 libgit2、session_list 去掉「sessions.json 恢复」——该文件是旧版遗留,现无代码读写);§10 git 占位/overlay 无贡献者两条缺口改真;DISK/FS 节点对齐。
- **01-overview.md**:插件清单 15、Rust 树(git/、resolve/、hash.rs、settings.rs)、bracketed paste 表述(v1 不用)、§8 四→八 CLI、roadmap 去「mossx git」(已完成)、vendors.ts→vendors/ 目录。
- **README.md**:6 处 CLI 清单 5→8;claude 翻译格式订正(`/skill-name`→`/<name>`)、补 kimi;bracketed paste 子弹改真;插件树 15 个。
- **研究矩阵**:标题 + kimi/qoder 双增补(实证以代码为准:qoder 触发符仅 `/` 透传、kimi npm 包 `@moonshot-ai/kimi-code`)。
- **docs/README.md**:目录表删不存在的 decisions//specs/,补 design/prototypes/review/superpowers。
- **superpowers 插排设计稿**:补「实现修订」(`core?:boolean`→`category` 三值、10→15 插件、后续合并大插排)。
- **openspec**:session-list-budget-plugin Impact 加迁移注;git-right-panel INDEX/CHANGELOG 升 v0.3 Implemented(记录待验收 + 本次 remote_ops 补修);add-ask-sound Impact 加「host 零改动」落地修订;composer-command-drawer 四件套校准(⌘K 焦点场景与实现对齐、`listSuggestions` 范围收敛到抽屉并删未落地的「磁盘技能热更新」场景、McpServerRef 校订、qoder MCP 声明对齐、Impact 补捆绑留痕、验证数据 464→483、tasks 0.3 勾选)。

## 四、记录未修(经判断留置)

- pty.rs spawn 线程先于注册表 insert 的竞态、kill() 不杀孙进程/zombie 窗口 —— 先于今日存在,修复需重排 spawn 顺序与进程组信号,回归面大,建议单独变更。
- `std::env::set_var("PATH")` 后台线程写 env 的 std 竞态(理论性,macOS/Linux 现实风险低);omp_auth 同步 sqlite 命令在主线程;git patch/limit 无字节上限(超大仓库 DoS 面);quota env 通配暴露面 —— 均为已知权衡,留观察。
- `listPluginStates().enabled` 与级联跳过激活态不一致(现无插件声明 dependsOn,零影响)。
- SuggestionList `top-[52px]` 与附件条并存的定位重叠 —— 需视觉验证后调。
- 手动验收项:drawer tasks 2.6/2.7/3.4/4.5/4.6 与 budget 冒烟 4.3/4.5 维持未勾,留待真机。

## 五、验证

| 门禁 | 结果 |
|---|---|
| vitest | 56 文件 / 483 测试全绿(评审前 478,新增 5:预算残留 2 + 解析拒绝 2 + 引擎契约 1) |
| tsc --noEmit | 零错 |
| check:file-size | ✅(评审前 ❌ resolve.rs 531) |
| check:arch-boundary | ✅ R1/R3/R4 |
| cargo test | 44 全绿 |
