# 近半个月发布内容梳理与打磨审计(v0.1.9..v0.2.7,双端)

- 日期:2026-10-01
- 状态:已完成(全部发现已实施,处置与偏差见同日 spec 实施注记;未提交)
- 范围:v0.1.9..v0.2.7(2026-09-16..10-01,9 版 576 提交),桌面 + 手机双端;已排除前轮 `docs/research/ui-polish-0.2.5-to-0.2.7.md` 已实施的 65 项(w/d/s/m 系列),本文只记增量
- 方法:CHANGELOG / FEATURES / git log 发布面梳理 + 5 路代码级只读审计(手机全树 / 0.2.4 功能批 / 0.2.5 hub 批 / 0.1.9..0.2.2 功能批 / 0.2.6..0.2.7 残差与引擎矩阵);引用行号均经核实,4 项待真机实证已标注
- 性质:能力调研(demo 级功能识别 + 打磨点全量清点),零代码改动

## 结论先行

1. 半个月 9 版 40+ 新功能面,骨架质量高:失败路径、持久化、竞态守卫的处理密度远超 demo 标准,proposal 一致度 9/10。真正的 demo 味集中在两处——**手机端 UI 消费层**(通知链路、错误伪装空态、能力覆盖缺口)与**「能力门宽于实际能力」的跨引擎长尾**(入口能点进去才失败)。
2. 分级判定:重度 demo 2 项(手机本地通知链路、手机 i18n),中度 12 项,轻度 14 项,其余已达产品级。P0 缺陷 3 项(手机 git checkout 真机死钮、手机通知组合失效、审批高危红标右栏缺位)。
3. 逐点修不如立机制:五个系统性模式(失败伪装空 / 能力门过宽 / i18n 半途 / 形制漂移 / 引擎覆盖长尾)各需一个统一解,写入打磨方案的「统一机制」。

## 一、发布内容梳理(都有什么)

| 版本 | 日期 | 主题 | 主要新增面 |
|---|---|---|---|
| v0.1.9 | 09-18 | 看板与远程底座 | 会话看板(热力月历+泳道五态)、Web 访问桥 M1/M2(LAN+外网中继+风险门)、omp 版本回退、Git 双栏 diff 三轮打磨 |
| v0.2.0 | 09-19 | 编辑与标记 | LSP 语义跳转(TS/JS/Py/Java 四语言)、文件标记 marks(行间锚点+芯片条 staging)、全文搜索+文件快开、会话卫生清扫、md 预览提速、Git 远端操作明细 |
| v0.2.1 | 09-20 | 文件入口 | 打开方式(open-with)、侧栏文件浏览器、md 目录对齐 |
| v0.2.2 | 09-20 | 收口批 | composer 发送收口、原子写簇、搜索完整性、git 打磨、会话生命十项(以修复为主) |
| v0.2.3 | 09-25 | 手机 App | 手机 App(iOS/Android):配对/设备管理/home 列表/会话屏 transcript+VT 实况/审批线/git 面板复刻;外网中继二程(443 TLS+钉住+自建部署);审批收件箱(桌面);图标装饰 12 键 |
| v0.2.4 | 09-26 | 效率批 | CLI 学堂、会话历史全文检索、跨引擎一键接力、系统通知与额度预警、Worktree 编排、发送二次确认、退出 toast 续聊、审批高危红标、用量徽标 |
| v0.2.5 | 09-30 | 能力 hub | 意图画布(Excalidraw+AI 作画)、skill-hub、mcp-hub、审批收件箱 omp ask 问卷卡、会话查看器、图标装饰 34 键+五套组合切换、tok/s pill、异常退出跨引擎接力 |
| v0.2.6 | 09-30 | 每日日志 | 每日工作日志(日/月/年三视图+AI 文章+便签+队列+节假日)、WSL 主机表单并 SSH 簿 |
| v0.2.7 | 10-01 | 结构化会话 | 结构化会话(omp/pi RPC 流式+双视图+审批卡)、幕布右上工具行、查看器极简展示、手机 composer 加大+选图 |

功能域覆盖:会话域(看板/检索/接力/查看器/结构化/卫生)、引擎域(10 家 CLI + WSL 远程 + provider channels)、文件域(marks/搜索/快开/LSP/打开方式)、Git 域(diff 三代/worktree/PR)、远程域(web 桥/中继/手机)、能力域(skill/mcp/学堂/画布/日志/记忆)、视觉域(壁纸/图标组合/rail 签名)。

