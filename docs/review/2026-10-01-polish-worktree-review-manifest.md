# 工作区全量变更检查清单(未提交,266 文件)

- 日期:2026-10-01
- 状态:供逐项检查用(两轮打磨叠加:前轮 0.2.5→0.2.7 视觉交互 65 项 + 本轮审计实施全量;零提交)
- 用法:每域按「变更文件 → 变更内容 → 影响范围 → 检查方式」核对;单文件看 `git diff -- <路径>`,新增文件直接读。域内标 [前] = 前轮(ui-polish-0.2.5-to-0.2.7.md 65 项,编号 m/w/d/s),[本] = 本轮(2026-10-01 打磨轮)。
- 全局门禁(两轮叠加后统一复跑):typecheck ✅ / vitest 445 文件 3460 测试 ✅ / file-size ✅ / arch-boundary ✅ / check:i18n-keys 退出码 0 ✅ / build ✅ / react-doctor 100/100 ✅

## 高优先检查(行为语义变更大的域)

### 1. 手机端 src/mobile(改 24 + 新 6 + ShellBridge.swift)

文件:GitScreen/GitViews/GitSheets/gitModel/CkptSheet/ConnChip/SpawnSheet/PairingScreen/HistoryScreen/SessionScreen/TurnsView/Row/HomeScreen/MobileApp/remote/shared/history/sessionFile/engines(+test)/gate/mobileMain/mobile.css/mobile-dark.css(新)/useComposerSize/useLiveStream/useDraft(新)/SheetBase(新)/SessionChrome(新)/enterSend(+test,新);mobile-app/native-shell/ShellBridge.swift

- [前] m1-m16:IME 回车换行、失败重试条、在途闸、把手/图钮命中区、行状态点、暗色令牌、草稿持久化、触控命中区外扩等(UI 交互面)
- [本] 静态批:分支切换确认 sheet 替 window.confirm(P0-1);git 历史/diff/会话转录三处错误态与空态分离;GitView 枚举英文化;Tailwind 死类清零;40 轮/50 条截断提示;远端分支说明;sheet 收敛 SheetBase(焦点管理)
- [本] 动态批:ask 检测挪 home 轮询边沿 + 去重台账(P0-2 前半);pty://exit 消费 + 退出横幅续聊 + 退出通知;实况重连水位回放;审批轮询串行化;home 手动刷新钮
- [本] i18n 批:语言跟随系统(仅手机进程内存,不落盘不污染桌面);PairingScreen/gate/relTime 全量 t() 化(+39 键);引擎表对齐 Rust 白名单 10 家(qoder-cn/dsh 入口);transcript 契约扩 codex/kimi(复用桌面纯函数解析器,kimi 历史屏从「读取失败」变可用)
- [本] react-doctor 批:SheetBase 迁原生 `<dialog>`;pollHomeWatch 改 reduce 链串行;ref 读取移出渲染期
- ShellBridge.swift:iOS UNUserNotificationCenterDelegate willPresent(前台横幅)
- 影响范围:手机端全部界面与交互;不影响桌面 UI 与桌面设置
- 检查方式:测试 90 用例绿;真机目检清单(确认 sheet/前台横幅/水位回放/dsh 裸命令/kimi 续聊/`<dialog>` 视觉)

### 2. checkpoints 审批线(改 6 + 新 1)

文件:BatchRowParts/BatchRowHead/CheckpointsPanel/index/risk(+test)/locales.ts(新)

- [本] P0-3:右栏时间线文件行接 classifyRisk 红标;批头与摘要行高危计数 pill(countHighRisk 纯函数,零正则复制)
- 影响范围:右栏审批线与中央批审阅单两面;高危判定逻辑本身未动(复用 risk.ts)
- 检查方式:risk.test +2;目检右栏红标与计数

### 3. kernel 核心(改 12 + 新词典 2)

文件:ipc.ts/academy.ts/openWith(+test)/TerminalView/tabs/terminalRefreshButton/terminalLoadOverlay/PluginBoundary(+test)/StyledSelect/locales(见 §4)/locales/{en,ja}/wsl.ts(新)

- [本] ipc.ts:sendOsNotification 加 onClick(通知点击 → 激活会话;桌面 notify-rust 不派发点击,OS 默认聚焦 + 重聚焦补发深链兜底)
- [本] academy.ts:openPanel 死契约删除(全仓零引用)
- [本] openWith.ts:默认打开方式按扩展名记忆(localStorage 覆盖层,256 条逐出)
- [本] TerminalView.tsx:加载更早输出的两串 t() 化
- [前] keepAlive tab 契约(tabs/EditorCenter)、PluginBoundary 重试钮、加载浮层 z 序与百分比、刷新钮形制
- 影响范围:通知链路 / 学堂契约面 / 打开方式 / 幕布加载与刷新 / 插件崩溃呈现
- 检查方式:openWith.test +5;目检通知点击与 openWith 按类型记忆

