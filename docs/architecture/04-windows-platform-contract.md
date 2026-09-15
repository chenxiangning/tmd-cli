# 04 Windows 平台适配契约:ConPTY 握手 / 会话 slug / 子进程收尸 / cargo test

日期:2026-09-06(来源:新装机 Windows 五缺陷修复,全部本机实证;评审记录随提交)

## 结论

Windows 是一等运行平台,但两类知识必须显式契约化、测试锚定,否则新装机必然复发:
1. **平台二进制行为**(ConPTY 握手、批处理 shim、进程树、SxS manifest)——代码侧必须主动适配,OS 不兜底;
2. **各 CLI 的磁盘落盘规则**(会话目录 slug、config 行尾)——只能实证反推,必须用测试钉死。

本档记录 2026-09-06 新装机实证落地的六条契约与对应回归锚点;后续实证续补(契约 7,2026-09-15)。

## 契约 1:ConPTY 启动握手 —— 必须代答 CPR

portable-pty 0.9 以 `PSEUDOCONSOLE_INHERIT_CURSOR` 建 pseudoconsole:ConPTY 启动即在输出侧发 DSR(`ESC[6n`)并**扣住输出等 CPR 应答**;此刻 xterm 尚未接入(启动期 emit 无人监听,前端输入闸也会丢 CPR),无人应答 = 终端永久黑屏。

- 适配:`pty_spawn.rs` `conpty_cpr_reply()` 在 `take_writer` 后 Windows 侧写 `ESC[1;1R` 并 flush;非 Windows 禁止(会向 shell 注入垃圾字节)。2026-09-15 校准:该代答字节本身无害(干净 ConPTY 实证参数化/无参数形态均不注入 omp),但幕布对 TUI 运行期 CPR 查询的应答存在错位注入面,见契约 7。
- 回归锚点:`pty_spawn_tests.rs::windows_conpty_启动输出在_cpr_代答后流动`(真实 ConPTY + cmd.exe,移除代答必红)。

## 契约 2:CLI 会话目录 slug(omp / pi)

会话身份绑定 / 自动重命名 / 状态观测 / edits 水位全靠「算出与 CLI 真实落盘一致的目录」。Windows 实证(2026-09-06 新装机,`~/.omp/agent/sessions` 与 `~/.pi/agent/sessions` 真实目录比对):

| CLI | home 内 | home 外(Windows 盘符路径) |
|---|---|---|
| omp | 剥 home 前缀,`/`→`-`(如 `-.tmd-cli-default`) | `--` 包裹,`\ / :` 全映射 `-`(如 `--C--codeeee-tmd-cli--`) |
| pi | 同左(`--` 包裹规则跨平台) | 同形,冒号必须映射(NTFS 目录名不允许 `:`) |

  - omp 的 Windows home 外分支按 cwd 形态判定(`/^[A-Za-z]:\//`);mac 实证为单横线包裹,保持既有分支不变。
  - 已知边界:UNC 路径(`//server/share`)未实证上游落盘形态,现走 unix 分支;有真实 UNC 工作区失配个案时再按实证补分支。

## 契约 3:npm shim 与子进程收尸

- Windows npm 全局 CLI 是 `.cmd/.bat` shim,`CreateProcessW` 不能直跑:pty/probe 按 PATHEXT 补扩展名,installer/npm 通道经 `cmd /c` 包裹;**应用自身的进程拉起同样受此约束**(hub/脚本直跑 `pnpm` 会得到 os error 193)。
- 超时收尸必须杀整棵树:`wait_child_with_timeout` 在 Windows 经 `taskkill /PID <pid> /T /F`(直接 kill 只杀 `cmd /c npm` 的 cmd,孙进程 node 握住 npm 缓存锁拖慢重试);unix 直接 kill。
- 回归锚点:`installer_tests.rs::npm_command_pins_latest` / `command_channel_passes_through` 的 Windows 分支。
- 双副本遮蔽(2026-09-11 win 实证):Windows npm 全局 shim 落在 prefix 根(`<X>\<bin>.cmd`,无 unix 的 `bin` 段),`probe.rs::npm_prefix_of` 据父目录 + `<X>\node_modules` 识别所属 prefix;官方原生副本(如 `.kimi-code\bin\kimi.exe`)无 node_modules → 非 npm 拥有。更新不变量 = 更新谁由探针命中的副本决定:welcome `resolveInstallPlan` 对 npm 拥有的副本走 npm 通道(安装器 `--prefix` 就地更新),声明 script 的引擎(官方原生分发,claude/kimi)不被 npm 覆盖。回归锚点:`probe.rs::npm_prefix_of_matches_platform_global_layout` / `engineMeta.test.ts::resolveInstallPlan 探针感知`。