## 二、demo 级功能分级判定

判定口径:重度 = 只有 happy path 演示价值;中度 = 主径可用、关键边沿或覆盖缺口可感;轻度 = 基本完整、小毛刺;产品级 = 达到可长期依赖的完成度。

### 重度 demo(2 项)

| 功能 | 证据 | 问题 |
|---|---|---|
| 手机本地通知链路 | `src/mobile/SessionScreen.tsx:119-141`(检测仅会话屏挂载期)+ `mobile-app/native-shell/ShellBridge.swift:149-162`(iOS 未实现 willPresent) | 检测面(单屏)与呈现面(前台静默)双落空,本地通知几乎不可达——「审批浮标+通知」宣传价值仅剩屏内 AskCard;而 Rust 侧配对/撤销/节流接近产品级,投入倒挂 |
| 手机 i18n | `src/kernel/settingsDefaults.ts:22`(zh 默认)+ 手机树无语言切换入口 | en/ja 词典 92/90 键实际不可达,是死数据;配对屏/gate/gitModel/relTime 等最早写的面全裸中文 |

### 中度 demo(12 项)

| 功能 | 证据 | 缺口 |
|---|---|---|
| 手机 transcript 对话 | `src/mobile/sessionFile.ts:52`(契约仅 omp/pi/claude 三家自注)、`:18`(MAX_TURNS=40) | 3/10 引擎,其余 7 家永远只有 VT 尾流;截断无提示 |
| 手机 git 面板 | `src/mobile/GitScreen.tsx:147`(window.confirm)、`:205-207`(远端分支仅计数) | checkout 真机死钮(见 P0);缺提交/暂存/放弃/分支搜索/worktree |
| 手机审批线 | `src/mobile/CkptSheet.tsx:49`、`remote.ts:86-93` | diff 失败伪装空态;ask 检测是通用标记子集;应答只有 Enter/Esc 二元(桌面有问卷代发) |
| 手机 home 列表 | `src/mobile/history.ts:23-32` | 只搜标题(桌面有全文检索);无下拉刷新;qoder-cn/dsh 无 spawn 入口 |
| structured-session | `src/plugins/structured-session/index.tsx:49`(死入口)、`cli-shared/piRpc.ts:172-175` | 引擎门 2/10;非 confirm 部件(select/input/editor)静默自动 cancelled,用户不知被替答;输入面是裸 textarea |
| daily-journal 生成链 | `daily-journal/genSession.ts:224`(sleep 1200ms)、`:268-271`(裸 CR)、`GenSettings.tsx:50` | 6/10 引擎走 TUI 回落时序 hack,设置面零区分;dsh 语义存疑仍可选;模型栏对 5 家静默无效 |
| 系统通知(notify) | `src/kernel/ipc.ts:942-956`(无点击 action)、`notify/index.tsx:96-101` | 通知点击无聚焦/深链(离开工位闭环缺最后一环);额度只盯激活会话,平铺多幕布不预警 |
| 审批高危红标 | `checkpoints/BatchRowParts.tsx:95-150` | 红标只落中央批审阅单;右栏时间线(整批「允许」按钮所在地)无标,与 openspec「两面生效」声明不符 |
| 会话用量徽标 | `cli-shared/sessionUsage.ts:1-15`(四族行型) | 4/10 引擎;仅检索浮层可见 |
| 转录浮层 liveOverlay | `session-viewer/livePill.tsx:24` vs `liveMode.ts:41-43` | 入口能力门宽于实际尾读能力,kimi/grok/opencode/dsh 点开才见不支持 |
| Web 访问设置 UI | `web-access/WebCfPane.tsx:30`、`WebWanGate.tsx:21-23`、`WebAccessSection.tsx:46` | 引导指向不存在的「手机打开」按钮且中继无 QR;风险门取消后模态不关;桥状态 600ms 盲刷 |
| 手机横竖屏/平板 | `SessionScreen.tsx:89-105` | 横屏钮仅会话屏;CSS 兜底是整体旋转;无 iPad 双栏 |

### 轻度 demo / 残余(14 项)

