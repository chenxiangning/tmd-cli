# 0.3.1 发布收口与下阶段规划

- 日期:2026-10-06
- 状态:进行中(11 笔提交待推送,发布动作待执行)

## 现状

Tmd-0.3.1 分支 11 笔未推送提交,工作树干净,全门禁绿(vitest 471/3705、cargo 350、clippy、fmt、arch、file-size、i18n、build、react-doctor 100)。构成:

- 0.3.1 打磨批 4 笔:新建文件意图排队 / 手机 ask 事件化 / checkpoints flock / 活转录增量尾读
- 手机外网三件套 7 笔:hello lan 自愈 / quota_vendor_fetch 白名单通道 / 凭证收敛+撤销断写口 / 三级磁盘缓存 / 状态条+读取器下放 / 额度已用口径 / 二轮评审文档

## 第 1 位:发布收口(代码侧,无外部依赖)

1. push Tmd-0.3.1 → CI 绿。
2. 版本号六处同步 bump 0.3.1(含 plist 双源)+ CHANGELOG 归档 0.3.1 段。
3. `pnpm tauri:dev` 真窗口全量冒烟(上轮桩目检后的例行复核)。
4. tag v0.3.1 + GitHub Release(便携版产物矩阵照 0.3.0 流程)。

## 第 2 位:真机验收批(需要大仙手机,一次 session 清完)

0.3.0/0.3.1 代码验证充分、真机零实测的清单:

- 安卓四项:选图 / 拍照 / 扫码配对 / WS 心跳(安卓壳 iOS 对齐批遗留)。
- 重配一台安卓机:设备名 + 平台徽标(platform 全链最后一跳)。
- 外网三件套:LAN 自愈(桌面换地址后手机自动收敛)/ 缓存回显(列表/详情/时间线首屏瞬时)/ 状态条(模型 chip 点击切模型、额度 chip 刷新、5h/7d 已用百分比口径)。
- 外网读头回归 + PinnedSessions 置顶行。
- 大转录(8MB+)结构化视图滚动跟手度(增量尾读批)。
- 双开实例下 checkpoint 操作(flock 批)。
- 装机链路:0.3.1 dmg 首开 Gatekeeper 行为 + updater 冒烟。

## 第 3 位:决策批(卡分发与增长,非代码)

1. macOS 开发者账号($99/年)拍板 → secrets 落地启用签名/公证管道(openspec/changes/2026-09-26-signing-pipeline 就绪),消除首开手动放行;同账号解锁手机推送(APNs)二期。
2. Windows 证书路线:OV/EV 采购 vs Azure Trusted Signing。
3. Glama MCP 源:接 key 还是摘除。

## 第 4 位:留观池(带触发条件,不主动开工)

| 项 | 触发条件 |
|---|---|
| grok 扫描波 mtime 闸(headCache 同池) | grok 会话多的工作区外网流量被抱怨 |
| quota 迟到覆盖 seq 守卫 | 模型切换窗口期额度闪烁被注意到 |
| OkHttp 自管 ping 线程 | 安卓外网在途发送误拆线复现 |
| 时间线 mtime TTL(重复拉 2MB) | 外网时间线慢被抱怨 |
| quota_env_value 后缀通配制枚举 | 安全收紧轮 |
| sqlite 设备域 RW→RO 打开 | 同上 |
| STATUS_READERS/QUOTA_FETCHERS 对齐守护 | 下次动映射表 |
| timelineSheet pull 版本号 | 会话切换竞态复现 |
| ws_ticks 每帧 serde / 直连无 pong 死线 | 2026-10-05 评审弃修,理由存档 |

## 第 5 位:0.3.2 功能池(独立排期维持)

平板双栏 / 手机 home 全文检索 / 审批问卷代发 / provider channels 与 MCP 写回扩家 —— 维持 0.3.1 计划时的「明确不做」,按用户需求热度再启。
