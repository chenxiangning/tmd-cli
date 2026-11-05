# RPC 会话体系对齐规划(差距梳理 + 批次拆解)

> 状态:已审批实施中(2026-11-05,大仙授权)。D1-D6 经 UI 示例稿
> `docs/design/rpc-session-parity.html` 逐一落形定稿(全部按推荐项);示例稿评审
> 补充的前提修正与红线注意已合入本文(§3/§5 批次 3 前置 P0)。本文档是实施基线,
> 正式设计随批次落 `docs/superpowers/specs/`,契约沉淀落 `openspec/changes/`。
> 前置事实基线:RPC 通道对话与渲染已稳定(2026-11-05 codemoss 对照重构已落地,
> 见 specs/2026-11-05-rpc-canvas-codemoss-design.md);本规划只做**会话体系层**。

## 0. 结论

RPC 会话当前是**零等公民**:核心对话/审批/存证能力齐备,但会话体系的呈现、守望、
生命周期、恢复、操作面五层全部缺失——左侧会话列表只有 PTY 活会话(Rust PTY 注册表
单一数据源),RPC 会话走 proc_stream 独立注册表,两表零交集。本规划以
**「投影 + 自有守望」**路线对齐 PTY 体验,Rust PTY 数据链零改动(互不影响红线),
UI 入口维持三分区隔离,拆六批次实施,每批独立可交付可验收。

## 1. 现状基线(功能梳理)

### 1.1 RPC 通道分层

```
Rust proc_stream(通用原语:行缓冲 out/err/exit 事件 + write/kill/kill_all)
  └ kernel/ipc.ts 四命令(R3 纪律;ipc.exec 权限门)
      └ cli-shared/piRpc.ts(NDJSON 协议客户端:多路复用 + prompt/follow_up/
        abort/resume + confirm 审批回路 + 模型/思考档位 + getStats/getCommands)
          └ cli-shared/piRpcReducer.ts(事件流 → CliTranscriptBlock[] 增量基座)
              └ structured-session 插件(keepAlive 中央 tab + 120ms 合帧 + 存证)
```

### 1.2 RPC 已具备能力(不重做)

- 对话全链:prompt/follow_up(队列制本地回显)/abort/resume(--resume 重接,种子切在途轮)
- 渲染:codemoss 对照重构终态(思考/工具过程可见-终态收敛、用户轮界渲染、图片单源)
- 审批:confirm 回路 tab 内闭环(confirmCard,数值 id 同型回传,畸形帧不产死卡)
- 存证:footprint/checkpoints co-sign + 深链回跳(openStructuredSessionTranscript)
- 磁盘转录:引擎自写 JSONL → 以「磁盘历史会话」身份进历史分页/session-search 检索/
  session-viewer 只读查看(续聊不可用)
- OS 通知(失焦 + 免打扰窗放行)、composer draft localStorage 持久化
- 入口:新建会话菜单三分区中的「带渲染的会话」组(与 PTY 网格/远程并列)——入口隔离已有雏形

### 1.3 PTY 会话体系能力面(对照基准)

| 层 | 能力 | kernel 模块 |
|---|---|---|
| 呈现 | 左侧活会话行(引擎分组)、会话 tab、重命名覆盖层 | host.getSessions ← session_list;sessionTabs;sessionTitles |
| 守望 | 呼吸灯(绿对话/蓝未读/灰静止)、unread、状态轮询、首写闸 | activityWatch;host unread;sessionStatus |
| 生命周期 | spawn/adopt 身份绑定、readopt(webview reload 重挂)、重启现场恢复、收割、保活、单例 | sessionSpawn/sessionAdopt;hostSessionServices;sessionRestore;sessionKeep |
| 组织操作 | 置顶(双作用域)、归档、静音、重命名、删除(磁盘物理删)、MRU 切换 | sessionPins/sessionArchive/sessionMutes/sessionTitles/sessionDeleted/sessionTabs |
| 审批 | 全局审批箱(跨会话集中) | approval-inbox |
| 存证 | checkpoints/footprint/时间线/深链 | checkpoints;footprint;sessionViewTabs |
| 检索导出 | 用户消息全文检索、转录 md 导出、快照 | session-search;transcriptExport |
| 健康 | 假死检测阶梯(Rust 侧自算传感器) | render_health(Rust) |