| 功能 | 证据 | 缺口 |
|---|---|---|
| LSP 手势反馈 | `lsp/cmLsp.ts:158-163`、`javaGuideStore.ts:7-13` | server 失败对 cmd+click/F12 全静默;「暂不安装永不再弹」未实现(会再弹) |
| marks | `panel.tsx:58`(STATE_LABEL 未包 t(),en/ja 词典词条存在但不生效)、`sendTransform.ts:29,59`(注入消息硬编码中文) | 状态徽标 i18n 断线实锤;lost 标记定位仍跳旧行号 |
| 会话看板 | `boardData.ts:155`(.catch(()=>[])) | 扫描失败伪装 0 会话;泳道无虚拟化 |
| 打开方式 | `files/OpenWithMenu.tsx:19-22`、`kernel/openWith.ts:48-51` | 失败仅 console(注释自认最小实现);默认不分文件类型;菜单无方向键 |
| CLI 学堂 | `academy/lessonPane.tsx:76-83`、`guideTab.tsx:124`、`cli-qoder-cn/` 无课程目录 | 「试一试」不校验课程引擎;sourceVersion 仅装饰,课程过期无提示;9/10 家 |
| 会话检索 | `session-search/indexer.ts:158-182`、`:146-152` | 单关键词子串匹配(多词零命中);无命中高亮;无引擎过滤;dsh 无读取器 |
| 跨引擎接力 | `session-relay/relay.ts:35-51` | 摘要无单条/总长截断,长 prompt 直拼可撑爆目标上下文 |
| skill-hub | `StoreCard.tsx:67-73`、`InstalledView.tsx:1-5` | 无更新闭环(已装即终态);「已装」视图只显安装记录,手装技能不入列 |
| 意图画布 | `useAiDrawInbox.ts:29-72`、`aiDrawPrompt.ts:31-36` | inbox 导入只在画布 tab 挂载期轮询,后台零通知;作画目标随编辑器当前文档,结果散落多张画布 |
| 卫生清扫 | `settings/HygieneCard.tsx:26-74` | 无「立即清扫」与上次清扫回执,用户无感 |
| WSL 面 | `git/GitPanel.tsx:47-55`(零 wsl 分支)、`WslDirBrowser.tsx:53-137` | 远程工作区 git/checkpoints 落通用空态,契约 09「降级提示不静默」未兑现;目录浏览器只能逐级点击 |
| session-viewer 深度 | `cli-grok/grokTranscript.ts:9`(无 tool 行)、`cli-opencode/opencodeTranscript.ts:10`(无 reasoning) | 广度 10/10 但深度不均;极简模式对浅适配家无说明 |
| 手机 VT 重连 | `useLiveStream.ts:91-108` | 重连无水位回放,断连窗口输出永久缺口,违 master-plan「内容零丢失」 |
| 壁纸 | `wallpaper/fluidShader.ts:113`(lite 死代码)、`WallpaperSettingsTab.tsx:19-35`(顶层 t() 固化) | lite 低性能档无调用方;语言热切换后标签不换 |

### 产品级(抽认)

手机连接/通道管理(退避/轮换/撤销逐出)、Worktree 编排、发送二次确认、退出 toast 续聊、mcp-hub 写回方言与备份、桌面审批收件箱(omp 问卷卡)、图标组合切换、prompt-enhancer(8/10 家真 CLI 链)、壁纸主体、每日日志视图(d1-d16 打磨后)、节假日三态、设备管理 Rust 侧、会话查看器广度、侧栏文件浏览器、session-budget、手机配对与凭证链。

## 三、打磨点汇总(P0 全列 / P1 全列 / P2 归类)

### P0(3 项)

| # | 位置 | 问题 |
|---|---|---|
| P0-1 | `src/mobile/GitScreen.tsx:147` | checkout 用 window.confirm;iOS 壳无 runJavaScriptConfirmPanelWithMessage、Android 无 WebChromeClient(双端 grep 零命中)→ confirm 恒 false 不弹框,分支切换真机静默死钮(基于 WebView 默认行为推断,待真机验证) |
| P0-2 | `src/mobile/SessionScreen.tsx:119-141` + `ShellBridge.swift:149-162` | 通知组合失效:检测只在会话屏挂载期;iOS 未实现 willPresent 前台不显横幅——本地通知几乎不可达 |
| P0-3 | `src/plugins/checkpoints/BatchRowParts.tsx:95-150` | 高危红标右栏时间线缺位,整批「允许」按钮恰在此面;与 openspec proposal「两面生效」声明不符 |

### P1(30 项)

