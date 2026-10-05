# 结构化会话梳理批次落地(模型/引擎切换 · busy 排队 · 轮次通知 · 断线接续)设计

- 日期:2026-10-04
- 状态:已实现(前端门禁全绿;1421 桩目检三批全过;真机 tauri:dev 验收留大仙)

## 背景与目标

模块梳理(同日评审)发现两类问题:①协议漂移——omp 18.6.0 轮界帧更名
`turn_start`(18.4 实测为 `session_start`),reducer 只认旧名,首轮「落定|活轮」
切分失效(极简开关首轮无效);②协议现成能力被 UI 闸住——set_model /
get_available_models / set_thinking_level / follow_up / --resume 全部实测可用
(18.6.0 本机三发真进程探针:prompt 即时 ack 6.8ms、模型清单 39 个 rtt 0.45s、
set_model 后 get_state 立即反映、`--mode rpc --resume <id>` 同 sessionId 且
上下文保留),但 UI 无入口。目标:补齐 header 三菜单(模型/思考级/引擎)、
busy 排队发送、轮次结束 OS 通知、断线接续重开,并收口协议漂移。

## 方案取舍

### 选定

- **轮界双名兼容**:reducer 与分发 switch 同时认 `session_start`/`turn_start`;
  `turn_end` 忽略(结算仍走 `session_settled`,18.6 实测在发)。测试夹具补
  18.6 帧序回归。`PROMPT_TIMEOUT` 注释实证收口(即时 ack,与通用闸同值)。
- **模型/思考级菜单**(新拆 `ssHeader.tsx` 守 300 行):pill 变菜单按钮,
  懒载 `get_available_models` + `get_available_thinking_levels`(失败空表
  菜单内提示,重开即重试),筛选框;选中发 set_model/set_thinking_level →
  `get_state` 回读权威态回写 tab;失败留菜单内报错行。pill 文案
  `id:思考级`,title 带 provider/id。
- **引擎切换**:header 引擎名变菜单(仅 capable>1 时),列出声明
  structuredRpc 的 profile,点击 `openStructuredSessionTab(他 id, 同 cwd)`
  另开 tab(两引擎并存,keepAlive 各自保活)。
- **busy 排队**:busy 期输入框保持可用(占位文案切换),发送走 `follow_up`
  (引擎结算后自动起跑),header「排队 N」徽标(get_state.queuedMessageCount,
  发送成功与每轮结算各回读一次);发送失败保输入且回滚通知记账。
- **轮次结束 OS 通知**:复用 notify 插件 `shouldNotify("turnEnd")` 同闸同文案
  (notifyOsTurnEnd + 失焦),`promptDebtRef` 记账保证只有用户发起的轮次
  结束才发,点击深链回本 tab。
- **断线接续**:`CliProfile.structuredRpc` 增 `resumeArgs`(omp `--resume <id>`
  / pi `--session <id>`);PiRpcSession 构造可选 `{resume, seedBlocks}`,
  spawn 拼 resume 旗标,reducer `seed()` 以旧转录保形;exited 横幅按钮按
  接续能力显示「接续重开/重新开启」。
- **stderr 降噪**:ready 期 stderr 噪声不进状态行(只记尾行 ref),
  展示窗口 = 启动/失败/终态。
- 拆分:`sessionTab.tsx` 生命周期编排整体迁 `ssSession.ts`(useSsSession
  hook),渲染壳 136 行;piRpc 的部件纯函数块(widgetTier/
  widgetCancelledNotice/clockOf)迁 `piRpcReducer.ts`(两文件各守 300)。

### 被否决

| 方案 | 否决理由 |
|---|---|
| spawn 级 `--model` 旗标进 UI | 运行中 set_model 已覆盖;CLI 配置默认即 spawn 态,双入口徒增状态 |
| 接续提示行(system 块进转录) | phase 构建把 system 块折进「思考」组,标签误导且折叠不可见;接续信号已由按钮文案 + sid 连续 + 转录保形承担 |
| get_entries 回放历史 | 接续场景旧转录本就在 React 态(seed 保形);仅跨 tab 重开场景才需要,代价高收益低,YAGNI |
| 结构化 tab 发 KernelTopics.turnSettled 走 notify 插件 | 话题消费方按 PTY 会话语义(unviewed/会话表查名/激活 PTY 会话),结构化 tab 不在会话表,滥用话题 |
| busy 期 steer(插话改写在途轮) | 与排队语义二选一;follow_up 不扰动在途轮、行为可预期,先落排队 |
| piRpc.ts 标 file-size-exempt | 部件纯函数迁 reducer 后 292 行,零豁免守住铁则 |

## 落地|改动面

- `src/plugins/cli-shared/`:piRpc.ts(flavor resumeArgs + 模型/思考级/followUp/
  getState 封装 + turn_start 分发)、piRpcReducer.ts(seed + 迁入部件纯函数,
  Set→Record)、两测试文件(18.6 帧序 + resume 行为)。
- `src/plugins/structured-session/`:ssHeader.tsx(新)、ssSession.ts(新)、
  sessionTab.tsx(纯渲染壳)、structured-session.css、locales en/ja。
- `src/kernel/cliProfile.ts`(structuredRpc.resumeArgs)、cli-omp/cli-pi 声明各一行。

## 验证

- 门禁:typecheck / test(3630+)/ check:arch-boundary / check:file-size / build 全绿。
- 桩目检(1421 + Tauri 桩,三批):握手 pill=id:思考级;模型菜单(懒载/筛选/
  当前高亮/切换回读/菜单内报错);思考级 chip;引擎菜单(omp 当前禁用、pi 另
  开 tab 且 keepAlive 双树);18.6 帧序全轮(活轮渲染→结算切落定段);busy
  排队(follow_up 写 + Queued 徽标 + 结算清零);stderr ready 期不进状态行;
  退场→Resume session→spawn 带 --resume→旧转录保形 + 新轮续接。
- 单测:turn_start 轮界推进(18.4/18.6 双名)、resume 换壳(spawn 旗标 +
  种子回放 + 轮界对齐)。
- 真机 tauri:dev 验收留大仙(OS 通知链路需真窗口)。

## 追加打磨轮(同日第二提交)

协议类型块迁 piRpcTypes.ts(piRpc 恒满 300),新增四件(全部真机抓包定形):

1. 上下文用量:settled 边沿拉 `get_session_stats`,header 显示
   `context% · tokens k`(title 给全量;失败静默不显示)。
2. / 命令补全:composer 首个 `/` 触发懒载 `get_available_commands`(97 条
   缓存至 tab 生命期),前缀过滤 8 条,↑↓/Tab/Enter 补全,Esc 关闭;
   目录含 `input.hint` 参数提示。仅补全不代发(引擎自解析斜杠命令)。
3. 草稿持久化:localStorage `tmd.ss.draft.<profile>:<cwd>`,reload/关 tab
   不丢,send 成功即清;存储失效(隐私模式)退化为会话内。
4. 模型筛选 Enter/Tab 选中首个匹配(空筛 = 首项)。

验证:piRpc 单测 +2(getStats 提取/getCommands 过滤与 hint 映射;describe
补 beforeEach 清 writes/listeners——跨 describe 陈旧监听器会吞掉 frame 应答,
boot 假通过后握手挂死,5000ms 超时即此因);桩目检五链(stats pill `2.1% ·
20.8k`、/se 过滤两行、Enter 补 `/security `、reload 草稿恢复、筛 deep 后
Enter 发 `set_model:deepseek/deepseek-v4-pro`)。
