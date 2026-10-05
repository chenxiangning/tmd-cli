# 手机列表页查询机制核对与优化设计(2026-10-05)

日期:2026-10-05
状态:调研完成,方案待确认(P1 可直接实施,P2/P3 需排期)

## 结论

手机列表页在**读头层已有完善缓存与增量**(2026-10-04 风暴根治成果,勿重做);
真正的优化空间在三个层次:

1. **P1 视图感知节流**(纯手机侧,零桌面改动):人在详情页/后台时,home 的
   60s 磁盘扫描 + 10s 审批轮询 + 2.5s/5s 列表轮询照跑,外网下与实况流抢带宽;
2. **P2 轮询事件化**(桌面小改):checkpoint/会话列表变化桌面本就知道,事件推送
   可把 10s/5s 轮询降为事件驱动 + 低频兜底;
3. **P3 复合快照**(架构级,需 spec):外网冷启动多 RPC 长链收敛为 1 RTT。

内网(直连)现状基本健康:RTT ~1ms,稳态每 60s 一波轻量 collect,不痛。

## 现状核对(逐链路)

### 数据流全景

```
MobileApp(常驻轮询)
├─ session_list + config_read_workspaces   2.5s(LAN)/ 5s(WAN,按活动端点动态)
│   └─ 签名比对后才 set(防 0.4Hz 全树重渲染)
├─ overlayState(titles/archive/pins)      退避链,settings:changed 事件触发重拉
└─ HomeScreen(常驻挂载,route 切换只 CSS hide,不重挂载)
    ├─ 磁盘历史:60s 周期(存在出生 2min 内未解析活行时压 5s)
    │   └─ roots 串行 × 单 root 内 9 引擎 scanner 并发
    │       ├─ fs_collect_files(每引擎 1-3 RPC,全量 FileStamp,~100B/条)
    │       └─ 读头:readHeadsBatched 768KB chunk 串行(仅未缓存条目)
    ├─ pollHomeWatch:10s,最新 12 会话**严格串行**
    │   ├─ checkpoint_list ×12(每会话 1 RTT)
    │   └─ 运行中会话再 session_history_page(8KB)查 ask 首现
    └─ 手动刷新/roots 变化 → 立即补轮
```

### 已有的缓存与增量(重要:不要重做)

| 层 | 机制 | 状态 |
|---|---|---|
| 读头 | headCache:mtime 命中复用解析产物;负结果(读成功无标题)TTL 5min;读失败不缓存(保恢复路径) | 已上线(2026-10-04) |
| 读头 | 批量 fs_read_heads:768KB 响应预算分 chunk 串行,防外网齐发风暴 | 已上线 |
| 清单 | collect 后按目录签名比对剪除死缓存(pruneHeadCache) | 已上线 |
| 渲染 | sessions/workspaces JSON 签名比对,无变化不 set | 已上线 |
| 轮询 | WAN 端点自动降频(2.5s→5s) | 已上线 |
| 追赶 | name-chase 限定「出生 2min 内未解析」窗口 | 已上线(0b4fd2fd/33340b41) |

### 重查触发场景全清单

| 场景 | 频率 | RPC 面 | 备注 |
|---|---|---|---|
| 列表轮询 | 2.5s/5s | 2 RPC | 签名去重仅省渲染,RPC 照发 |
| 磁盘历史周期 | 60s(5s 追赶) | roots×9 引擎 collect + 增量读头 | HomeScreen 常驻,**不在 home 视图也跑** |
| 审批/ask 轮询 | 10s | ≤24 RPC 串行 | 同上,后台照跑 |
| 手动刷新 | 用户 | 全链立即一轮 | |
| 工作区增删 | 低频 | 全量扫描 | roots 依赖变化 |
| 断连重连 | 桥自愈 | 首拉 + 磁盘波 | headCache 存活,仅 collect |
| 浏览器重启/重装 | 低频 | 全冷 | headCache 在手机浏览器进程,桌面侧无常驻 |