### 4. kernel/locales(改 24)+ 全仓词典收口

文件:en/ja 全部域文件 + 各插件 locales(见各域)

- [本] i18n 收口:新增 en 43/ja 44 词条;37 裸键加引号(wallpaper/session-viewer/git2 可见性修复);welcome 1 键转义形式修正;ExitSessionToast 内联词典迁 common;不对称 1 条补齐;新 wsl 域文件(misc 拆分)
- 影响范围:纯词典,en/ja 界面文案完整性与热切换;zh 行为零变化
- 检查方式:check:i18n-keys 退出码 0;locales.test 4 用例

## 按功能域(中低优先)

### 5. daily-journal(改 18 + 新 2)[前]d1-d16 + [本]

文件:视图/存储/调度等 18 文件 + EngMark/timerInput(新)
- [本] GenSettings:「无头/TUI 兜底」徽标、dsh 剔除、模型栏如实禁用;NoteEditor Esc 弃稿确认
- 影响:生成设置与便签;检查:GenSettings.test 徽标断言、dangerConfirm 测试

### 6. structured-session(改 6 + 新 3)[前]s1-s15 + [本]

文件:index/sessionTab/liveTurn/tabs/locales + confirmCard/dangerConfirm(+test)(新)
- [本] 非 confirm 部件自动取消转录 notice;exited「重新开启」;rail 入口按 structuredRpc 能力显隐(死入口清零);「结构化」品牌三处差异化;prompt 超时拆 PROMPT_TIMEOUT_MS(值不变,注释待实证)
- 影响:结构化会话全部交互面;检查:piRpc.test 3 例新增

### 7. session-viewer(改 9)[前]s9-s15 + [本]

- [本] livePill 能力门收紧(kimi/grok/opencode/dsh 不显浮标,pillCapable 纯函数);极简 tooltip 措辞对齐
- 影响:幕布右上浮标显隐;检查:liveOverlay.test +2

### 8. skill-hub(改 8 + 新 1,另删 3)[本]

文件:index/StoreCard/StoreView/InstalledView/InstallDialog 等 + installedUpdates.ts(新);已删 InstalledCard/installedMerge(+test)
- 更新闭环:记录版本 × ClawHub latestVersion 比对,「可更新」徽标 + 「更新」钮重跑安装链;isInstalled 精确匹配(slug 优先)
- **已按用户裁定回退**:已装视图维持安装记录制(不合并磁盘扫描),手装技能经「本地导入」
- 影响:技能商店与已装视图;检查:36 用例绿;目检更新钮与已装列表

### 9. mcp-hub(改 4)[本]

- 三源错误文案分源(Glama 401 单独文案);ServersView 删除确认换仓内浮层(替 window.confirm/alert);词条补齐
- 影响:商店错误提示与服务器删除;检查:目检删除浮层

### 10. intent-canvas(改 14 + 新 1)[本]

文件:aiDraw 链 12 文件 + aiDrawPoller.ts(新)+ spec 校准
- inbox 轮询升 activate 级常驻(画布 tab 关闭也导入);导入双路通知(聚焦 rail toast/失焦 OS 通知深链);作画目标缺省「最近画布」;注入 preamble 随 locale
- 影响:AI 作画闭环全程;检查:59 用例绿;目检 rail toast 与失焦深链

### 11. web-access(改 7 + 新 3)[本]

文件:五个 Pane/Card + wanRiskAccepted/index + WebWanRiskReset(新)+ locales(新)
- 引导文案改真实路径;中继卡补 QR;风险门取消可出 + 设置「安全」tab 重看入口;桥状态 600ms 盲刷改 web://access 事件订阅
- 影响:外网配置流程;检查:13 用例绿;目检风险门再入与 QR

### 12. lsp(改 7 + 新 5)[本]

- 手势失败 toast(60s 双槽节流纯函数);四语言外轻提示;「暂不安装」dismissed 持久化;错误串 t() 化
- 影响:语义跳转失败反馈与 Java 引导弹窗;检查:gestureNotice.test 7 例

### 13. marks(改 4)[本]

- STATE_LABEL 接 t()(词条原有);失锚标记指纹重锚辅助(成功跳新行/失败说明);注入模板随 locale(回链 path:Lx 不动)
- 影响:标记面板与发送注入;检查:sendTransform.test 既有断言绿

### 14. session-board(改 7 + 新 1)[本]