## 2. 差距矩阵(RPC 缺口,按严重度)

| # | 缺口 | 现状证据 | 影响 |
|---|---|---|---|
| G1 | 左侧无活会话行 | SessionList.tsx 头注「活会话 = 内核 PTY 注册表」;proc_stream 独立 HashMap 不进 session_list | RPC 会话在列表体系不可见,唯一呈现 = 中央 tab 一枚 |
| G2 | 守望全盲 | activityWatch/host unread 零 structured 感知(grep 0 命中) | 无呼吸灯/未读;后台跑完长轮,完成信号只剩 OS 通知 |
| G3 | reload/重启全灭 | main.tsx boot 即 procStreamKillAll;中央 tab 内存态;PTY 有 sessionRestore 而 RPC 无对等 | webview 重载/崩溃杀掉在途轮,子进程明明活在 Rust registry |
| G4 | 关闭即失联 | tab 关 = kill + sessionId 丢弃;磁盘历史行只读,无「继续对话」 | resume 只活在 tab 内 retry 按钮;PTY 历史行可续聊,RPC 不可 |
| G5 | 行操作面缺失 | 重命名/置顶/归档/静音/删除全是 sessionId 键的 kernel 服务,RPC 无行无 id | 无法组织管理 RPC 会话 |
| G6 | 健壮性杂项 | 超时 30s 一刀切(冷启动 5-6s 实证逼近);无引擎版本探测;帧丢弃静默;无轮次看门狗 | 引擎僵死无限计时;协议漂移排查盲;截断帧无声丢 |
| G7 | 存证闭环缺口 | evidence「进程退出不封口」;onExit 不调 settled;resume 重放帧因 activeSessionId 已清不记账 | 崩溃在途轮 checkpoint 悬锚;续跑轮写入存证盲区 |
| G8 | 审批不进全局箱 | approval-inbox 按 host.getSessions() 键 | 跨会话审批无集中视角(是否对齐见 D4) |
| G9 | 单实例锁死 | tab id = structured:profileId:cwd | 同引擎同 cwd 不能并行两个对照会话(低优) |

## 3. 设计红线(「互不影响 + 入口隔离」的操作性定义)

- **R-PTY0 PTY 数据链零改动**:不动 Rust session 注册表/session_list/activityWatch
  既有路径/readopt/sessionRestore;RPC 补齐全部走 kernel 前端契约投影 + RPC 自有
  轻量守望。PTY 行为回归 = 事故。
- **R-ISO1 入口三分区维持**:新建菜单 PTY 网格 / 带渲染的会话 / 远程与其他;左栏
  RPC 呈现独立分区(D1 裁决);PTY 会话的菜单/操作不出现 RPC 项,反之亦然。
- **R-ISO2 点击行为隔离**:PTY 行激活幕布会话 tab;RPC 行激活中央 structured tab;
  各自 MRU/焦点链互不抢占。
- **R-KILL 进程域独立**:RPC 子进程的拉起/收割/重接不触碰 PTY 进程域;kill_all 退役
  后 proc_stream 收割路径自成闭环。

示例稿评审补充(实现注意,2026-11-05):
- RPC 分区组件独立渲染,不进 workspace 的 sessions 派生链——防分组折叠/归档/
  hygiene 扫描误吞行(R-PTY0 的组件面)。
- kernel 投影文件头须声明双消费方先例(workspace 渲染 + structured-session 广播),
  过 kernel 分区盘点门禁。
- 中央 tab 条 structured tab 与文件 tab 需 kind 徽标/图标常驻区分(R-ISO2 可见面)。
- kill_all 退役后 boot 枚举是孤儿流唯一收口;枚举失败兜底策略写进批次 3 验收。

## 4. 待裁决决策(每项带推荐)

