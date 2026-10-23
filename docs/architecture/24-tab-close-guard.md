# 24 · 编辑器 tab 关闭闸契约

- 状态:已落地(2026-10-13,0.3.7)
- 上游:`docs/review/2026-10-12-workbench-polish-survey.md`(遗留 1:内核 dirty tab 关闭确认契约)、`docs/review/2026-10-13-workbench-0.3.7-ux-polish.md`(处置段)
- 相关:`docs/architecture/08-session-lifecycle.md`(会话 tab 与编辑 tab 双轨)、`docs/architecture/23-workbench-focus.md`(journal 子域)

## 背景与目标

`EditorTab.dirty` 自文件编辑器时代就是 kernel 字段(编辑侧经 `updateTab` 维护,tab 条渲染脏圆点),但**关闭路径没有任何闸**:`closeTab` / `closeOtherTabs` / `closeAllTabs` 一律同步直删。后果是 journal 每日文章 tab 的便签草稿在「关页签 / ⌘W / 关其他 / 关全部」四路都能被静默丢弃——`keepAlive` 只保「切走不卸载」,不保「关闭」。

目标:给用户手势关闭路径补一个**跨插件、可注册**的关闭前闸,且不改变任何未注册插件的现有行为。

## 方案取舍

### 选定:分层——同步删除面 + 用户手势协调器 + kind 级 beforeClose

| 层 | 位置 | 职责 |
|---|---|---|
| 同步删除面 | `src/kernel/tabs.ts` 的 `closeTab` / `closeOtherTabs` / `closeAllTabs` | 程序性删除(文件已删收 tab、面板 toggle 收起、测试装配)。**不过闸、保持同步** |
| 用户手势协调器 | `src/kernel/tabClose.ts` 的 `requestCloseTab` / `requestCloseOtherTabs` / `requestCloseAllTabs` | 问闸 → 放行才落同步删除面 |
| 闸注册面 | `TabContentContribution.beforeClose?(tab)` | 插件随 tab 内容贡献一并声明,复用既有 activate / 撤销链 |

消费方(关闭手势):`EditorTabStrip`(× 钮、右键菜单三项)与 `shortcutCommands`(`shell.closeTab` / ⌘W)改走 `request*`;`files/useTreeOperations.ts`(删除文件后收 tab)与 `memory-coordinator/consoleTab.ts`(面板 toggle)保留 `closeTab` 直删面。

注册方(闸实现):`journal`(daily-article,keepAlive,闸随 tab 本体渲染)+ `files`(file: 本地文档)与 `ssh`(ssh-file 远端文件)(2026-10-13 补入,均非 keepAlive,闸走 kernel `askDialog` 命令式确认)。

协调器纪律:

1. **缺省放行**——未注册 `beforeClose` 的 kind 行为零变化。
2. **抛错按不放行**——静默丢稿不可逆,保留 tab 可重试;异常经 `console.warn` 落痕。
3. **在途去重**——同 tab 的在途确认共享一个 Promise,连点 ×/⌘W 不叠弹窗。
4. **陈旧确认不删新实例**——确认期间该 id 被关掉又重开(引用已换)时,旧确认作废。
5. **批量逐个过闸**——拒绝/异常者留下,既不因一个 dirty tab 卡住整批,也不因整批放行漏问。

### 被否决方案

- **把闸塞进 `closeTab` 本体**:需改 async,污染全部程序性调用方(文件删除收 tab 时问「要不要丢稿」没有意义),且让 kernel 的删除面语义分裂。否决。
- **闸放 tab 组件内(在组件里拦关闭)**:组件拿不到关闭手势,只能靠卸载期副作用反悔,无法「保留 tab」。否决。
- **只给 journal 特判 kind 字符串分支**:kernel 出现单插件语义,违「单插件语义不入 kernel」。否决。
- **闸挂在 JournalTab 内**:关文章 tab 时「工作日志」页签可能并未打开(文章 tab 可由 docgen 深链打开),宿主不在场 = 闸失效。否决。
- **闸挂在常驻 `overlay` 挂点**:比上一版稳(宿主恒挂),但闸的可用性仍取决于**另一个组件**的挂载时机,而不是「那个 tab 自己在挂」——真机实测即命中:关文章 tab 无二次确认(宿主未就位时 `askArticleDiscard` 静默放行 = 丢稿无提示)。否决;改为**闸随文章 tab 本体渲染、按 tab id 注册**(见下)。
- **文件 tab 也用「闸随 tab 渲染」**:文件 tab 非 keepAlive,切走即卸载,「脏 tab 未激活」时组件不在挂,闸必缺席(与被否决的 overlay 版同型缺陷)。否决;files/ssh 走 kernel `askDialog` 命令式确认——可用性只取决于模块已加载,与任何组件的挂载时机无关。