| 域 | # | 位置 | 问题 |
|---|---|---|---|
| 手机 | M1 | `GitViews.tsx:56-66` + `gitModel.ts:50` | 提交文件加载失败 catch(()=>[]) → 恒显「加载中…」,错误伪装永久加载 |
| 手机 | M2 | `CkptSheet.tsx:49` | diff 失败 → 空数组 → 「该批无文件记录」,错误伪装空态 |
| 手机 | M3 | `HistoryScreen.tsx:51-53` | 读失败与真空态不可分 |
| 手机 | M4 | `useLiveStream.ts:91-108` | 重连无水位回放,断连窗口输出永久缺口 |
| 手机 | M5 | `PairingScreen.tsx` 全 + `gate.tsx:167-237` + `gitModel.ts:54-59` + `remote.ts:228-235` | 硬编码中文未走 t()(m13 只修了 PluginBoundary,同域未覆盖) |
| 手机 | M6 | `mobile.css:255`(对照 :181) | 第二个 .sheet 定义覆盖旧属性:连接/审批/发起会话 sheet 内边距归零、背景 panel 化;遮罩浓度两种(静态分析,待目检) |
| 手机 | M7 | `ConnChip.tsx:105` 等 4 文件 | Tailwind 死类(min-w-0/flex-1/truncate/text-[…]):手机树不载 Tailwind,长文本不截断、错误红字丢失 |
| 手机 | M8 | `sessionFile.ts:52` | transcript 契约仅 3/10,其余会话屏永远只有 VT 尾流 |
| 手机 | M9 | `gitModel.ts:33` + `sessionFile.ts:18` | git_log 50 条 / transcript 40 轮均静默截断无提示无加载更多 |
| 手机 | M10 | 全树无 pty://exit 消费 | 会话桌面退出后手机停在末帧,发送只见「发送失败」,无退出提示/续聊引导(event_allowed 已放行,纯前端未消费) |
| 手机 | M11 | `GitScreen.tsx:205-207` | 远端分支只渲染计数,列表不可见不可切 |
| 0.2.4 | B1 | `kernel/ipc.ts:942-956` | OS 通知无点击 action,离开工位闭环缺最后一环 |
| 0.2.4 | B2 | `session-relay/relay.ts:35-51` | 摘要无单条/总长截断,可撑爆目标上下文/触发 TUI 粘贴启发式 |
| 0.2.4 | B3 | `academy/lessonPane.tsx:76-83` + `guideTab.tsx:19-22` | 「试一试」不校验当前会话引擎;欢迎页无 composer 时静默丢命令且直接结课 |
| 0.2.4 | B4 | `notify/index.tsx:96-101` | 额度轮询仅盯激活会话供应商,平铺多幕布不预警 |
| 0.2.4 | B5 | `academy/guideTab.tsx:124` | sourceVersion 仅装饰,CLI 升级后课程过期无提示 |
| 0.2.4 | B6 | `session-search/indexer.ts:158-182` | 单关键词子串匹配,多词零命中;无引擎过滤 |
| hub | C1 | `intent-canvas/useAiDrawInbox.ts:29-72` + `ComposerDrawToggle.tsx:50` | 作画开关亮但画布 tab 关闭时:AI 写 inbox → 零导入零通知,「AI 说画了但画布空」 |
| hub | C2 | `skill-hub/StoreCard.tsx:67-73` + `InstalledView.tsx:160-179` | 无版本比对/更新入口,已装即终态 |
| hub | C3 | `mcp-hub/StoreView.tsx:116-119` | 错误文案三源共用「Glama 现需 API key」,official/smithery 网络失败也显示,误导 |
| hub | C4 | `skill-hub/InstalledView.tsx:1-5` | 「已装」视图只渲染安装记录,手装技能不入列,与「十家扫描」字面预期有落差 |
| 旧批 | E1 | `web-access/WebCfPane.tsx:30` + `WebSelfHostPane.tsx:30` | 引导第③步指向不存在的「手机打开」按钮,中继 URL 无 QR,手机只能手抄 |
| 旧批 | E2 | `web-access/WebWanGate.tsx:21-23` | 风险弹窗「取消」后模态不关,唯一出路切 tab |
| 旧批 | E3 | `files/OpenWithMenu.tsx:21` | 外部应用打开失败仅 console.error,用户零感知 |
| 旧批 | E4 | `lsp/cmLsp.ts:158-163` | server 失败对 cmd+click/F12/hover 全静默,收回 loading 后无痕迹 |
| 旧批 | E5 | `lsp/javaGuideStore.ts:7-13` | 文档称「暂不安装永不再弹」,无 dismissed 标志,下次手势再弹 |
| 旧批 | E6 | `marks/panel.tsx:58` | STATE_LABEL 未包 t(),en/ja 词条永不生效,英文用户看中文徽标 |
| 旧批 | E7 | `session-board/boardData.ts:155` | 扫描失败伪装空结果(0.2.2 已给 fs_search 立规,此面未跟进) |
| 新批 | F1 | `structured-session/index.tsx:49` | 无 omp/pi 时 rail 钮仍显示,点击静默零反馈(死入口) |
| 新批 | F2 | `cli-shared/piRpc.ts:172-175` | 非 confirm 部件一律自动 cancelled,模型提问被替答而用户不知,轮次可能以错误前提继续 |
| 新批 | F3 | `daily-journal/GenSettings.tsx:50` + `genSession.ts:220-231` | 引擎选择器列全部 10 家不标注无头/TUI 形态,6 家 TUI 回落可靠性差异不可知 |
| 待核实 | F4 | `piRpc.ts:43,187-190` + `sessionTab.tsx:172-176` | prompt 请求 30s 超时:若协议 response 等轮末才回,正常长轮误报超时并回填草稿(应答时机需真机实证) |

