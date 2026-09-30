# 18 — 生成会话无头契约:oneshotArgs 声明制与无人值守会话输出纪律

日期:2026-09-30
状态:生效中(omp 已声明;其余 CLI 家族按各自无头能力补声明)

## 背景一两句

daily-journal 后台生成曾以真实 omp TUI 形态常驻,三槽并发下 TUI 全屏重绘字节(实测单会话 5-12MB/9 分钟)经 `pty://out` 全量灌入 webview 主线程(每会话另有 headless xterm 镜像同步吃流),叠加摘录构建的全量转录解析,前台幕布被饿死——用户感知为「omp 对话卡死」,而 omp 进程全程健康。根因评审:docs/review/2026-09-30-omp-dialog-freeze-root-cause.md;修复设计:docs/superpowers/specs/2026-09-30-daily-journal-oneshot-gen-design.md。

## 契约

### 1. 无人值守会话禁 TUI(纪律)

任何插件发起的无人值守 CLI 任务(批量生成、定时任务、自动化摘要),**不得以 TUI 形态 spawn 常驻**。TUI 的全屏重绘输出在无人观看时是纯洪水:Rust 泵无可见性过滤地 emit,webview 侧每会话一条全守望链(headless xterm 镜像 + 逐行正则)同步消费,主线程被压满即前台幕布饿死。

### 2. `CliProfile.oneshotArgs`(声明制)

```ts
oneshotArgs?: (opts: { promptFile: string; model?: string }) => string[];
```

- 声明 = 引擎具备无头单发能力:prompt 以 `@<promptFile>` 文件传入(数百 KB 摘录不挤 argv),进程答完即退,零 TUI。
- kernel `host.createSession` 增 `opts.oneshot: { promptFile }`;spawnNew 命中时 args 全量取自模板(不拼基础 args/modelArg),并跳过磁盘身份探测快照(无头声明语义含「不落会话文件」,无身份可绑)。
- 缺省 = 引擎无无头能力,调度侧回落 TUI 会话(既有路径),**回落是兜底不是许可**:新引擎接入时应优先验证并声明无头旗标。

### 3. 逐家声明矩阵(2026-09-30 本机 `--help` 实证)

| 引擎 | 声明 | 要点 |
|---|---|---|
| omp | `oneshotArgs`(file) | `-p --auto-approve --no-title --no-session --no-extensions --print-thoughts --max-time 14m` + `@file`;`--model`(print 态缺省只在结尾一次性打印答案,`--print-thoughts` 让思考流实时可见;`--no-extensions` 静默扩展在无会话身份下的报错) |
| pi | `oneshotArgs`(file) | 与 omp 同源:`-p --no-session` + `@file`;help 零审批旗标(print 态直接跑工具),无需审批旗标 |
| codex | `oneshotStdin` + `oneshotArgs` | `exec --skip-git-repo-check --approve-for-me -` + `-m`;审批路由进 workspace-write 沙箱自动复核(比全 bypass 收敛) |
| claude | `oneshotStdin` + `oneshotArgs` | `-p --dangerously-skip-permissions` + `--model`;help 明确支持管道;非交互态自动跳过 trust 弹窗;本版无 `--permission-mode` |
| dsh | 未声明 | CLI 有 `--profile headless` 且 `-` 读 stdin,但插件 spawnTransform 把一切 spec 改写为 node 适配器形态,需专项适配(transform 加 oneshot 直通分支)后接 |
| kimi / grok / qoder | 未声明 | 无头形态存在(kimi `-p <prompt>`、grok `-p --single`、qoder `-p`),但 prompt 只能走 argv——大摘录(百 KB 级)在 Windows 32K 字符命令行上限必炸;待上游提供 stdin/file 输入再接 |
| opencode | 未声明 | `run` 子命令非交互,但审批语义无法从 help 判定,未经真机实证不声明 |

递送方式两型:`oneshotStdin: false`(缺省)= 引擎在模板内以 `@<promptFile>` 引用;`true` = genSession 在 spawn 后经 `writeSession` 向 PTY 注入 prompt 全文(无头进程无 cooked→raw 时序,无冷启动窗)。

### 4. 结算语义(无头路径)

无头会话无用户首写、活动守望不锚定,`turnSettled` 天然不来。主信号 = `sessionExited`(finalize 先重读当日文章,有 = 成功,与退出原因无关);落盘轮询(15s)与 15 分硬顶保留兜底。产物以文件为准。

### 5. 摘录构建纪律(daily-journal 消费侧)

增量行跳过(`isRowSummarized` 过滤,summarizedAt 仅成功时前移)、读取并发上限 4、批间让出主线程一拍。批量解析永不与前台渲染抢死主线程。

## 消费面

- daily-journal/genSession.ts:唯一现消费方(引擎 = GenSettings 所选;omp/pi/codex/claude 已声明即走无头,其余回落 TUI)。
- 新引擎接入流程:验证无头旗标与 prompt 递送方式 → 插件声明 `oneshotArgs`(必要时 `oneshotStdin`)→ 调度自动生效,内核零改动。
