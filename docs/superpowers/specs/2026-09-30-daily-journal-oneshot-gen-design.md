# daily-journal 生成会话无头化:oneshot 单发根治输出洪水

日期:2026-09-30
状态:已定稿(根因评审见 review/2026-09-30-omp-dialog-freeze-root-cause.md)

## 背景与目标

daily-journal 后台生成以真实 omp TUI 形态跑(`host.createSession(activate:false)` + 大 prompt 写入 + 双保险补 CR),三槽并发下 TUI 全屏重绘字节(实测单会话 5–12MB/9 分钟)经 `pty://out` 全量灌入 webview 主线程,叠加每会话 headless xterm 镜像与摘录构建的全量转录解析,前台幕布被饿死——用户感知为「omp 对话卡死」。根因评审定案:冻结在「输出投递」层,历次队列/渲染层修复均不触及。

目标:

1. 生成会话改无头单发(`omp -p`),**从源头消灭 TUI 重绘洪水**——没有 TUI 就没有重绘,无需任何投递闸;
2. 结算信号随之简化:进程退出为主信号,文章落盘轮询兜底,删除全部 TUI 时序补丁(冷启动等待、双保险补 CR、[Paste] 兜底);
3. 摘录构建治理:增量会话跳过已归纳转录、并发上限、逐批让出主线程,批量解析不再饿死幕布;
4. 契约化:`CliProfile.oneshotArgs` 声明制,omp 先行,其余家族按各自无头能力逐家补声明。

## 方案取舍

**选定:无头单发(oneshot)+ 退出主信号结算 + 摘录治理。**

- `CliProfile` 新增可选声明 `oneshotArgs({ promptFile, model }) => string[]`;kernel `createSession` 新增 `opts.oneshot`,spawnNew 命中时以 `profile.oneshotArgs` 全量替代基础 args,并跳过磁盘身份探测快照(`--no-session` 不落盘,无身份可绑,还防误绑他人新会话)。
- omp 声明(18.4.4 实证旗标):`-p`(非交互答完即退)、`--auto-approve`(生成须写文章文件)、`--no-title`(杀掉标题生成 API 旁路请求)、`--no-session`(不落会话 JSONL,当日索引不再被生成会话污染,自指过滤退化为保险丝)、`--max-time 14m`(进程自裁,略早于 JS 侧 15 分结算硬顶)、prompt 经 `@<promptFile>` 文件传入(摘录+清单可达数百 KB,绕开 argv 上限)。模型仍走 `--model`(spawn 参数进程起点生效)。
- genSession 双路径:profile 有 `oneshotArgs` 走无头(新);没有则保留既有 TUI 路径(引擎选择面含全部 7 家,不得假设家家有无头能力)。
- 结算:无头会话无用户首写、活动守望不锚定,`turnSettled` 天然不来;主信号 = `sessionExited`(finalize 先重读文章,有 = 成功,与退出原因无关),落盘轮询(15s)与 15 分硬顶保留作兜底;「提前退出」话术改中性。
- 摘录治理:digest 输入 = 尚未归纳的行(`isRowSummarized` 过滤,summarizedAt 只在成功时前移,失败重试自动回退全量);读取并发上限 4,批间 `setTimeout(0)` 让出主线程;prompt 侧增量语义同步(摘录只含新增会话,已归纳以既有文章为准)。

**被否决:omp watchdog 自动重发 prompt。** 磁盘证据(冻结会话 JSONL 轮次完整、omp 日志心跳正常)证明 prompt 未丢、omp 活着;重发把方向修反,还会再插一轮对话。

**被否决:内核 detached 投递闸(Rust 泵按会话闸 emit + 打开即接管)。** 能兜住「无头能力缺失引擎」的洪水,但要动 PTY 核心泵与接管路径(ConPTY 握手、EOF 收割竞态都在同一文件),回归面覆盖全部会话;而 oneshot 已把现存唯一无人值守 TUI 源头清零,闸无实际拦截对象。留作未来出现「确无无头能力且必须后台跑」的引擎时的演进路径,不预付复杂度。

**被否决:生成并发降回 1 槽。** 止血不治本:洪水只与单会话输出量相乘,1 槽下长任务串行照样全天产洪;且 3 槽是用户拍板的吞吐决策。

**被否决:渲染健康守望加强(更激进 reload)。** 饿死不是死亡:主线程满载时 rAF 仍有帧,探针探测不到;reload 也不减少输出源,反而丢幕布状态。

## 验证

1. 单测:promptGen 增量语义、genSession 无头路径(spawn 参数/结算/取消收割)、sessionDigest 分批读取与增量过滤;全量 `pnpm test`。
2. `pnpm typecheck && pnpm check:arch-boundary && pnpm check:file-size && pnpm build` 全绿。
3. 真机目检(交付后人工):`pnpm tauri:dev` 起一个生成任务,确认 (a) 生成期间前台会话打字与输出即时,(b) 任务面板终态与文章落盘正常,(c) `~/.omp/agent/sessions` 不新增生成会话 JSONL,PTY 日志为 KB 量级。
4. 回归关注:非 omp 引擎(无 oneshotArgs)生成仍走 TUI 路径不劣化;`--no-session` 后身份状态显示「—」属预期。
