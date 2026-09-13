# omp 打开历史会话性能分析与常驻预热方案研究

- 日期:2026-09-13
- 状态:已落地(omp 预热接管,契约见 architecture/10-omp-prewarm-resume.md)
- 方法:PTY 复刻 tmd-cli 的 spawn 方式(同 TERM/COLORTERM 注入、代答 CPR/DA1 查询)实测;`PI_DEBUG_STARTUP=1` 打点;对照实验分离变量;pyte 终端模拟器渲染最终屏幕判读。omp v18.1.19(bun 1.4.0)。

## 一、耗时去向结论

用户感知「打开历史会话等 5-6 秒」,实测构成:tmd-cli 宿主开销极小(热 spawn <100ms + CLR 后 300ms flush),**大头是 omp CLI 进程冷启动 resume 到首屏的 3.6-4.0 秒**,其中 loadExtensions 独占 ~2.7s(71%)。终端里 `/resume` 秒开是因为那是**热进程内切换**(`AgentSession.switchSession`,扩展已加载),不走冷路径。

### 实测数据

| 场景 | 首屏(首个 \x1b[2J) | 备注 |
|---|---|---|
| 裸启动(新会话) | 0.62s | 先画屏,扩展加载在后台(~4.5s 完成) |
| resume 不存在的 id | 0.6s 出错退出 | 进程启动+定位会话本身很快 |
| resume 小会话(3KB) | 3.61-3.78s | 之前零输出 |
| resume 大会话(380KB) | 3.74-3.98s | 历史全量 dump 在 CLR 后 ~1.4s(152KB) |
| resume + `--no-extensions` | 0.89s(小)/ 1.08s(大) | **扩展加载即 ~2.8s** |

### 冷启动 resume 时间线(PI_DEBUG_STARTUP 实测)

```
0.00s  spawn
0.61s  loadExtensions:start
3.31s  loadExtensions:done        ← 2695ms,占 71%
3.31s  createAgentSession(77ms)
3.39s  InteractiveMode.init:recentSessions(353ms)
3.54s  mcps ×10 来源并发发现(各 ~210ms)
3.78s  首屏 CLR → tmd-cli 再等 300ms 放行输入闸
```

loadExtensions 的 2.7s:多来源扩展发现(pi legacy、claude plugins、claude-plugins/agent-plugins 市场、omp 插件)全量扫描,机器上参与扫描的有 `~/.claude/plugins` 3 个 marketplace 共 280MB(55 个 plugin.json)+ `~/.pi/agent/extensions`,伴随 `legacy-pi-extension-cache.db`(7.2MB、8570 条 bun CJS 解析缓存)读写,主线程 100% CPU 纯计算(macOS sample 证实,非 IO/网络等待)。**并行挂多个 omp 活进程时共享 sqlite 有锁竞争,偶发更慢(实测过 6.5s)。**

注:resume 目标会话与进程 cwd 不同桶时,冷启动还要走跨项目切换(`switchToResumedProject`:重载 settings/插件缓存/模型),同 cwd 与跨 cwd 实测 CLR 3.98s vs 3.74s,差异不大但存在。

## 二、常驻进程方案研究

问题:能否后台常驻 omp 进程,打开历史直接交接内容?

### 2.1 omp 原生能力面(排查结论)

| 能力 | 结论 |
|---|---|
| attach/多路复用(类 tmux) | **不存在**。会话与进程 1:1,`switchSession` 是进程内切换 |
| `omp ps` / broker / watchdog | 仅监督后台服务(browser-relay 等),**不缓存会话/扩展状态**,无助启动加速 |
| `omp join` / collab | 远程共享会话(链接制),非本地 attach |
| `--mode rpc` / `rpc-ui`、`omp acp` | 引擎/UI 分离协议(stdio JSONL / ACP),但要求宿主自己渲染全部 agent 输出——**违背 tmd-cli PTY 幕布铁律**,否决 |
| `--no-session`(ephemeral) | 与 switchSession 不兼容:注入 `/resume` 后 `setSessionFile` 抛 ENOENT(文件存在,疑似 ephemeral 态守卫),不可用于预热 |

### 2.2 可行方案:后台预热进程 + PTY 注入热切换

机制:空闲时后台 spawn 裸 omp(cwd=当前工作区),等扩展加载完成(~4.5s 就绪,CLR 后静默可判);用户点开历史会话时把该进程的 PTY 接管为新 tab(xterm 后挂,readopt 机制已有先例),**往 PTY 写入 `/resume <id>` + 150ms 后回车**,触发 TUI 内 `switchSession` 热路径。

关键实测(裸启动预热 5.5s 后注入):

| 场景 | 注入提交 → Resumed | 说明 |
|---|---|---|
| 小会话 | **240ms** | |
| 大会话 | **1246ms** | 大头是 152KB 历史全量渲染(冷启动同样要付) |

注入工程细节(实测):**整行一次写入会被 TUI 判定为 bracketed paste,回车不提交**;可行形态是「整行写入(不含回车)→ 150ms → 单发 `\r`」,或逐字符慢速写。跨 cwd 注入会被 switchSession 的 cwd policy 拒绝(File not found),**预热必须按工作区分池**;switchSession 自动恢复会话记录的模型/思考级别,无需额外处理。

### 2.3 缺陷与风险清单(如实)

1. **内存**:预热进程 RSS 实测 723-810MB(bun+扩展+LSP 常驻),是最大代价;建议单进程池、空闲回收。
2. **单会话 1:1**:一个预热进程只能接一次打开动作;连开多个会话只有第一个命中,其余回落冷启动。
3. **注入是非契约接口**:依赖 omp TUI 存在 `/resume` slash 命令与提交语义;omp 升级可能变化(tmd-cli 已有 slashCommandPulse 注入先例,风险同量级,可加降级检测)。
4. **空会话垃圾**:裸启动每次创建一个空会话文件(`--no-session` 又不可用)。缓解:预热时 `--resume` 一个专用占位会话文件(tmd-cli 维护),或销毁预热进程时清理其空会话。
5. **欢迎屏闪现**:tab 打开瞬间短暂可见预热进程欢迎屏,240ms-1.2s 后闪到会话内容;可用既有磁盘先行回放(墓碑帧)遮蔽。
6. **就绪判定不精确**:预热完成信号只能靠 CLR+静默启发(~4.5s),注入过早输入丢失;保守多等即可。
7. **竞态**:目标会话文件被删/改名时 switchSession 失败(unhandled),需检测输出中的失败特征并回落冷启动重试。
8. **跨工作区 miss**:预热按工作区池,命中不了回落冷启动(现有路径)。

### 2.4 互补方案(建议并行)

- **会话保活(keep-alive)**:关闭 tab 延迟 N 分钟杀进程,期间重开同会话 = 复用活 PTY(tmd-cli 已有 cliSessionId 去重直达路径,零成本)。纯内部改动,无 omp 耦合,风险最低。
- **上游 issue**:建议 omp 把 loadExtensions 移出 resume 首屏关键路径(裸启动已证明可后置)/ marketplace 扫描做 manifest 缓存。根治但依赖上游。
- **环境清理**:删不用的 claude marketplace(thedotmack 272MB)可立即缩小扫描面。
- `--no-extensions` profile 开关:~1s 冷开,砍扩展功能,产品取舍。

## 三、建议落地顺序

1. keep-alive(最低风险,先做)
2. 预热注入(收益最大:5-6s → 亚秒,按 2.3 清单控风险)
3. 上游 issue + 环境清理(并行)

## 四、第二轮:全引擎矩阵(2026-09-13 补)

### 4.1 冷启动 resume 基线(spawn → 历史可见/输出稳定,各会话真实 cwd)

| 引擎 | 冷启动 | 形态备注 |
|---|---|---|
| codex | 0.3-0.4s | Rust 二进制,历史直接可见;恢复时若该会话已被别的 app 打开会提示「open in another app」 |
| claude | 0.45s | 项目有未批准 MCP server 时先弹确认(与 tmd-cli 无关的环境事实) |
| kimi | 1.4s | |
| grok | 2.8s | 备用屏(\x1b[?1049h),无 \x1b[2J |
| omp | 3.6-4.0s | 见第一轮 |
| opencode | 5.6s | 首字节即 3.96s(bun 运行时全量初始化) |

注意:除 omp/pi 外各家均不发 `\x1b[2J`——tmd-cli terminalReplay 磁盘分支的 CLR 就绪探测对它们不命中,纯逻辑推演将落到 30s 兜底才放输入闸(实际影响面待真机确认,与本研究并行的一个线索)。

### 4.2 热注入 `/resume <id>`(裸启动预热 → 整行注入 + 150ms + 回车)成败矩阵

| 引擎 | 结果 | 耗时 | 备注 |
|---|---|---|---|
| omp | ✓ 直接恢复 | 0.24s(小)/ 1.2s(大,含 152KB 历史渲染) | switchSession 热路径;切换后**不建新文件、不写目标文件**(实测),磁盘身份稳定 |
| claude | ✓ 直接恢复 | ~0.3s | `/resume <id>` 支持带参;但冷启动本就 0.45s,预热无意义 |
| codex | ✓ 直接恢复 | ~0.4s | 同上无收益;另有跨 app 占用提示风险 |
| kimi | ✗ 弹 Sessions 搜索选择器 | 0.2s 弹出 | 带参不支持;picker 注入(搜索+回车)理论可行但脆弱,且冷启动仅 1.4s,不值 |
| grok | ✗ 弹 Resume session 面板 | 0.2s 弹出 | 同 kimi;冷启动 2.8s,收益小 |
| opencode | ✗✗ **注入文本被当作 prompt 发给模型** | — | 「/resume 不是 opencode 支持的指令」,危险,绝对不可注入 |
| pi | 未测注入 | — | `--resume <id>` 启动参数本身不生效(pi 0.85.1 的 --resume 不吃值,弹 picker;直接恢复应用 `--session <id>`)。**tmd-cli pi 插件 resumeArgs 现用 `["--resume", id]`,疑似一直没生效,应改 `["--session", id]`,待真机验证** |
| qoder / dsh | 未测(无近期会话样本) | — | qoder 无本地会话样本;dsh 是自家适配器形态,单独评估 |

**结论:预热注入机制只对 omp 一家成立且值得(3.6-4.0s → 0.4-1.3s);claude/codex 本来亚秒,kimi/grok 弹 picker 收益小,opencode 不可注入。不存在「通用预热框架」,是 omp 专属优化。**

### 4.3 预热机制对 tmd-cli 会话体系的影响分析

| 体系面 | 影响 | 对策 |
|---|---|---|
| 会话列表(useCliDiskScan) | 预热裸启动每次创建一个 Untitled 空会话文件,列表污染 | 占位会话方案:预热固定 `--resume` 一个专用 placeholder 会话文件,不增殖;或列表过滤占位 id |
| tab/session 表 | 预热进程若走 adoptSpawned 会凭空多一个 tab | 新建 Rust 侧 prewarm 管理器:spawn + 持 PTY + 判就绪,**不进 kernel sessionList**;用户打开时才走既有 adopt 合流 |
| webview 重载(readoptSessions) | 重载后重接管会扫到预热进程当普通会话 | Rust 侧 session 元数据加 prewarm 标记,readopt 跳过 |
| 生命周期/秒退检测 | 预热进程崩溃/被杀需自愈;不适用 START_FAIL_WINDOW_MS(它不是用户会话) | 池管理器监控 exit 后重预热或标记缺失,下次打开回落冷启动;应用退出 SIGKILL(TUI 忽略 SIGTERM) |
| 状态轮询/活动钟/Ask 检测 | 按 sessionId 订阅,预热不在表内不挂载 | 接管(adopt)时起轮询,与 openDiskSession 既有流程一致,**零侵入** |
| 身份绑定(identityLedger/.logptr) | 注入后 CLI 进程内活动会话从占位变目标 id | 接管时以目标 cliSessionId 走既有 bindIdentity;实测切换不产生新文件,磁盘身份稳定 |
| 输出缓冲回放 | 接管时缓冲里已有欢迎屏 ~10KB,attachTerminalStream 走内存回放分支 | 用户短暂见欢迎屏后切换重绘覆盖;就绪判定沿用静默 500ms,无需改 terminalReplay |
| 多开竞态 | 单预热进程只服务第一次打开 | 在 openingDiskSessions 闸内原子 check-out,第二个并发打开回落冷启动 |
| 注入可见性 | 输入框回显 `/resume <id>` 一闪(~240ms) | 可接受;slash 命令不进 prompt history |

### 4.4 最终收益/代价汇总(仅 omp 预热方案)

- 收益:omp 打开历史 3.6-4.0s → ~0.4-1.3s;其余引擎 0(claude/codex 亚秒,kimi/grok 无带参切换,opencode 禁注)。
- 代价:预热进程 RSS ~700-810MB;Rust prewarm 管理器 + kernel check-out 合流 + readopt 过滤 + 占位会话 + 注入器的工程量;对 omp TUI `/resume` 带参语义的非契约耦合(需输出特征检测降级);仅 omp 一家受益。
- keep-alive(关 tab 延迟杀)对所有引擎通用、零 omp 耦合,仍建议最先做。

## 附:实验可复现要点

- 判定「可交互」用 `\x1b[2J`(CLR)+300ms 对齐 tmd-cli `DISK_FLUSH_AFTER_CLR_MS`;
- 热切换成功标志:TUI 状态行 `Resumed session`;失败标志:`[Unhandled Rejection] ... File not found`;
- 预热进程杀除用 SIGKILL(SIGTERM 被 TUI 忽略,测试残留进程会竞争 sqlite 锁污染后续测量);
- 测试进程须与目标会话同 cwd 桶(`~/.omp/agent/sessions/<encoded-cwd>/`);
- 备用屏/重绘型 TUI(grok/opencode/kimi)的屏幕判读用 pyte 终端模拟器(pyte 需子类化屏蔽 `report_device_status` 的 private 参数崩溃);
- claude 冷启动遇「N new MCP servers」确认画面按 Esc 跳过再计时;
- 各引擎历史真实性判定:从会话 JSONL 抽用户消息文本,在 PTY 输出流(或 pyte 渲染屏)中 grep。
