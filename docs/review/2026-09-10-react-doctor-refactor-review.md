# 2026-09-10 react-doctor 治理链 + dsh 0.1.2 适配评审

日期:2026-09-10
状态:已落地(本日审完即修;P1/P2 全部修复完成,验证全绿;P3 共 7 项
记入文末缓修,不在本链责任面或属历史遗留)

## 背景与目标

今日提交以「react-doctor 治理 45→100 分」为主线,另有 dsh 0.1.2 协议适配。
评审范围聚焦四项:
1. 性能:大组件拆件后是否引入新的热路径重渲染;
2. 兼容性:React 19 合规、IPC/Tauri/PTY/幕布契约、settings 键与 CSS 类名、
   CLI 磁盘格式兼容性;
3. 架构:R1/R3/R4、300 行铁则、插件经 `activate(ctx)` 注册、cli-shared 准入;
4. 项目文档与代码是否漂移(以代码为基准)。

基线:226 文件 +7957/-5043(react-doctor 链 d49e93c^..e043aee),
dsh d5bc0a0 单独 +1054/-603。

## 发现清单

### 已修 —— A. P1 真回归(三处)

| 问题 | 方案 | 理由 |
|---|---|---|
| `cb9467f` 把 PinToggle 改为真 `<button>`,hover/focus 显形 CSS 重 scope 到 `.thread-row-host`,但只迁移了一个调用方 `DiskSessionRow`(`src/plugins/workspace/SessionRows.tsx:130`)。`LiveSessionRow`(L77)、`RunningZone`(L240)、`PinnedSessions`(L255)三处仍把 PinToggle 嵌在行按钮 `<button class=thread-row>` 内 —— ① button 嵌 button 触发 React 19 `validateDOMNesting` 错误;② 显形选择器吃不到,**RunningZone 全部行的置顶按钮均不可达**(on 恒 false,非归档行置顶功能整个回归;链前可 hover 显形);**LiveSessionRow 行内置顶入口亦不可达**;PinnedSessions 仅因 `is-on` 常亮幸存。`bfd4232` 只回撤 WorkspaceCard 菜单化,漏掉 PinToggle 收尾 | 三处行结构迁移:`<span className="thread-row-host" key=…><button …>行内容</button><PinToggle …/></span>`,照抄 DiskSessionRow 范本。`is-renaming` 分支无 PinToggle 不动 | 行 host 升 span + button + PinToggle 三段 DOM 兄弟,显形选择器吃得到 host,功能恢复,行为保持 |
| `sampleAnchors.ts:15-17` 从 `AnchorRail.tsx` 抽出时两个常量被静默改动:`ROW_PX 13→26`、`MISS_FLASH_MS 1200→600`,配套 CSS `composer-anchors.css`(`gap:3px` + `.composer-anchor-item height:10px` + 动画 1.2s)本链未动 —— ① `maxVisible = floor(rail.clientHeight / ROW_PX)` 用 26 直接使可视容量减半,锚点栏可见 dash 数比改前少一半;② 600ms 截断 1.2s CSS 动画(`0%→60% opacity:0.25→100% 1`),JS 在 60% 关键帧处移除类,未命中反馈从「暗→亮闪回」变骤然消失 | `ROW_PX` 回 `13`、`MISS_FLASH_MS` 回 `1200`,注释同步指回 CSS 契约(gap:3px / animation 1.2s) | 重构承诺「行为保持」被打破,以 CSS 契约为准回常量为唯一可信选择 |
| `src-tauri/src/git/status.rs` 308 行,触发 300 行铁则 CI 违规;由 `1841f8c`(无 upstream ahead 降级)追加 ahead/behind 家族(+86 行)顶破 300。CI workflow 第 25 行 `pnpm check:file-size` 必红 | 拆 `ahead_behind` 家族(`AheadBehind` 结构体 + `ahead_behind` + `head_unique_vs_remotes` + `upstream_name` 仍被 `compute` 用留在 status.rs + 该家族测试)到新模块 `src-tauri/src/git/ahead.rs`(~135 行);status.rs 留 188 行;`mod.rs` 改 `pub use`;`commands.rs` 走 `super::` 名字不变零改动 | ahead/behind 本就是文件头声明的「独立低频命令」,拆件契合模块自述;调用点全部经 mod.rs re-export 名字不变,R3 合规 |