## 落地要点

- kernel 侧:`TabContentContribution.beforeClose` + `getTabCloseGuard(kind)` + `getTab(id)`(实例同一性判据);协调器独立成模块守 300 行铁则;命令式确认原语 `askDialog`(`ConfirmDialog` 的 promise 化形态,自带临时 React root 问完即拆)供闸体无法随 tab 常驻的插件用。
- 外壳侧:`EditorTabStrip` 与 `shortcutCommands` 换 `request*`;`shell.closeTab` 的键位/when 语义不变。
- journal 侧:文章 tab 贡献声明 `beforeClose: (tab) => (tab.dirty ? askArticleDiscard(tab.id) : true)`;脏态在变更回调里**同步**镜像进 `updateTab`(不等 effect 落地,否则「刚敲完就 ⌘W」会漏拦)。
- 确认闸 `ArticleDiscardGate` **由 `ArticleTab` 自己渲染**:挂载期经 `installArticleDiscardGate(tabId, gate)` 按 tab id 注册,卸载摘除 —— tab 在挂 = 闸在,不依赖任何外部挂点(overlay / 工作日志页签)的挂载时机。keepAlive 保证切走的 tab 仍常驻挂载,且闸在 `closeTab` 之前结算:问话时组件必然在挂,不存在「宿主不在场」的窗口。
- 开路径(`openArticleTab` 重开带草稿空日)用同一张闸,按目标 tab id 问;闸对重入与卸载都做结算兜底,不留悬挂 Promise。
- files 侧(2026-10-13 补):`file:` tab 贡献声明 `beforeClose: fileBeforeClose` —— 判据同脏圆点(useFileDocument 镜像);闸体 `askDialog` 命令式(文件 tab 非 keepAlive,切走即卸载,闸随组件渲染必缺席);**「丢弃」必须 `draftDelete`** —— 草稿在内存缓存,只关 tab 不删草稿则重开原地复活,弹窗说「将丢失」就得真丢。
- ssh 侧(2026-10-13 补):`ssh-file` tab 同型接入;远端编辑没有本地草稿缓存,静默关闭即真丢稿,闸体同 `askDialog`,确认丢弃无需清草稿(0.4.0 起确认丢弃还须清 localStorage 镜像,见下)。

## 退出模式与草稿镜像(2026-10-19,0.4.0 项 12)

关 tab 有闸(上节),关窗是另一条静默丢稿路径,双腿补齐(关窗闸落地;⌘Q 走同一关窗链,见下):

- **退出模式**:`requestCloseAllTabs({ quit: true })` —— 关窗聚合裁决后的**强制放行通道**:绕各 kind 闸(闸只服务单 tab 手势,退出已整体裁决),先 `cancelAllAsks` 按不放行结清在途命令式问话(askDialog 不随 tab 卸载自愈,留着会挂住退出),再等全部在途闸 Promise 结算落地才返回(**结算等待**,设计点④:悬挂 promise 不得带出退出)。旧调用 `requestCloseAllTabs()` 语义零变化。
- **关窗闸(单腿)**:`kernel/quitGuard.tsx` 在 app-shell boot 挂载,订阅 onCloseRequested(ipc.ts 原语,**同步决断**:调 prevent 才拦,不调走原生销毁 —— 不做「全拦再补发」,防脏空场景 windowClose 重入死循环):有脏先 `draftMirrorFlushAll` 同帧补写镜像,再弹聚合确认(一次问清,不串行逐个问);确认 → 退出模式强关 tab → `windowDestroy()`(绕闸直毁,不再过第二遍);取消 → 什么都不做。「本次不再问」是**内存标志**(本次运行有效,不持久;重启恢复询问,跨强退安全网不撤)。
- **⌘Q 收口(0.4.4,2026-10-23)**:`ExitRequested` 无挂点这条 2026-10-19 的裁决仍成立(tauri-runtime-wry 2.12.1 的 `code:None` 只来自最后窗 Destroyed,拦它 = 无窗僵尸;tao 0.37.1 无 applicationShouldTerminate)。落地面两条:**① macOS 应用菜单自定义 Quit 项**(accel `CmdOrControl+Q`,无默认退出行为)点击后**只做关窗**(`window.close()`),因此 ⌘Q 与红 X / 系统关窗汇成同一条 `CloseRequested` 链,关窗闸是唯一裁决点,前端缺席(重载/崩溃自愈中)时仍由壳侧原生销毁兜底。**② 0.4.1 的事件腿已拆**:旧形态 Rust 发 `tmd://menu-quit` → 前端再补发关闭,多绕两跳且 webview 接不住就是哑键,`onMenuQuitRequested` 随之下线。
- **能力面铁律(本次真因,踩过)**:挂上 `onCloseRequested` 之后,壳侧对**每一次**关窗请求都 `prevent_close()` 并转投前端(`tauri/src/manager/window.rs`),而 `@tauri-apps/api` 的包装在「未 preventDefault」时用 `window.destroy()` 真正关窗 —— 故 capability 必须显式给 `core:window:allow-destroy`(`core:window:default` 不含,`allow-close` 也不覆盖)。0.4.0–0.4.3 三个版本缺这条,红 X 与 ⌘Q 全部静默哑火(destroy 被 ACL 拒绝,无人报错、窗口不动)。新增/复核关窗类能力时先查这条。
- **草稿镜像**:`kernel/draftMirror.ts` 把三类随进程蒸发的内存草稿(file 内存 Map / journal 便签组件态 / ssh-file 无缓存)防抖 300ms 镜像进 localStorage(键 `tmd.draftMirror.<slot>`,slot:`file:<path>` / `journal-note:<ymd>` / `ssh-file:<path>`;TTL 7 天台账 mobile useDraft 先例;单条 256KB 截断;try/catch 静默)。**镜像与闸的分工**:闸管「问」,镜像管「真关了也能找回来」—— 闸确认丢弃 = 连镜像一起清(与 draftDelete 同点);退出强关**不清镜像**(崩溃网不撤,重开走恢复条 `DraftMirrorBar`:恢复回填置脏 / 丢弃清镜像)。覆盖边界:journal 镜像**仅便签文本** —— 贴图在粘贴时已落 assets/,「未保存的图片引用」不跨崩溃恢复;ssh 槽按路径(未掺 sessionId),跨主机同路径理论串槽由 TTL 自愈。

