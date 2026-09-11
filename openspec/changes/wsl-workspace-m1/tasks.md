# 任务分解:WSL 支持 M1

前置 P-1 = 本变更唯一的"实施前准备":需求收敛自三原型 + 记忆 #82,先出正式 spec(AGENTS.md 铁律:设计探索期原型 → 需求收敛后 spec)。Windows 实机是硬前置(纯 macOS 无法验收 wsl.exe/9P/ConPTY)。

## 0. spec 收敛(实施前)

- [x] 0.1 写 `docs/superpowers/specs/2026-09-11-wsl-workspace-m1-design.md`(16f295a):四段齐;M1 边界 = proposal「明确降级/遗留」六条 + spec §4 降级矩阵;docs/README 登记 spec(原型行由并行会话补登)
- [ ] 0.2 真 Windows 机冒烟探针(一次性脚本,不入仓):`wsl.exe -l -v --running` JSON 化输出稳定性、`--cd` Linux/Windows 路径双形态行为、UNC `\\wsl.localhost` 与 `\\wsl$\` 老写法可达性、9P 列目录实测延迟量级 → 结论写进 spec「验证」节
- [x] 0.3 spec 评审通过(2026-09-11 大仙指令「整利索到可执行状态」= 授权开工);1.x 放行,唯 1.2/4.3 实机项等 Windows 机到位

## 1. Rust 原语(src-tauri)

- [ ] 1.1 `wsl.rs`:`wsl_list_distros`(名称/版本/运行态,过滤 docker-desktop/workspace 类系统发行版)+ `wsl_list_dir`(bash `ls -1` 懒加载,回 `{entries:[{name,isDir}], path}` 形态守 repos_scan.rs:104 回拼纪律)
- [ ] 1.2 spawn 路由:`session_spawn` 认 `workspace.kind==wsl` → 包装 `wsl.exe -d <distro> --cd <path> -- bash -lc '<cmd>'`;cwd 存 Linux 形态;ConPTY 路径回归(pty_spawn.rs:76 CPR 代答已在)
- [ ] 1.3 `fs_remove.rs` 白名单扩 `\\wsl.localhost` 前缀(trust-boundary;单测:UNC 内允许、UNC 外越界拒绝、符号链接逃逸拒绝)
- [ ] 1.4 `WorkspaceMeta` 加 `kind/distro`(session.rs:41)+ `SessionMeta.kind` 消费面回归

## 2. kernel + UI(TS)

- [ ] 2.1 `workspace.ts`/`ipc.ts` 类型:`Workspace.kind?: "wsl"` + `distro?`(缺省 = 本地,老数据零迁移)
- [ ] 2.2 `wslTypes.ts`:发行版连接 settings 持久化(抄 sshTypes.ts:7 惯例)
- [ ] 2.3 添加工作区弹层双 tab「本地目录 | WSL 发行版」(原型 3 交互点 1;发行版下拉运行态可选/停止置灰;`wsl_list_dir` 逐级懒加载 + 骨架)
- [ ] 2.4 工作区卡 WSL 徽章 + 中央浅黄信息条(可关,原型 3 交互点 2)
- [ ] 2.5 文件树 UNC 索引态:「索引 N 文件 · Xs(UNC)」+ 懒加载骨架(交互点 3);git 面板 tab 按 kind 置灰 + tooltip(交互点 4);右键「在 WSL 终端打开此处」→ 内嵌幕布(交互点 5)
- [ ] 2.6 各 cli-* listSessions 经 UNC 零改动回归(claude/kimi/qoder/omp/pi JSONL + opencode sqlite → WAL 锁风险降级显 `—` 实测)

## 3. 路径判定审计(易漏项,逐点核)

- [ ] 3.1 grep 全库裸 "/" 拼接点(useCkptScope/promptStore/repoContext/configGui 等记忆 #82 所列),逐处按「回拼输入 root 形态」纪律修正;每处一行改动 + 注释
- [ ] 3.2 大小写/分隔符敏感比较核正(CASE_INSENSITIVE_FS 先例 cli-codex/index.tsx:21)

## 4. 验证

- [ ] 4.1 cargo:`cargo test && cargo clippy --all-targets -- -D warnings && cargo fmt --check`(集成测试:fake wsl.exe 桩驱动 list/spawn 包装断言)
- [ ] 4.2 前端五件套全绿
- [ ] 4.3 Windows 实机 tauri:dev 验收清单(硬性):添加 WSL 工作区 → 文件树懒加载 → UNC 会话列表出历史 → spawn claude 进 distro 对话 → git 面板置灰 → fs_remove 归档删除 → 9P 慢路径不卡 UI
- [ ] 4.4 macOS 回归:非 WSL 工作区全链路零行为变化(kind 缺省路径)

## 5. 收口

- [ ] 5.1 `docs/architecture/NN-wsl-contract.md`:发行版建模/spawn 包装/UNC 原语喂入/降级矩阵
- [ ] 5.2 docs/README 条目 →「已落地」;AGENTS.md 若有新铁律位(白名单/路径纪律)顺手修订
- [ ] 5.3 提交按阶段分颗:`feat(wsl): …` 各带 scope(显式文件清单)