## 契约 4:cargo test 在 Windows 需要延迟加载 comctl32

单元测试二进制不走 tauri-build 的 WindowsResource(仅链进 bin),没有 Common-Controls v6 manifest;而 tauri-plugin-dialog → rfd 静态导入 `TaskDialogIndirect`(仅 SxS comctl32 v6 提供)→ 加载器绑到 System32 的 v5 缺导出 → 测试进程启动即 `STATUS_ENTRYPOINT_NOT_FOUND (0xc0000139)`。

- 适配:`build.rs` 对 msvc 目标发 `/DELAYLOAD:comctl32.dll` + `delayimp.lib`。cargo 没有「仅单测二进制」的链接指令(`rustc-link-arg-tests` 只管 tests/ 集成测试),故全目标延迟加载:测试永不调用即不解析;主程序带 v6 manifest,运行期 SxS 照常解析,对话框行为不变。
- 推论:Windows 上 `cargo clippy --all-targets -- -D warnings` 会暴露一批 unix 专属死代码/未用导入 —— 平台门控必须完整(`#[cfg(unix)]` / `#[cfg_attr(not(unix), allow(dead_code))]`)。

## 契约 5:git 测试夹具必须显式 `core.autocrlf=false`

新装机 Windows 全局常配 `core.autocrlf=true`:checkout 物化 CRLF,对 blob 字节的 `\n` 断言必挂。`tests_common.rs` TempRepo 建仓即设 repo 级 `core.autocrlf=false`,断言所见即 blob 字节;产品代码不感知。

## 契约 6:记忆链路径与状态机

- home 一律经 `ipc.configHomeDir()`(Rust `dirs::home_dir`)实取,禁止经 `node -p` 子进程(新机无 node 时整条链静默回退空串);调用方对空串兜底提示。
- 共享库不可读分两态上报(`MemoryPoolStatus.reason`):`not-installed` = 库缺失/未迁移;`locked` = 打不开(busy,真·迁移窗口)。UI 两态分开表述,禁止统一误报「迁移窗口」。
- 迁移窗口状态机必须接线:`InstallCard` 在 bootstrap `REFUSED migration-locked` 时暂停 tmd-cli 自家 omp 会话并重试一次,仍锁则显式指引;面板不可用态同样保留底部工具条(控制台入口 + 诊断),入口消失 = 用户无路可走(2026-09-06 实证)。
- omp config 解析按 CRLF 容忍(`\r?\n`),Windows 手编 YAML 不再整段失配。

## 契约 7:ConPTY 下 CPR 应答错位 —— pi-tui 把错位应答解析成字符注入(2026-09-15)

**根因(大写 C)**:pi-tui(omp/pi)用「光标列测量」技巧定位自身光标 —— 写 `ESC[26G ESC[6n ESC[1G`(移到目标列、查 CPR、移回)。mac 上直连幕布,应答位置正确;win 上经 ConPTY 转发,幕布 xterm 报出的是 ConPTY 视角的错位光标(实测幕布实发 `ESC[1;1R`,Rust 侧 STDIN-PROBE 字节钩子捕获),pi-tui 消费错位 CPR 时把一个字符 'C' 注入输入框 —— 每次创建 omp 会话必现,出现滞后于注入(spinner 帧才渲染)。输入闸拦不住:应答是整段合法回传,且闸静默窗在 omp 冷启动静默期早已 release。

