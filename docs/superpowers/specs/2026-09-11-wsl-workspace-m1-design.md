# WSL 工作区 M1:kind 路由 + UNC 现有原语复用

日期:2026-09-11
状态:设计定稿·实施就绪(前置 0.2 Windows 冒烟探针为验收门,非设计未决项;macOS 无法复现 wsl.exe / 9P / ConPTY 行为)

## 背景与目标

ml-pipeline 等 Linux-only 工作负载需要 tmd-cli 直连 WSL 发行版。2026-09-11 完成四链路调研(scout 报告沉淀项目记忆 #82)与三件套交互原型(`docs/prototypes/wsl-{1-connect,2-sessions,3-workspace}.html`,交互点清单在各文件头注释,浅色真值令牌)。本 spec 把调研结论收敛为变更契约;openspec 提案:`openspec/changes/wsl-workspace-m1/`。

目标(M1 =「WSL 当工作区跑起来」最小闭环):

1. **连接管理**:发行版探测(`wsl.exe -l -v --running`)、运行态区分、系统发行版(docker-desktop/workspace)隐藏;
2. **工作区建模**:`Workspace.kind:"wsl"` + `distro`,添加工作区弹层「本地目录 | WSL 发行版」双 tab,目录经新命令 `wsl_list_dir` 逐级懒加载;
3. **spawn 路由**:WSL 工作区内新建会话 → `wsl.exe -d <distro> --cd <linux路径> -- bash -lc '<cmd>'` 包装,复用现成 `CliProfile.spawnTransform`(cli.ts:262)或 kind 路由(先例:ssh kind=SessionMeta.kind);
4. **会话扫描/历史读取**:UNC `\\wsl.localhost\<distro>\home\<user>\.claude` 喂现有六个 fs 原语(`fs_collect_files` / `fs_read_head` / `fs_read_tail` / `fs_remove_path` / `sqliteQuery` / `configHomeDir`),各 cli-* 插件 listSessions **零改动**复用。

非目标(M2+ 触发再议):WSL 内 GUI/系统级集成、9P 索引缓存/性能优化、distro 内 dsh host、跨 distro 工作区、checkpoints 对 WSL 的承诺(依赖 fs 一致性语义,另议)。

## 方案取舍

**选定:工作区 kind + bash -lc 包装 + UNC 喂现有原语。** 改动面钉死(记忆 #82):`WorkspaceMeta` 恰 3 处(`src-tauri/src/session.rs:41`、`src/kernel/workspace.ts:14`、`src/kernel/ipc.ts:113`);PTY 唯一收口 `session_spawn → pty_spawn.rs` 不动,ConPTY CPR 代答已通(pty_spawn.rs:76,Windows 平台契约 04 已落地)。文件/会话读取全部发生在 Windows 侧 UNC 路径上,内核与插件对「这其实跨了一次 9P」无感知。

**否决:把 distro 套壳成 ssh host(远程主机域)。** 需要 distro 内起 sshd(用户自扛运维);且 ssh kind 是"远程主机会话"语义——呼吸灯/ask 守望/会话列表都按 host 域分支,WSL 会话混入后生命周期矩阵翻倍;而 WSL 明明有本地 PTY 正路可走。

**否决:通用「容器工作区」抽象层。** 唯一用例即 WSL,为不存在的第二个后端预造接口 = YAGNI;kind 判别联合已够,未来若真有 container/远程再泛化。

**否决:每引擎 WSL 变体适配器。** 8 引擎 × distro 的适配矩阵债,正蹈弃坑 codemoss 覆辙;UNC 方案把跨边界成本压在 fs 原语一层,插件零知识。

## 技术设计

### 1. 建模与连接(抄现成先例,不发明)

- 持久化 = `settings.wsl.hosts` 形态,抄 `sshTypes.ts:7` 的 ssh.hosts 惯例;`WorkspaceMeta{ id,name,root,createdAt,kind?,distro? }`——`kind` 缺省 = 本地,**老数据零迁移**。
- 发行版探测/自拉起/就绪轮询状态机骨架抄 dsh homePanel(`hostPanel.tsx`):未运行发行版在下拉中置灰(原型 3 交互点 1),不自动 `wsl -d X`(M1 把起停权留给用户,避免 9P 冷启动长阻塞混进 spawn 路径)。
- 探测命令经新 Rust 命令 `wsl_list_distros`,输出按 `wsl.exe -l -v` 列解析;`--running` 变体在旧 wsl.exe(Windows 10 1903-)不存在,解析须双形态兼容——**列为 0.2 探针实测项**。

### 2. spawn 路由

- 判定点唯一:`session_spawn` 装配 spec 时读 workspace.kind;wsl → 包装 `wsl.exe -d <distro> --cd <cwd> -- bash -lc '<command> <args…>'`(args 数组 shell-quote 后入单引号串)。cwd 存 Linux 形态(`/home/user/proj`),`--cd` 双形态(Linux 路径 vs Windows 路径)行为 **列为 0.2 探针实测项**。
- CLI 私有知识不进内核:哪些 profile 在 distro 内以 `command -v` 可用的探测,M1 不做(横评广播 spec 已裁:未装 → spawn 被拒 → `sessionStartFailed` toast 兜底,错误面 = bash 的 command-not-found 文本,crashTail 已能呈现)。
- 横评广播零改动继承本路由:广播每路 = `host.createSession`,cwd 继承工作区 → WSL 工作区内 N 列全在 distro 内;**不做混合列**(本地×WSL 同屏 = 题面文件上下文不一致)。

### 3. 文件/会话经 UNC

- 工作区 root = `\\wsl.localhost\<distro>\<linux 路径映射>`;`\\wsl.localhost`(1903+)与 `\\wsl$` 老写法可达性 **列为 0.2 探针实测项**;统一烘焙 `\\wsl.localhost` 一种形态入库,比较判定一律大小写不敏感(先例 CASE_INSENSITIVE_FS,cli-codex/index.tsx:21)。
- **无 fs watch 对 WSL 是红利**(调研结论):文件树不轮询,靠手动刷新/懒加载骨架(原型 3 交互点 3,树顶「索引 N 文件 · Xs(UNC)」);9P 冷列大目录秒级延迟为已知代价,浅黄信息条如实告知(交互点 2)。
- 各 cli-* listSessions 经 UNC 零改动回归;唯一例外 opencode:sqliteQuery 读 9P 上 WAL 库有锁风险 → WSL 工作区下 opencode 历史显 `—`(降级不猜,对齐「内核不理解 CLI 私有格式」铁律的缺失显示惯例)。

### 4. 降级矩阵(M1 如实标注,不静默)

| 面 | WSL 工作区行为 | 依据 |
|---|---|---|
| Git 面板 | tab 置灰 + tooltip「git2 对 UNC 不可靠,可在终端内用 git」 | git2 UNC 不可靠 |
| checkpoints 快照 | 不承诺(M1 禁用该工作区快照入口) | fs 一致性语义未验证 |
| opencode 历史 | 显 `—` | 9P WAL 锁 |
| fs_remove 删除 | 白名单 `fs_remove.rs:9-38` 扩 `\\wsl.localhost` 前缀;越界(如经符号链接逃逸出白名单)拒绝 | trust-boundary,须单测 |
| pickDirectory | 原生对话框选不了 WSL 路径 → 改走 `wsl_list_dir` 弹层 | 新 IPC 命令 |
| 右键「在资源管理器中显示」 | `explorer /select,<UNC>` | 原型 3 交互点 5 前半 |
| 文件树懒加载 | `wsl_list_dir`(bash `ls -1` 经 wsl.exe 执行) | 新 IPC 命令 |

### 5. 路径纪律(最易漏的一组)

裸 `/` 拼接判定点(useCkptScope / promptStore / repoContext / configGui 等,记忆 #82 点名)逐处按 `repos_scan.rs:104`「回拼输入 root 形态」纪律修正:对 UNC root 禁止再假设 `/` 分隔符与大小写敏感;每处一行改动 + 注释,由 tasks 3.1 全库 grep 收口。

## 改动面

| 层 | 件 |
|---|---|
| Rust | 新 `src-tauri/src/wsl.rs`(wsl_list_distros / wsl_list_dir / 包装纯函数);`session.rs` WorkspaceMeta;`fs_remove.rs` 白名单;`pty_spawn.rs` 零改动(回归项) |
| kernel TS | `workspace.ts` / `ipc.ts` 类型;新 `wslTypes.ts`(settings 建模);路径判定逐点核正 |
| 插件 | workspace(添加弹层双 tab / 卡徽章 / 信息条);files(树顶 UNC 索引态 / 懒加载);git(按 kind 置灰);cli-opencode(WSL 下显 `—`);cli-* 零改动(UNC 回归) |
| 内核零引擎知识 | distro→路径映射、发行版名单全在宿主原语与插件;`wsl.exe` 语义仅 Rust 一处 |

## 验证

- **0.2 冒烟探针(Windows 实机,一次性脚本,先于实现)**:① `wsl.exe -l -v [--running]` 输出稳定性与编码;② `--cd` Linux/Windows 双形态;③ `\\wsl.localhost` 与 `\\wsl$` 可达性;④ UNC 列 ~1k 文件目录延迟量级。结论回填本 spec 对应「实测项」并消项。
- Rust:`cargo test && cargo clippy --all-targets -- -D warnings && cargo fmt --check`;`wsl.rs` 解析/包装纯函数用 fake `wsl.exe` 桩喂夹具;fs_remove 白名单单测(UNC 内允许 / 越界拒绝 / 符号链接逃逸拒绝)。
- 前端:`pnpm typecheck && pnpm test && pnpm check:arch-boundary && pnpm check:file-size && pnpm build`;浏览器桩补 `wsl_list_distros/wsl_list_dir` 两 case 目检弹层与树。
- **Windows 实机 tauri:dev 验收清单(硬性)**:添加 WSL 工作区 → 文件树懒加载 → UNC 会话列表出历史(claude/omp)→ spawn claude 进 distro 对话 → 广播 ⚡ 在该工作区发三路 → git 面板置灰 → 归档删除走 fs_remove → 横切 macOS 回归:非 WSL 工作区全链路零行为变化(kind 缺省路径)。
- 落地后:结论沉淀 `docs/architecture/NN-wsl-contract.md`;docs/README 本条目 →「已落地」。
