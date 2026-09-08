# 04 Windows 平台适配契约:ConPTY 握手 / 会话 slug / 子进程收尸 / cargo test

日期:2026-09-06(来源:新装机 Windows 五缺陷修复,全部本机实证;评审记录随提交)

## 结论

Windows 是一等运行平台,但两类知识必须显式契约化、测试锚定,否则新装机必然复发:
1. **平台二进制行为**(ConPTY 握手、批处理 shim、进程树、SxS manifest)——代码侧必须主动适配,OS 不兜底;
2. **各 CLI 的磁盘落盘规则**(会话目录 slug、config 行尾)——只能实证反推,必须用测试钉死。

本档记录 2026-09-06 新装机实证落地的六条契约与对应回归锚点。

## 契约 1:ConPTY 启动握手 —— 必须代答 CPR

portable-pty 0.9 以 `PSEUDOCONSOLE_INHERIT_CURSOR` 建 pseudoconsole:ConPTY 启动即在输出侧发 DSR(`ESC[6n`)并**扣住输出等 CPR 应答**;此刻 xterm 尚未接入(启动期 emit 无人监听,前端输入闸也会丢 CPR),无人应答 = 终端永久黑屏。

- 适配:`pty_spawn.rs` `conpty_cpr_reply()` 在 `take_writer` 后 Windows 侧写 `ESC[1;1R` 并 flush;非 Windows 禁止(会向 shell 注入垃圾字节)。
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

## 排障备忘

- 终端黑屏 + 会话短码名 + 模型/额度 "—" 三症同根时,先查 slug 目录与 ConPTY 握手,再查上游 CLI 本身。
- `pnpm tauri:dev`、`cargo test`、插件市场安装日志是三条独立证据链;平台回归以 `cargo test`(Windows 本机)+ 前端 vitest 全绿为门槛,UI 行为以真实窗口目检为准。