### 内网 vs 外网差异

同一套 RPC,差在 RTT 与封包:

- **内网直连**:RTT ~1ms,15s invoke 超时窗内随便跑;稳态 60s 波无感。**不痛**。
- **外网中继**:RTT 200-400ms + 响应 b64 膨胀(×1.33,已按 4MiB 帧上限控制预算)。
  慢的主因按序:
  1. pollHomeWatch 12 会话严格串行 ×2 请求 ≈ **24 RTT ≈ 7-10s/轮,每 10s 一轮**——
     几乎占满外网链路;
  2. 冷启动磁盘历史首扫:读头全冷 + chunk 串行;
  3. 后台波(不在 home 视图)与详情页实况流(pty://)抢出站带宽。

## 优化设计

### P1 视图感知节流(手机侧,零桌面改动,建议先做)

- **触发**:`route.view !== "home"` 或 `document.hidden` 时——
  磁盘历史 60s→5min、pollHomeWatch 10s→60s、列表轮询维持(轻,2 RPC);
  回 home / 回前台立即补一轮(复用 refreshTick 机制)。
- **收益**:外网详情页打字/实况流不再被后台波挤占;后台流量降 ~90%。
- **风险**:回 home 头几秒徽标/列表略旧,补轮即新(现有手动刷新同感知)。

### P2 轮询事件化(桌面小改,中收益)

- **checkpoint/ask**:桌面 checkpoint 注册表变化时 emit
  `checkpoint:changed`(event_sink 已有,conn.rs 事件域闸加一行白名单);
  pollHomeWatch 降 60s 兜底 + 事件触发立即拉。
- **session_list**:kernel sessions 注册表 spawn/exit/title 变化 emit
  `sessions:changed`(需 kernel 事件源,改动面在注册表单点);
  手机列表轮询降 30s 兜底。
- **收益**:外网稳态 RPC 大减(10s×24 → 事件驱动);徽标实时性反而更好。
- **风险**:事件风暴需合并去抖(注册表批量变化一次广播);域闸白名单扩面要
  过安全评审(现状只放 pty:// + settings:changed,扩面前确认 payload 无敏感面)。

### P3 复合快照(架构级,需单独立 spec)

`mobile_home_snapshot` 单 RPC 聚合 sessions + workspaces + overlay + 磁盘历史摘要:

- **收益**:外网冷启动从「3 列表 RPC + roots×9 引擎 + 读头 chunk 长链」变 1 RTT;
  headCache 落桌面进程,**跨手机浏览器重启存活**。
- **代价**:磁盘扫描是 cli-* 插件知识,聚合层归属要过架构铁则
  (候选:welcome/workspace feature 插件贡献,或 web-access Rust 侧经
  cli-shared 纯函数——两案都要 spec 取舍);桌面侧要维护快照新鲜度。
- **判断**:P1+P2 落地后外网痛点剩余主要在冷启动;若冷启动频次低(手机 app
  常驻后台),P3 性价比存疑,**建议 P1/P2 上线后实测再决定**。

### 明确不做

- collect 清单增量化(dirWatch 推送):FileStamp ~100B/条,数据量不是瓶颈,
  RTT 才是;P2 事件化已覆盖重查触发问题。为省 50KB/轮上 Rust notify watcher
  复杂度不值。
- pollHomeWatch 全并发:2026-10-04 实测齐发挤爆中继出站队列(桌面掐流),
  串行是刻意削峰;P2 事件化后此轮询本身降频,无需冒险。

## 验证

- P1:桩目检(route 切换后 network 面板 RPC 频率断言)+ 单测(节流判定纯函数);
- P2:Rust 侧 emit 单测 + 桩目检事件驱动重拉;
- 外网实测:真机 4G 网络冷启动/稳态/详情页打字三场景计时对比。
