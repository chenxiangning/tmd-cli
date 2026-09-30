# omp 对话卡死根因评审:后台生成 TUI 洪水饿死 webview 主线程

日期:2026-09-30
状态:已完成(根因定案,修复设计见 specs/2026-09-30-daily-journal-oneshot-gen-design.md)

## 结论(先行)

「tmd-cli 使用 omp 对话卡死」不是 omp 卡死,也不是 daily-journal 队列逻辑卡死,而是 **daily-journal 的后台生成会话以真实 omp TUI 形态运行,其高频全屏重绘字节经 `pty://out` 全量灌入 webview 主线程(每会话还各挂一个 headless xterm 镜像同步吃流),叠加摘录构建在主线程全量读+解析当日全部会话转录,把前台幕布的输出处理与 xterm 渲染饿死**。omp 进程全程健康:轮次照常完成、JSONL 照常落盘、周期心跳照常跳动——画面不再刷新,用户以为对话死了。

归因「每日工作汇总插件引发」是对的;但此前四轮修复全部落在「队列账本」与「渲染器死亡」层,冻结发生在「输出投递」层,故始终未愈。

## 证据链(全部来自本机磁盘,2026-09-30 采证)

### 1. 冻结会话两侧记录互相矛盾——正是答案

以用户会话 `01a0f04d-cf87-7756-b1bb-e01a3da4401e`(11:13 创建)为例:

- omp 会话 JSONL(`~/.omp/agent/sessions/-code-AI-github-tmd-cli/…01a0f04d….jsonl`):12:14:38 助手输出完整总结(「设置页修复完成,汇报……」),**轮次正常跑完**;此后无新条目,直至 13:03:50 `session_exit(sighup)` 被杀。中间静默 49 分钟。
- 同进程运行日志(`~/.omp/logs/omp.2026-09-30.65752.log`):12:14 轮次结束后,12:18:41 / 12:24:17 / 12:30:23 / 12:57:57 的周期 usage 轮询**一次未落**,直到 13:03:50 被杀。

解读:omp 完成回答、进入 idle、心跳正常;用户屏幕上却 49 分钟毫无动静。用户输入(writeSession 直达 PTY)实际已送达,回复躺在输出缓冲里上不了屏。这是显示链路断供,不是 CLI 卡死;额度 5h 42% / 7d 63%,供应商侧无耗尽迹象。

### 2. 洪水源头的实物计量

今日 12:33–12:41 三个后台生成会话(重试 09-10/11/12/13,跑在 `~/.tmd-cli-default` 工作区),PTY 日志分别 **12.1MB / 8.0MB / 5.6MB**(`~/.tmd-cli/session/omp/-Users-chenxiangning-.tmd-cli-default/18d9ff18…/18d9ff21…/18d9ff54….log`)——三路 omp TUI 重绘字节约 26MB/9 分钟,约 50KB/s×3 全天候灌 webview。且「实测 done 后 PTY 日志仍持续写 48 分钟」(genSession.ts 既有注释),后台空转也在产洪。

### 3. 摘录构建与卡死时间窗重叠

digest 文件 mtime:11:12 / 11:18 / 11:23 / 12:37 / 13:06 五次构建,每次对当日全部会话**先全量读+逐行 JSON.parse、后截断**(`buildDayDigest` 的 `Promise.all` 无并发上限;预算截断只作用在装配层,读入层不设防)。任务账本(meta.json tasks)88–112 共 25 个重试任务从 09-29 深夜连跑到 09-30 13:05,负载源未断过。

### 4. `ui.loop-blocked` 是旁证不是根因

09-29 有 273 个 omp 进程日志,177 个(65%)出现 `ui.loop-blocked`;09-30 为 140 中 60(43%)。单次阻塞仅 0.2–2s,说明整机负载高,解释不了分钟级冻结。另:09-29 01:25:39 五进程同秒冻结 6.3 小时后同秒恢复,为整机睡眠,已排除。

## 根因机制链

1. daily-journal 每个生成任务 = 后台 spawn 一个真实 omp TUI(genSession.ts `host.createSession(activate:false)`),队列 3 槽并发(taskQueue.ts `MAX_CONCURRENT_RUNS=3`,09-30 12:05 自单槽上调)。
2. Rust 侧对所有会话无条件 8ms 聚合 emit `pty://out/{id}`(pty_spawn.rs 泵,无可见性过滤)。
3. webview 侧每会话常驻 `listen` → `appendOutput` 全守望链(hostWatches.ts):其中 AskScreenMirror 给每条活 CLI 会话养一个 headless xterm 同步吃同一股字节流;再加 stripAnsi、逐行 busy/idle 正则、editWatch、输出缓冲、事件再广播。
4. 三路 TUI 洪水 + 摘录构建全量转录解析(同在主线程)→ 前台幕布的 chunk 处理与 xterm 渲染饿死。
5. 用户感知「卡死」→ 杀会话、点重试 → 重试又起生成会话 → 正反馈循环。

## 为何历次修复未解决(逐条对照)

| 修复 | 层 | 为何无效 |
|---|---|---|
| 239f3ccf / 1c3e0b3b(run 态卡死、20 分硬顶、批量取消) | 队列账本 | 状态机是真 bug,但修好之后队列吞吐反而更高(1→3 槽、硬顶放行堵队),后台 omp 进程更多更密,洪水更大 |
| 38239d71 / d49a7154(rAF 垫片、渲染健康守望 reload) | 渲染器死亡 | 主线程被压满但未死时 rAF 仍有帧,守望不触发;即便触发 reload 也不减少输出源 |
| a246a28f(EOF 收割竞态) | 进程退出误判 | 与显示冻结无关 |
| 增量策略改 timer(用户手动) | 入队源 | 只挡自动增量;补齐/重试/定时与已在跑的生成会话照旧灌水 |
| 在途方向的「omp watchdog 自动重发 prompt」 | omp 侧 | 方向反了:磁盘证据证明 prompt 未丢、omp 活着完成轮次;自动重发只会再插一轮 |

## 修复方向

根治与取舍见 `docs/superpowers/specs/2026-09-30-daily-journal-oneshot-gen-design.md`:生成会话改 `omp -p` 无头单发,从源头消灭 TUI 重绘;结算以进程退出为主信号;摘录构建增量跳过 + 并发上限 + 让出主线程。