### 已修 —— B. P2 真问题(两处 UA 中和)

| 问题 | 方案 | 理由 |
|---|---|---|
| `PluginMarketPage.tsx:204` 自制 `<aside role=dialog>` 换原生 `<dialog open>` 时漏中和 `color: canvastext`,`.pm-ext-panel`(`plugin-market.css:225`)及其内容在深色主题下渲染黑字。同类替换 `VersionPopover` 全套 color 干净,pm-ext-panel 漏 color | `.pm-ext-panel` 加 `color: inherit;`,注释自证「替换为原生 dialog 后,UA 给 dialog 的 color:canvastext 默认生效;不显式中和会顶替深色主题下市场内容靠继承取色的文字」 | 跟 VersionPopover 对齐,深色主题全市场面板文字恢复主题色 |
| `NamePrompt.tsx:64` 自制背板 div 换 `<dialog open>` 漏中和 UA 对非顶层 dialog 的 `max-width: calc(100% - 6px - 2em)` / `max-height` 钳制,`.nprompt-backdrop` 全屏背板被钳到视口减约 19px(uiFontSize 16 时),右/下边缘出现未变暗条带。同链 `GitDialogShell` 明确加了 `max-h-none` | dialog className 补 `max-w-none max-h-none` | UA 钳制打破视觉契约,补法与 GitDialogShell 同款 |
| `dsh-adapter.cjs:197` `spawnHostAndWait` 把子进程 stdio 从 `"ignore"` 改 `[ignore,pipe,pipe]` 抓 launch token,但 stderr 管道无任何读者 —— dsh 子进程 verbose 日志/panic 写满 ~64KB 管道后阻塞假死,适配器 20s 后误报「host 拉起超时(未见 launch token)」并遗留僵尸 host | `hostChild.stderr.resume();` 一行排空,日志由 launch token 主链 stdout 兜底 | 改 stdio 是必要代价但漏消费者是回归,补 consumer 即可 |

### 已修 —— C. 文档漂移

`docs/architecture/02-code-architecture.md` 5.2 dsh 块描述的是被本提交废弃的旧协议
(方法面点号 `session.{list,prompt,cancel,selectModel,history,models}` + 单流
`/api/events.mux` + 帧 `{seq,sessionId,stream,data}`),而代码已是
斜杠方法面(`session/list`/`session/create`/`session/cancel`/`session/modelCatalog`/
`session/follow`/`agentPresets/select`/`commands/execute`/`settings/describe`/
`settings/set`) + `/api/remote.mux` 双流(open/item 帧)。同提交内文档与实现直接矛盾。

按代码实测重写 5.2 整块:删除 host.describe / session.history / session.models /
session.new(history 与 models 由 session/list `items[].projections` 提供)、
mux 双流(subscription `$events` 流承担审批/提问卡 askWatch 标记)、
显式标注「0.1.2 起取消 0.1.1 的 /api/events.mux 单流形态」。
同步在 02 末「9. 设计原则 ↔ 代码落点对照」追加一行「组件治理(react-doctor 0.9.13)」,
沉淀四道约束:`only-export-components`、嵌套交互治理、渲染期 ref 写移 effect、
自制 dialog 换原生 dialog 须中和 UA `color` + `max-*` 钳制。

### 缓修(P3,记入文末,本轮不动)

| 项 | 缓修理由 |
|---|---|
| `SettingsPanel/ShortcutDetail.tsx:33` Recorder 错误态切命令不复位 | 拆件引入的派生 shownError 形态;切走又切回且未重录路径可复现旧文案;一行 Recorder 加 `key={cmd.id}` 修复,属独立 P3,本轮不在反应链主面 |
| `cli-omp/marketInstalledRow.tsx:184` toggleEnabled 裸奔 promise 无 catch | 仅 console 噪声;控制流 finally 已复位,不动 |
| `cli-shared/qoderSuggestions.ts:20` cn 分发版硬编码扫 `~/.qoder` | 文件头注释声明「cn 侧无独立实证」;该事项归属 qoder 双插件专题,不动 |
| `cli-shared/mdCommands.ts:45-49` SKILL.md 命令目录派生 `<dir>:SKILL` 违反同文件注释契约 | `blame` 显示 09-04 已存在,非本链引入;但被拆件动过的 `isCommandDir` 字段相邻行顺手核对了下,确认非本链回归;属独立 P2 隐患,留独立修 |
| `welcome/credentials.ts:140` listPiCredentials apiKey 非串真值时 `.key` 回退微变 | 仅畸形 pi auth.json 数据可见,正常数据零影响;INFERENCE |
| `cli-config/FieldControls.tsx:68` modelMap 字段 catalog 被 FieldRow 与 ModelMapInput 重复取一次 | 影响小(effect 依赖稳定);独立 P3 |
| `cli-config/marketCards.tsx`/list/find/listAnchors 等高频列表未 memo + 回调内联闭包 | 既有,本链未恶化;性能治理整体范围外 |

