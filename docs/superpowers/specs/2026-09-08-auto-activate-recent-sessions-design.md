# 启动自动激活最近会话设计
- 日期:2026-09-08

## 背景与目标

痛点(用户会话实录):每次重新打开 tmd-cli,侧栏所有会话都是未激活(磁盘行)状态,点开一个要等一次 CLI 进程 spawn + 回放;希望按时间顺序把最近几天的会话自动激活,点回去秒开。

「激活」的真实语义 = `host.openDiskSession` → spawn 真实 CLI 进程(resume)+ 装配 + 回放。关键已有机制:`SessionSpawnService.open()` 开头有身份去重——磁盘会话已有活 PTY 时直接聚焦既有。因此「启动时后台预开」天然变成「点击秒开」,零新聚焦机制。

目标:新增设置「启动时自动激活最近 N 天的会话(总上限 K 个)」,开启后启动时后台预开符合条件的磁盘会话;不开 tab、不抢焦点、不亮未读灯。

## 方案取舍

选定:**A. 启动后台预开,复用 open 去重**。启动后对各 工作区×CLI 分组扫 `profile.listSessions`,取最近 N 天会话按 modifiedAt 降序排队,低并发(2)后台 `openDiskSession(activate:false)`;用户点击时命中 `open()` 已有身份去重分支直接聚焦,点击等待归零。

否决:

- **B. 只预热元数据(标题/状态预扫)**:点击等待的大头是进程 spawn + 回放,预扫元数据治标不治本。
- **C. 退出时记活会话清单、启动恢复上次活会话**:语义不同(「上次活着」≠「最近几天磁盘会话」),进程照开、范围更迷;可作后续独立增强。

范围决策(用户拍板,同日修订):**每组配额**——每 工作区×CLI 组按时间序取最近窗口内最新 perGroup 条(每组的「第一条」必中),全局再按时间降序截总硬上限;设置暴露 天数/每组条数/总上限 三个值,默认 1 天 / 每组 1 条 / 总 16 个,天数 0 = 关闭。(初版为全局 top-N,实测会漏掉多工作区/多 CLI 下某组的第一条,违背「点第一条必秒开」预期,改为每组保底。)

## 设计

### 设置

- `AppSettings.autoActivateSessions: { days: number; perGroup: number; max: number }`,默认 `{ days: 1, perGroup: 1, max: 16 }`。
- sanitize(先例 `sessionListBudget`):days 0-30 / perGroup 1-8 / max 1-32,逐字段越界回落默认(互不连坐)。
- UI:设置 → 基础设置 → 行为 tab,一张 pref-card 三个数字输入(blur/Enter 提交,先例缓冲上限输入),days=0 时后两行隐藏,零新增 CSS。

### 触发点与就绪

- `main.tsx` 的 `activateAll().then()` 里挂 `bootAutoActivate(host)`(内核 boot 模块先例:bootSessionTabs/bootIconDecor)。
- 等 `workspacesReady`(kernel/workspace.ts 新增导出 Promise,先例 `settingsReady`)再开跑,不与首屏/插件激活竞争。
- 幂等:模块级 once 闸,StrictMode 双调用不重复(先例 PluginLifecycle.activation)。

### 收集与截断(kernel/autoActivate.ts)

- 候选源:每 workspace × 每 profile,**必须同时声明 `listSessions` 与 `resumeArgs`**——缺 resumeArgs 的 profile 跳过,否则 `open()` 会退化为 `profile.args` 开全新会话,违背「恢复」语义。
- 过滤:`modifiedAt >= Date.now() - days * 86400_000`;**组内**按 modifiedAt 降序取 `perGroup` 条后入池,全局再按 modifiedAt 降序截到 `max` 条。
- 跳过 `singleInstance` profile(dsh「会话即 host」,自动拉起归它自己的 autoStart 链路管)。

### 打开加载进度(kernel/terminalReplay.ts,同日落地)

- 点开任何会话必显真实进度遮罩:有输出缓冲 → 分块回放,进度 = 已解析块/总块;无缓冲或回放尽 → 流式阶段,进度 = 已接收字符数(条按相对输出缓冲上限占比),输出静默 0.5s 判就绪撤罩,12s 兜底。
- 保序:回放未竟时实时字节攒队列,回放尽后按序补写;输入闸语义不变(回放窗口丢弃历史查询应答)。

### 退出清场(Rust,同日落地)

- 自动激活每代新增若干 resume 子进程,而应用退出原本不杀 PTY 子进程 → 孤儿常驻累积(实测两代 13 个)。`PtyRegistry::kill_all` + `RunEvent::Exit` 钩子,退出即清场;webview 重载不触发,会话跨重载存活语义不变。

### 执行

- `SessionSpawnService.open()` / `host.openDiskSession` 增加 `opts?: { activate?: boolean; silent?: boolean }`:
  - `activate:false` 透传 `adoptSpawned`(该参数本已存在,dsh `spawnRawSession` 后台先例):不广播 `activeSessionChanged` → 不开 tab、不抢焦点;回放不亮灯(activityWatch 首写闸已有)。
  - `silent:true` 抑制 `spawn()` 失败路径的 `sessionStartFailed` 广播(防启动 toast 风暴),失败仅 `console.warn` 跳过该条。
- 并发 2 错峰执行;队列中某条失败不影响后续。
- 每组扫描带 8s 超时闸(桩目检实证补强):dsh 等 host-RPC 型 `listSessions` 会等本地 host 就绪(数十秒),不设闸会把整批收集拖死;超时按空组计。

### 测试

- settings sanitize 单测(先例 settings.test.ts 的 sessionListBudget 用例):非法 days/max/缺字段回落默认。
- 收集纯函数单测:窗口过滤、降序排序、max 截断、缺 resumeArgs/singleInstance 跳过。
- `open(activate:false)` 契约测试:不广播 `activeSessionChanged`、活表含新会话、`silent` 失败不广播 `sessionStartFailed`。

### 验证

- `pnpm typecheck && pnpm test && pnpm check:arch-boundary && pnpm check:file-size && pnpm build`。
- 浏览器桩目检(1421):行为页开 2 天 → 重载 → 侧栏活会话区出现预激活行,点击秒聚焦、不开重复 tab。