| # | 决策 | 选项 | 推荐 | 理由 |
|---|---|---|---|---|
| D1 | 左栏呈现形态 | a 独立分区(「带渲染的会话」小节,与新建菜单分区对应) b 混入引擎分组活会话区(行首图标区分) | a | 守望语义/点击行为/收割时序都不同,混排让两套语义互相污染;分区与入口三分区同构,隔离原则一贯 |
| D2 | 虚拟行数据通道 | a kernel 前端契约投影(仿 sessionViewTabs 先例,kind/payload/枚举 API 升 kernel) b Rust 会话表统一(RPC 也进 session_list) | a | b 是 2026-09-30 spec 已否决路线(动 readopt/收割/列表全链,PTY 回归风险);a 让 Rust 零改动,RPC 死一个投影行不影响 PTY 一个字节 |
| D3 | 操作面范围 | 最小集 = 跳转 + 关闭;完整集 = + 重命名/静音/置顶/归档/删除 | 最小集起步,重命名+静音随批次 5,置顶/归档/删除视使用反馈 | RPC 会话生命周期短(tab 关即终),归档/删除语义与磁盘历史行重叠;先不做避免为低频操作铺全链 |
| D4 | 审批进全局审批箱 | a 进(approval-inbox 增 RPC 卡) b 不进(tab 内闭环,行状态灯提示) | b | 入口隔离:RPC 审批卡依赖 confirm 回路上下文(tab 内已闭环);全局箱按 sessionId 键会引入虚拟 id 概念污染;行灯「等待审批」已覆盖发现性 |
| D5 | reload 行为 | a boot 枚举重接(get_state + 磁盘种子重建 tab/行) b 维持 kill_all 现状 | a | 重接失败兜底 = kill 单个 + 行消失,与现状等价,无净增风险;收益是 RPC 会话与 PTY 同级存活 |
| D6 | G9 单实例锁 | 放开(允许同 cwd 并行) / 维持 | 维持 | 引擎侧同 cwd 会话文件互踩风险未验证;低优,不为本轮添变量 |

> 2026-11-05 定稿:D1-D6 全部按推荐项,经示例稿 `docs/design/rpc-session-parity.html`
> 落形确认(大仙授权实施)。

## 5. 批次拆解(六批,依赖序)

### 批次 1 可见性(地基)

**目标**:RPC 活会话以独立分区出现在左栏(G1),busy 灯 + 跳转 + 关闭可用。

改动面:
- `src/kernel/structuredSessionTabs.ts`(新,仿 sessionViewTabs 先例):kind 常量、
  payload 契约(profile/cwd/sessionId/title)、枚举 API、变更订阅(topic)。
  structured-session 的 tabs.ts 内部实现改为消费 kernel 契约(单一事实源)。
- `src/plugins/workspace/`:「带渲染的会话」分区组件(活行:引擎图标 + 标题 +
  状态灯 + 关闭钮),数据 = kernel 枚举订阅;点击 openStructuredSessionTab;
  关闭 = 关 tab(kill 链路既有)。
- structured-session 广播行状态(busy/turnLive/等待审批)到 kernel topic。

验收:omp/pi 各开一会话 → 左栏分区两行;轮次进行中绿灯 + working 计时;点击激活
对应 tab;关闭行后进程收割(tab 列表/分区同步消失)。PTY 行为零 diff(check:gate +
目检 PTY 分组/RunningZone 不变)。

### 批次 2 守望平权

**目标**:G2 核心项——未读/完成态可发现,不依赖 OS 通知。

改动面:轻量 unread 守望(RPC 侧纯前端:轮 settled 且 tab 非激活 → 未读计数,
激活清零;因果信号用 prompt ack/session_settled,比 PTY 字节流干净,不碰
activityWatch);行灯三态(绿运行/蓝完成未读/灰静止);等待审批黄灯(D4-b 的
发现性补偿)。

验收:后台跑完一轮 → 行变蓝呼吸 + 计数;点开清零;审批等待时黄灯。

### 批次 3 生命周期平权(reload 重接)

**目标**:G3——webview reload/崩溃不再杀 RPC 会话。

**前置 P0(示例稿评审发现,不先改则重接对象活不到 boot 枚举)**:现有泵循环在
`event_sink::emit` 失败(webview 失联)时 `break` 视同 EOF,双 reader 退出后
`wait_child_with_timeout` 2s 宽限杀树(proc_stream.rs:119-127)——webview reload
必然触发杀树,子进程活不到重接。改造:emit 失败 → 置 detached 标记(失联待收养),
泵**继续读丢行**(排空管道防引擎 stdout 写阻塞),不收割不杀;boot 枚举收养后
恢复 emit;detached 超时兜底(无人收养 >N min 杀树)+ app 退出钩子杀残留,防真孤儿。