### 评审中验证的非回归面

由 6 个 reviewer 分片并行核完:

- **kernel 无新增插件私有知识**(terminalFindBridge 纯平移 terminal.find;
  Mounts/RenameInput/Tooltip 无新依赖);R1/R3/R4 铁律逐条核,跨层 import
  全部走 `@kernel/@shell/@plugins` 别名。
- **PTY 幕布字节透传红线未触碰**(TerminalView 44 行改动均在 panel UI 侧,
  onData/attachTerminalStream 无新增二次渲染)。
- **plugin 注册面未被绕过**(plugins/index.ts 仅 cli-dsh → cli-dsh/plugin 一行
  允许改动)。
- **cli-shared 新文件准入**:`qoderSessionModel`(claude/kimi/qoder/qoder-cn
  ≥2 消费)、`mdCommands`(claude/qoder 双消费)、`skillDirs`(claude/codex/kimi/qoder
  四消费)均达标。
- **测试文件改动核对纯 import 路径**(AnchorRail/gitDecorate/PromptImages/
  sessionManage/marketCards/qoderSessions/cliProfiles.contract 6 个 test 文件
  各 2 行 import 更新,断言零变化)。
- **react-doctor 复跑**:`npx react-doctor` 实测 100/100,710 文件零问题
  (声称分数属实)。
- **dsh 0.1.2 协议投影与契约一致**:assistant/message 整消息沉降;
  text/reasoning 块出 text/reasoning 动作;tool-call 块跳过走 tool/call 事件;
  无 assistant/chunk 消费路径;waterfall eventId 应答键 + agentId 作 sid。
- **dsh 凭据链无泄源**:cookie/launchToken 落既有键 `tmd.dsh.connection.v1`,
  全链无 cookie/token 打印;normalizeConnection origin 变更弃凭据;测试覆盖
  PTY 抓 token → quota_fetch(noRedirect+includeHeaders+text) → 303 set-cookie
  落盘,及 401 本机换代/远程拒判语义。
- **dsh WebSocket cookie 实证**(reviewer 自跑):Node v22.22.3 global WebSocket
  接受 `{headers:{cookie}}` 且 cookie 真实到达 upgrade 线(回环服务端抓到
  `dsh-auth-probe=1`)—— MUX 鉴权机制在目标运行时成立。

## 验证

修复后全量复跑,全部通过:

- `pnpm typecheck` ✅ 无错误
- `pnpm test` ✅ 176 files / 1371 passed
- `pnpm check:arch-boundary` ✅ R1/R3/R4 全过
- `pnpm check:file-size` ✅ 全绿(豁免仅 `src/kernel/ipc.ts`;新 `ahead.rs` 135 行,
  `status.rs` 188 行,均 ≤300;`pm-ext-panel` `color: inherit` 与 `sampleAnchors`
  常量回原值未触线)
- `pnpm build` ✅ built(1.97s),无新增警告
- `cd src-tauri && cargo test` ✅ 211 passed / 0 failed / 1 ignored(基线对齐)
- `cargo clippy --all-targets -- -D warnings` ✅ 无警告
- `cargo fmt --check` ✅ 无差异
- `npx react-doctor` ✅ Score 100/100,710 files, no issues

未跑 `pnpm tauri:dev` 真窗口目检(本日 UI 改动集中在 PinToggle 行结构、dialog UA
中和、composer 锚点常量回原,均不引入可见行为变化,待真机抽检)。