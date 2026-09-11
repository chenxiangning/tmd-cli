# 提案:WSL 支持 M1(wsl-workspace-m1)

## Why

ml-pipeline 等 Linux-only 工作负载需要 tmd-cli 直连 WSL 发行版。2026-09-11 完成四链路调研(scout 报告沉淀记忆 #82)+ 三件套交互原型(`docs/prototypes/wsl-{1-connect,2-sessions,3-workspace}.html`,浅色真值令牌,交互点清单在各文件头注释)。技术路线已扫清、改动面已钉死,缺的是正式 spec 收敛与实施任务分解。排在 P0 横评广播之后:广播会把 spawn 路由与列组件惯例踩热,WSL 直接复用。

## What Changes

M1 = 「WSL 当工作区跑起来」最小闭环,四条链路:

- **连接管理**:WSL 发行版建模抄 ssh.hosts(settings 持久化)+ dsh homePanel 状态机骨架(探测/自拉起/就绪轮询)。`wsl.exe -l -v --running` 探测发行版与运行态;docker-desktop 等系统发行版隐藏。添加工作区弹层「本地目录 | WSL 发行版」两 tab(原型 3 交互点 1)。
- **工作区建模**:`Workspace` 加 `kind:"wsl"` + `distro`,改动恰 3 处:`src-tauri/src/session.rs:41 WorkspaceMeta`、`src/kernel/workspace.ts:14`、`src/kernel/ipc.ts:113`。中央区顶部浅黄信息条「文件经 \\wsl.localhost 9P 通道读取,大目录索引较慢」(可关)。
- **spawn 路由**:`wsl.exe -d <distro> --cd <linux路径> -- bash -lc '<cmd>'` 包装,走现成 `CliProfile.spawnTransform`(cli.ts:262)或 kind 路由(先例:ssh kind=SessionMeta.kind);PTY 唯一收口 `session_spawn → pty_spawn.rs`,ConPTY CPR 代答已通(pty_spawn.rs:76)。横评广播零改动继承此路由(spec「边界与兼容」节:列 cwd 一律继承工作区,不做混合列,不做 distro 内安装探针)。
- **会话扫描/读取**:UNC `\\wsl.localhost\<distro>\home\<user>\.claude` 喂现有六个 fs 原语(fs_collect_files/fs_read_head/tail/fs_remove_path/sqliteQuery/configHomeDir),零改动复用各 cli-* listSessions。树顶显「索引 N 文件 · Xs(UNC)」+ 骨架懒加载。

### 明确降级 / 遗留(M1 不修,如实标注)

- **git 面板置灰**:git2 对 UNC 不可靠 → WSL 工作区 Git tab 禁用 + tooltip「可在终端内用 git」;
- **opencode sqliteQuery 读 9P WAL 库锁风险** → 该引擎在 WSL 下历史扫描降级显 `—`;
- **fs_remove.rs:9-38 白名单锁本机 home** → 需扩 `\\wsl.localhost` 前缀(trust-boundary 变更,须单测);
- **pickDirectory 原生对话框选不了 WSL 路径** → 新 IPC 命令 `wsl_list_dir`(逐级懒加载即其消费面);
- **路径相等判定裸 "/" 拼接**(useCkptScope/promptStore/repoContext/configGui 多处)→ 实现须守 repos_scan.rs:104「回拼输入 root 形态」纪律;
- **checkpoints 快照对 WSL 工作区**:M1 不承诺(依赖 fs 一致性语义,另议)。

### 不做(M2+ 触发再议)

WSL 内 GUI/系统级集成、9P 性能优化(索引缓存)、distro 内 dsh host、跨 distro 工作区。

## Capabilities

### New Capabilities

- `wsl-workspace`: WSL 发行版连接、kind:"wsl" 工作区、UNC 文件/会话扫描与 bash -lc spawn 路由。

### Modified Capabilities

- (无现有 spec 能力被改;fs 原语白名单扩展属 `file-render-profiles`/归档域的 trust-boundary 实现细节,记入本变更 design)

## Impact

- **新增(Rust)**:`src-tauri/src/wsl.rs`(发行版探测 `wsl_list_distros` / 目录懒加载 `wsl_list_dir` / bash -lc 包装原语);`session.rs` WorkspaceMeta 字段。
- **新增(TS)**:`src/kernel/wslTypes.ts`(settings 持久化建模,抄 sshTypes.ts:7)+ 连接/发行版选择 UI 组件(挂 settings 或 welcome,按原型 1 落位)。
- **修改**:`src/kernel/workspace.ts`(kind+distro)、`src/kernel/ipc.ts`(WorkspaceMeta + 两条新命令)、`fs_remove.rs`(白名单前缀)、路径拼接守点逐个核正、git 面板按 kind 降级一行。
- **架构边界**:内核不持 distro→路径知识(拼 UNC 是各消费方经通用原语的自由);cli-shared 不动;广播列组件 spec 约定独立文件 = 本变更复用点。
- **门禁**:前端五件套 + `src-tauri/` `cargo test && cargo clippy --all-targets -- -D warnings && cargo fmt --check`;**UI 行为改动须真 Windows 机 tauri:dev 目检**(macOS 无法复现 wsl.exe/9P/ConPTY 行为,验收清单须含 Windows 实机项)。
- **文档**:落地后沉淀 `docs/architecture/NN-wsl-contract.md`;docs/README 登记三原型条目(现未登记,本次提案随带补登)。