### P2(约 45 项,按主题归类)

- i18n 残缺(~20 处):structured-session 2 键 + 词典死键、wsl 7 键(HostForm/AddWslTab/WslCard)、hub 批 4 键、`kernel/TerminalView.tsx:281` 裸中文、手机 VIEWS 中文兼类型(`GitScreen.tsx:25`)、relTime 单位、`shared.ts:75` 通知标题、academy `guideTab.tsx:144`、`CalendarGrid.tsx:124` 日期格式、`contextFormat.ts:37-61` 与 `sendTransform.ts` 注入 AI 的中文头(en/ja 用户消息被中文化)。
- a11y(8 处):五个新弹层(RelayDialog/SendConfirmDialog/SearchOverlay/WorktreeManageDialog/wizard)无 role="dialog"/焦点圈闭;手机全部 sheet 无 Esc/focus trap;`DayPanel.tsx:71` listbox 语义错位;热力图例 aria-hidden;wizard 无 roving tabindex。
- 交互效率(10 处):WslDirBrowser 逐级点击、structured exited 无「重新开启」、RPC 裸 textarea 无触发符/贴图、便签 Esc 弃稿无确认(`NoteEditor.tsx:87-92`)、openWith 默认不分文件类型、wanRiskAccepted 无重置入口、lost 标记无重新落锚、skill-hub isInstalled 小写匹配漏判、作画画布散落、HubEntry 停用态。
- 性能(3 处):SwimTimeline 无虚拟化(单日可数百会话)、SplitDiffView 无 content-visibility(unified 有)、HomeScreen 审批轮询 12 会话并发每 10s。
- 形制与记账(6 处):mcp-hub 用原生 window.confirm/alert、.empty 无 pre-line、令牌挂 :root 非 spec 声明的 .m-app、IconDecorCard 头注「三套」漂移、spec/proposal 与实现漂移 3 处(intent-canvas 字段/skill-hub codex 目录/矩阵)、「结构化」品牌三面共用易混淆。

## 四、引擎覆盖度矩阵

| 功能↓ 引擎→ | omp | pi | claude | codex | kimi | grok | qoder | qoder-cn | opencode | dsh |
|---|---|---|---|---|---|---|---|---|---|---|
| structuredRpc 结构化会话 | √ | √ | × | × | × | × | × | × | × | × |
| oneshotArgs 无头生成 | √ | √ | √ | √ | × | × | × | × | × | × |
| 生成 TUI 回落 | — | — | — | — | √ | √ | √ | √ | √ | 部分 |
| 会话查看器适配器 | √ | √ | √ | √ | √ | √ | √ | √ | √ | √ |
| 转录深度(tool+reasoning) | √ | √ | √ | √ | √ | 部分 | √ | √ | 部分 | 部分 |
| liveOverlay 活会话浮层 | √ | √ | √ | √ | × | × | × | × | × | × |
| 手机 transcript 契约 | √ | √ | √ | × | × | × | × | × | × | × |
| 磁盘扫描 listSessions | √ | √ | √ | √ | √ | √ | √ | √ | √ | √(需 host 在线) |
| 用户消息读取器(检索/接力) | √ | √ | √ | √ | √ | √ | √ | √ | √ | × |
| WSL 远程内省 | √ | √ | × | × | × | × | × | × | × | × |
| skill 扫描/建议 | √ | √ | √ | √ | √ | √ | √ | √ | 部分 | × |
| MCP 发现 listMcpServers | √ | × | √ | √ | √ | √ | √ | √ | × | × |
| MCP 配置读写 | √ | × | √ | √ | √ | √ | √ | √ | × | × |
| provider channels | × | × | √ | √ | × | × | × | × | × | × |
| 用量提取 sessionUsage | √ | √ | √ | 部分 | × | × | × | × | × | × |
| tok/s pill | √ | √ | √ | × | × | × | × | × | × | × |
| fetchQuota 额度 | √ | √ | √ | √ | × | √ | × | × | √ | √ |
| prompt-enhancer | √ | √ | √ | √ | √ | √ | √ | × | √ | × |
| 学堂课程 | √ | √ | √ | √ | √ | √ | √ | × | √ | √ |