- 扫描失败显式错误条 + 重试(不再伪装 0 会话);节律条 role=option;图例可读;日期 title 走 t();泳道卡 content-visibility
- 影响:看板数据可信度与可访问性;检查:目检断网/权限异常态

### 15. wallpaper(改 5)[本]

- lite profile 死代码全删(fluidShader/FluidBackdrop/WallpaperLayer);预设标签表移入组件(语言热切换生效)
- 影响:流体着色器参数收平为 full 值(视觉无差,lite 本无调用方);检查:37 相关测试绿

### 16. wsl(改 6 + 新 2)+ styles/wsl-*(改 4)[前]w1-w15 + [本]

- [本] 目录浏览器路径直达(/ ~ 跳层 + 前缀过滤);HostForm 端口校验单测;GitPanel 远程工作区降级横幅(本机 UNC 不动);wsl 域词条
- 影响:WSL 面与远程工作区 Git;检查:HostForm.test;目检路径直达

### 17. academy(改 6 + 新 2)[本]

- 「试一试」引擎前置闸(不匹配不插命令不结课);sourceVersion 漂移提示条;左轨 roving tabindex 键盘导航;「{n} 条」t() 化;钩子前置重构(react-doctor)
- 影响:学堂全流程;检查:academy.test +2、practiceGate/courseVersion 纯函数

### 18. session-search(改 5 + 新 2)[本]

- 多关键词 AND;命中词 `<mark>` 高亮;引擎过滤 chip;弹层 a11y;startIndexerTicks 拆件
- 影响:检索浮层;检查:两测试文件绿

### 19. notify(改 5)[本]

- 额度监控面扩「运行中∪平铺幕布」(watchedQuotaSessions 纯函数);设置描述同步
- 影响:额度预警覆盖;检查:notify.test +2

### 20. session-relay(改 4)[本]

- 摘要截断(单条 500 字/总长 8KB,最旧先丢,预览明示);弹层 a11y
- 影响:接力首条消息体量;检查:relay.test +2

### 21. git(改 3 + 新 3)[本]

- worktree 列表 loading(拆 WorktreeList);弹层 a11y(dialogA11y);SplitDiffView 行 content-visibility
- 影响:worktree 弹窗与大 diff 滚动性能;检查:目检 loading

### 22. composer/search/settings/files/prompt-enhancer/welcome/ssh/memory-coordinator(各 1-3)[本]

- composer:SendConfirmDialog a11y;search:HubEntry 停用禁用态;settings:HygieneCard 如实说明/OpenWithTab 说明行/IconDecorCard 头注「五套」;files:OpenWithMenu 失败 toast + ↑↓ 导航;后三者:i18n 词条/引号修复
- 影响:零散交互点;检查:openWith.test +5

### 23. cli-shared(改 4)[本]

- skillRegistry 记录增 version 字段;piRpc:widgetCancelledNotice 纯函数 + 非 confirm 部件 notice 接线 + PROMPT_TIMEOUT_MS
- 影响:skill 安装记录格式(向后兼容,缺省不比对)与结构化会话部件可见性;检查:piRpc.test +2

### 24. 壳层 app-shell + main.tsx(改 7)[前]+[本]

- ExitSessionToast:续聊 busy/失败直馈(本轮)+ 内联词典迁出(i18n 收口);railPanelActivate/RightPanelToolbar/FileActionsBar/EditorCenter/main.tsx:前轮(rail 激活态/签名/keepAlive/mobile 分流)
- 影响:右栏 rail、签名、tab 保活、退出 toast;检查:railPanelActivate.test

### 25. src-tauri(改 1 + 新 1)[前轮遗留]

- render_health.rs:内联 tests 85 行外拆 render_health_tests.rs,324→240 行消 300 违规;零逻辑改动
- 影响:仅测试组织;检查:cargo test(未跑,建议补)

### 26. 配置与文档

- package.json:增 check:i18n-keys 脚本;scripts/check-i18n-keys.mjs(新,三形态词典收录/缺键/不对称/死键告警)
- openspec skill-hub proposal:校准注记(codex 目录笔误,不改史);intent-canvas spec:两处校准注记
- docs:FEATURES(+36 条与新「能力 Hub」段)、新 research(client-polish-half-month-audit)、新 spec(2026-10-01-client-polish-plan-design,含实施注记/门禁结果/回退记录)、README 索引、ui-polish-0.2.5-to-0.2.7(前轮)
- 影响:文档与检查工具,零运行时影响

## 建议检查顺序

1. §1-§4(手机端 / 红标 / kernel 核心 / 词典)——行为语义变更最大
2. §5-§11(结构化会话 / 查看器 / 三 hub)——新功能面打磨
3. §12-§23 ——单点修复,可抽样
4. §24-§26 ——前轮遗留与纯文档配置