**纵深(小写 c,2026-09-10)**:幕布对 pi-tui 的 DA/Kitty 探测的自动应答(`ESC[?1;2c` 等)同样进 PTY stdin;实测 ConPTY VT 输入模式下整段应答字节级透传,但启动期模式切换窗口的拆段行为未证稳定,win 幕布对 DA/DA2/Kitty 应答整体不回写(能力探测皆有超时回退,等价跑在无应答哑终端)。

- 修法:`CliProfile.conptyCprMismatch`(omp/pi 声明)+ `terminalReports.ts` `shouldSuppressProbeReply(host, sessionId, data)` —— win 下 DA/Kitty 应答一律不回写,CPR 仅档案声明时也不回写;ssh/wsl 等死等 CPR 的会话档案不声明照放(2026-09-11/09-12 语义);焦点/鼠标/OSC/DCS/DECRPM 照放。`TerminalView` onData 接线。
- 佐证实验:①ConPTY VT 输入模式(ENABLE_VIRTUAL_TERMINAL_INPUT)下写入序列字节级透传;②干净 ConPTY 环境 spawn omp,`ESC[1;1R`/`ESC[R`/不代答三变体均不注入(排除契约 1 代答字节因果;不代答则输出扣死,契约 1 仍成立)。
- 回归锚点:`terminalReports.test.ts` —— 探测应答/CPR 按声明拦截、ssh-wsl 与用户击键双向不误伤、与 isTerminalReport 语义正交。

## 契约 8:events 归因路径闸 —— Windows 绝对路径必须入账(2026-09-15)

审批线 events 归因(checkpoints)从 CLI 会话 JSONL 提取 AI 写入事件,路径经两级闸:前端 `normalizeEditPath`(`src/kernel/editWatch.ts`,持有 cwd,负责 cwd 内相对化)与 Rust `canonicalize_event_path`(`src-tauri/src/checkpoints/path.rs`,单闸终审)。旧契约对 Windows 盘符形态(`C:\…` / `C:/…`)两闸都显式拒收 —— 但 omp/pi 的 edit 结果 hashline 头与 write `resolvedPath` 在 Windows 上全是盘符绝对路径,拒收即 events 归因全盲(实证:一次 10 次写入的轮次只入账 1 次,唯一幸存者是恰好以相对路径 echo 的 write)。新契约:盘符与 UNC(`\\srv\share`)按绝对路径入账,反斜杠统一为斜杠、盘符段作根(`..` 不可弹出)、NTFS 大小写不敏感比对 cwd 前缀;cwd 内由前端相对化入账,cwd 外存绝对形态(工作区外语义,无前像禁回退不变)。

- 适配:`normalizeEditPath` win 绝对分支(斜杠归一 + 小写前缀比对);`canonicalize_event_path`/`is_external_path` 收盘符与 UNC,POSIX 绝对/UNC/盘符三种头各自保留。
- 假结算自愈:events 会话的 `turnSettled` 是输出空闲启发式,Windows 上长静默工具(bash 跑测试 68s)会早触发封口,其后写入因「已封口不记账」全丢。`record_edit` 对带真实时刻(`ts >= anchor.ts`)的迟到磁盘事件照常入账并修订重封(`build_turn_entry` 既有冻结/幂等语义护住已审批批);PTY 标记(None 时刻)的重绘行照旧丢弃。
- 回归锚点:`editWatch.test.ts`(win 绝对路径相对化/上抛/盘符残片拒)、`cli-omp/edits.test.ts`(2026-09-15 真实会话行)、`checkpoints/tests/events_external.rs`(盘符/UNC 归一)、`checkpoints/tests/events.rs`(假结算迟到事件修订重封)。

## 排障备忘

- 终端黑屏 + 会话短码名 + 模型/额度 "—" 三症同根时,先查 slug 目录与 ConPTY 握手,再查上游 CLI 本身。
- `pnpm tauri:dev`、`cargo test`、插件市场安装日志是三条独立证据链;平台回归以 `cargo test`(Windows 本机)+ 前端 vitest 全绿为门槛,UI 行为以真实窗口目检为准。