读法:缺口分两类——「CLI 本身无此能力面」(如 dsh 无 skill 体系,诚实 ×)与「客户端未接」(如手机 transcript 契约可扩而未扩)。后者才是打磨对象;矩阵同时暴露三处手抄引擎表漂移(Rust conn.rs 10 家 / 手机前端 8 家 / 扫描器 9 家,qoder-cn 手机无入口)。

## 五、横切模式(逐点修不如立机制)

1. **失败伪装空**(最普遍):`catch(() => 默认值)` 把失败折叠成 null/[]/空表,下游渲染成「加载中…」「无记录」「0 会话」——手机 M1-M3、看板 E7、open-with E3、LSP E4 同型。0.2.2 已给 fs_search 立「不伪装空结果」的规矩,需推广为统一错误信封。
2. **能力门宽于实际能力**:入口用「有适配器」门(livePill/GenSettings/结构化 rail 钮/SpawnSheet),实际能力分层靠熔断或回落兜底——符合「缺失不猜」纪律,但用户视角是「能点进去才失败」,入口按能力分档(显隐/标注)更产品级。
3. **i18n 半途**:新面 t() 化、旧面裸中文;叠加手机恒 zh 无切换入口,词典资产是死数据;打磨轮新文案又系统性绕过 i18n(9+ 处双缺);常量表两种坑(漏包 t() 与顶层求值固化)。
4. **形制漂移**:手机 .sheet 双定义、Tailwind 死类、原生 confirm vs ConfirmBubble、高危红标单面、「结构化」品牌三面共用——同一语义多种几何/多种钮形。
5. **覆盖长尾**:structuredRpc 2/10、手机 transcript 3/10、liveOverlay 4/10、sessionUsage 4/10、oneshot 4/10、fetchQuota 6/10——缺口本身多数是诚实降级,缺的是「入口处让用户知道缺」。

## 六、未核实项(下轮真机验证清单)

1. 手机 window.confirm 在双端壳的实际行为(P0-1 推断依据:WebView 默认行为 + 壳代码零实现)。
2. 手机 .sheet 双定义覆盖的实际视觉效果(M6,静态级联分析)。
3. Windows 本机 UNC 路径下 git2 行为(WSL git 降级提示的形态依赖此结论)。
4. piRpc prompt 应答时机(F4:30s 超时是否误伤正常长轮)。

已闭环(2026-10-01 实施轮补证):

5. ~~Glama MCP 源是否确无匿名通道~~ —— 已实证:匿名请求 `glama.ai/api/mcp/v1/servers` 返回 401「This endpoint requires an API key」;另其 API Data License 要求展示数据处可见署名 Glama 并链接原始记录,未来若接 key 需一并满足。
6. ~~codex skill 实际目录~~ —— 已实证:`~/.codex/skills` 真实存在且活跃(内含 codex 自建 `.system` 子目录与多枚 symlink),`~/.agents/skills` 公约位并存;实现取 `.codex/skills` 正确,openspec proposal §4.3 codex 行属笔误(已在实施轮校准)。

## 七、实施结果(2026-10-01 同日)

- 10 批全落地:P0×3 全修;P1 全部修复或降档有据;P2 除留观项外全修。
- 降档三项:卫生清扫第三档(「立即清扫 + 上次回执」降为如实说明文案,回执数据不可得)、桌面通知点击(取桌面最小档,不支持通知 action 的环境重聚焦补发深链)、kimi/grok 用量行型(无据不猜,维持「缺失显示 —」纪律)。
- 留观清单见同日 spec(`docs/superpowers/specs/2026-10-01-client-polish-plan-design.md`)实施注记。