改动面:
- Rust `proc_stream.rs`:spec 增 `label: Option<String>`(spawn 传入,registry 持有,
  枚举命令返回)+ P0 的 detached 泵改造 + 枚举命令;~60 行。
- 前端 boot:kill_all 退役;枚举带 label 的活流 → 逐个重接(get_state + 磁盘转录
  种子重建 tab + 左栏行);重接失败(引擎僵死/get_state 超时)即 kill 该流,
  行不出现(与现状等价,无净增风险)。
- 种子复用既有 seed()(切在途轮律,2026-11-05 终态第 9 条);恢复进度走
  SessionRestorePill 同款 toast 形制(若 PTY 恢复进行中则排队其后,不混跑)。

验收:轮次进行中触发 webview reload → 会话行保留、转录种子重建、续跑轮次正常;
重接一个已僵死流 → 行不出现且进程收割;PTY 重启恢复链路零变化。

### 批次 4 恢复入口(关闭后续聊)

**目标**:G4——tab 关闭/app 重启后可「继续对话」。

改动面:sessionId 持久化(localStorage,键 `tmd.ss.last.<profileId>:<cwd>`);新建
菜单「带渲染的会话」组内「重开上次会话」入口(有持久 id 才出现,resumeArgs 启动 +
磁盘种子);磁盘历史行识别(行数据与持久 id 匹配时出「继续对话」,否则维持只读)。

验收:开 会话→聊一轮→关 tab→新建菜单出现「重开上次」→ 续聊上下文完整;历史行
「继续对话」同效;PTY 历史行续聊零变化。

### 批次 5 操作面(D3 最小集 + 重命名/静音)

**目标**:G5 子集——行可重命名、可静音。

改动面:重命名 = tab 标题覆盖层 + localStorage 持久化(左栏行/中央 tab 同步);
静音 = 通知抑制开关(行右键菜单;不接 sessionMutes,该服务按 PTY sessionId 键,
RPC 用自己的存储键,零共享)。

验收:重命名后 reload 仍在;静音后轮完成无 OS 通知;PTY 置顶/静音链路零变化。

### 批次 6 健壮性收口

**目标**:G6 + G7 一次清完。

改动面:
- 存证封口:onExit 调 evidence settled(封悬锚);resume 重放帧记账(activeSessionId
  在 agentStart 前回灌)。
- 轮次看门狗:busy 且 >5min 无帧 → 行灯/状态条提示 + 中止钮高亮(纯前端)。
- 握手超时分层:start 期 60s + 失败重试一次;稳态请求维持 30s。
- 引擎版本探测:get_state 若带版本则进 warn 胶囊/诊断面。
- 帧丢弃可观测:parse 失败/截断各计数,>0 时状态行一次性可关提示。

验收:kill 引擎进程模拟崩溃 → checkpoint 无悬锚;重接续跑轮的 write 帧落账;
僵死流 5min 出提示;人为截断帧出计数提示。

### 依赖关系

1 → 2(行存在才挂灯);1 → 3(重建行);3 ↔ 4 共用种子链路但相互独立可并行;
5 依赖 1;6 完全独立(可穿插)。建议实施序:1 → 2 → 3 → 4 → 5,6 可在 3 后任意
批次穿插(存证封口两项越早越好,可提到批次 2 一起)。

## 6. 不做清单(明确 out of scope)

- 移动端 RPC 面(mobile 树零改动;桌面先行,远期另立)
- MRU 快捷键(⌘1-9/Ctrl+Tab)纳入 RPC tab(走中央 tab 既有切换即可)
- Rust 会话表统一(D2-b,已否决路线不复活)
- 审批进全局审批箱(D4-b 裁决为不进)
- 单实例锁放开(D6 维持)
- 虚拟列表/渲染层(2026-11-05 已落地,零重叠)

## 7. 验证与门禁

- 每批:`pnpm check:gate` 全绿 + `pnpm tauri:dev` 真机目检(各批验收清单)+
  react-doctor 100 分收口。
- PTY 零回归专项:每批目检 PTY 分组/RunningZone/呼吸灯/重启恢复四件不变
  (R-PTY0 红线的验收面)。
- 契约测试:kernel 契约面(枚举/订阅/payload)、unread 守望纯函数、重接状态机
  (活流枚举 → 重接/失败兜底分支)。
- 批次 3 专项:reload 中途杀、僵死流兜底、与 PTY sessionRestore 并发排队。
