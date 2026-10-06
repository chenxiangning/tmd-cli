# 0.3.1 后下阶段规划(体验打磨主线)

- 日期:2026-10-06(二轮重梳:大仙拍板「继续打磨现有功能点」;当日 A/B/D 三批落地)
- 状态:A/B/D 已完成(5 笔提交);C 待大仙痛点输入

## 打磨池落地记录(2026-10-06)

### A 桌面性能收尾:git 多仓批量 status —— 已落地

- `git_status_batch`(Rust `thread::scope` 逐仓一线程并行,失败仓整行省略对齐旧 allSettled fulfilled-only 语义)+ ipc 通道 + 权限登记 `ipc.git`。
- `gitDecorate.tsx` 多仓分支换批量数据源(N 次 invoke → 1 次往返);单仓路径零改动(回归红线)。
- 嵌套仓 ignore 并入:`useIgnoredPrefixes` hook(单仓 root / 多仓逐仓按各仓根拼接),WorkspaceFileBrowser 消费。
- 验证:cargo 集成测试(非仓省略/master/a.txt)+ 1421 桩目检 12 仓(repos_scan → batch → f*.txt 行 modified 色落地)。

### B 一致性细节档 —— 已落地

- i18n 死键清理:882 告警全量人工核对——删真死键 12 项(旧文案/前缀残留),动态可达 21 项逐条证据保留(面板切换模板/relativeTime 单位拼接/跨行文案拼接);重复键「思考 {level}」归一 misc。
- `SearchPanel` İ(U+0130)类 lower 变长字符切片错位:长度相等走 indexOf 快路径,变长回退 RegExp 原文索引(索引恒准),`splitHits.ts` 拆纯函数模块 + 4 例边界测试。
- 终端 webgl(上游阻塞)维持列观;LSP 安装进度流按 ponytail 跳过——阶段文案已有(下载 xxx 约 100MB)+ 失败可见可重点,字节级进度要新 IPC 面,价值/改动比不划算。

### C 重度模块精化:daily-journal / intent-canvas —— 待痛点输入

- daily-journal:`SCAN_TTL_MS` 只在 effect 实跑时咨询(60s 非保证上界)。
- intent-canvas:索引/文档两步写非事务 + 超限剥缩略图 O(n²)。
- 方向由大仙实际不爽处定,不盲改。

### D 低风险竞态清账 —— 已落地

- StatusBar 状态/额度拉取 seq 守卫(同会话 model 切换窗口的迟到覆盖,同类 sibling 一起修)。
- timelineSheet pull 版本号守卫(会话切换旧扫描 partial/then/catch 全作废)。
- MobileApp 轮询 tick 端点签名比对(换桌面连接同桥不断线场景立即重拉,旧快照窗口收敛到一拍)。
- 其余留观(grok mtime 闸/OkHttp ping/时间线 TTL/env 枚举/sqlite RO/STATUS_READERS 守护/ws_ticks)维持触发条件不动。

## 辅线(维持待命,不阻塞打磨)

1. 发布收口:push 17 笔 → CI → 版本 bump + CHANGELOG → tag/Release。
2. 真机验收 9 项清单(安卓四项/徽标/外网三件套/读头/大转录/双实例/updater)。
3. 三决策:macOS 签名 secrets / Windows 证书路线 / Glama MCP 去留。
4. 0.3.2 功能池(平板双栏/全文检索/审批代发/MCP 写回)独立排期不动。