## 验证

- 契约测试 `src/kernel/tabClose.test.ts`(12 例):缺省放行 / 放行 / 拒绝 / 抛错保留 / 在途去重 / 陈旧实例不删 / 批量逐个过闸 / 空 id。
- 闸注册面测试 `src/plugins/workbench/journal/journalTabs.test.ts`(6 例):无闸放行 / 装闸生效 / 按 id 路由不串扰 / 摘除幂等 / 旧实例的摘除不误摘新闸 / 开路径闸拒绝则不重开 —— 锁住「闸的可用性只取决于该 tab 自己在挂」这条契约(本次缺陷回归)。
- 命令式确认测试 `src/kernel/askDialog.test.tsx`(4 例):确认 true / 取消 false / 首答即决且 unmount 恰一次 / 无 document 环境不抛错。
- files 闸测试 `src/plugins/files/fileCloseGuard.test.ts`(3 例):不脏放行不问 / 脏+丢弃删草稿放行 / 脏+取消草稿原样。
- 外壳命令测试 `src/app-shell/shortcutCommands.test.ts`:⌘W 与 `shell.closeTab` 断言改指 `requestCloseTab`。
- journal 侧既有测试全绿(`src/plugins/workbench/journal/` 21 文件 167 例)。
- 门禁:`pnpm check:gate` 全链绿;`react-doctor` 100。
- 真机目检(留大仙):文章 tab 敲入草稿(页签出现脏圆点)→ ⌘W / × / 右键关其他 / 关全部,四路均先弹「未保存的修改」;选「取消」tab 保留且脏圆点仍在;「工作日志」页签关掉后再关那个带草稿的文章 tab,同样弹确认(闸随 tab 本体,不依赖工作日志页签在场)。文件 tab 同表:编辑文档出脏圆点(不必保持激活,切走再关也拦)→ 四路先弹「未保存的修改」,「丢弃」后重开同文件草稿不复活,「取消」草稿与脏圆点俱在;远端文件编辑后关闭同弹。
- 关窗闸回归(0.4.0 项 12;两条必测):① 红 X **与 ⌘Q/菜单「退出 tmd-cli」** 三路同表——有脏弹聚合确认、确认后窗口关闭且**进程退出**(防关窗闸退化成僵尸窗);无脏直接关、进程照常退出;取消则窗口与脏圆点原样;② ⌘W 单关各 kind 闸行为零变化(不接新参数、语义不漂移)。
- 能力面回归(0.4.4):`capabilities/default.json` 必须含 `core:window:allow-destroy`;删掉它重跑,红 X 与 ⌘Q 会双双静默哑火(无报错、窗口不动)—— 这是「ACL 缺失表现为无响应而不是报错」的取证样本。
- 崩溃恢复目检:编辑文件出草稿 → 强杀进程 → 重开同文件顶部出恢复黄条,「恢复」回填置脏 / 「丢弃」清镜像不再弹;⌘Q 与红 X 同律(有脏先确认,确认即退,内存草稿丢但镜像兜底可恢复)。
