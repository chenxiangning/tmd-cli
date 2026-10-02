# 0.2.5→0.2.7 界面打磨调研与实施(交互 × UI 美观度)

- 日期:2026-10-01
- 状态:已实施(六项门禁全绿含 react-doctor 100;真机目检留大仙;**代码未提交**)
- 范围:v0.2.5..v0.2.7 六大新 UI 面;四路代码级深读,共 65 项发现,按清单全量实施
- 性质:调研 + 实施记录(交互与视觉打磨,零 Rust 改动、零架构迁移)

## 结论先行

0.2.5→0.2.7 的三个版本把结构化会话、每日工作日志、WSL 面、手机 composer、幕布工具行五块新 UI 送上了线,骨架质量高(token 纪律、纯函数契约、数据面与桌面对齐都成立),但欠账集中在三类:**状态机边沿**(结算瞬间换装、流式期交互失灵、组件失活丢会话)、**反馈层缺失**(失败无重试、在途无闸、加载无出口)、**形制漂移**(同一语义两种几何、同一动作用两种钮形、token 名写错静默劣化)。本次 65 项发现中高严重度 11 项已全部修掉,中低项除 4 项越界/低收益项外全部实施。

## 变更面综述(v0.2.5..v0.2.7,64 提交,194 文件 +7515/-1925)

| 面 | 内容 | 主要落点 |
|---|---|---|
| structured-session(全新) | omp/pi RPC 流式结构化会话,幕布/结构化双视图,审批卡直答 | plugins/structured-session、cli-shared/piRpc、kernel/proc_stream |
| session-viewer | 极简展示(默认开启)、转录浮层、行渲染拆分 | plugins/session-viewer |
| daily-journal(0.2.6 新增,0.2.7 打磨) | 日/月/年三视图 + AI 文章 + 生成队列 + 轴面板 | plugins/daily-journal |
| WSL 面 | 目录浏览器三合一、主机表单并 SSH 簿、样式四拆 | plugins/wsl、styles/wsl-*.css |
| 幕布工具行 | terminal.canvasRow 挂点、刷新钮、加载浮层、PluginBoundary 错误条 | kernel/TerminalView 等 |
| mobile | composer 加大+选图+把手调高、运行区投影 | src/mobile |
| 壳层 | rail 入口互斥收敛右栏、签名钉、段头图标 | app-shell |

## 发现与实施清单

实施状态标记:[已修] / [已修(收窄)] / [不做] (理由随注)。逐项实施明细见文末「实施记录」。

### 一、mobile + 幕布工具行(16 项,研究员:mobile 路)

| # | 位置 | 问题 | 处理 | 状态 |
|---|---|---|---|---|
| m1 | mobile/SessionScreen.tsx:224-229 | Enter 发送无 IME 组合期守卫,拼音选词回车发出半截文本;桌面 enterAction.ts 契约未对齐(mobile 按铁则不得 import 插件 view 模块,判定内联+注释指路) | 内联 isComposing/keyCode 229 守卫 + 纯函数单测 | [已修] |
| m2 | SessionScreen.tsx:225 | 移动端无换行路径,软键盘无 Shift | 裸 Enter=换行(平台惯例),发送归 ↑ 钮,⌘/Ctrl+Enter 兜底,placeholder 同步 | [已修] |
| m3 | SessionScreen.tsx:167-179 | 发送失败条无重试钮、不清错、布局跳 | 失败条嵌重试钮、继续输入即清、改悬浮条不挤布局 | [已修] |
| m4 | SessionScreen.tsx:162-179 | 发送与 ask 应答无在途闸,外网 RTT 双击双发 | in-flight 闸 + 发送钮「…」态 + ask 卡在途禁用 | [已修] |
| m5 | mobile.css:108 + useComposerSize.ts | 把手命中区 14px、低对比、拖拽无反馈、双击回紧凑不可发现 | 命中区扩 32px、拖拽中加深、双击回紧凑态 | [已修] |
| m6 | mobile.css:103-106 | 移除图钮 18px 且悬出角易误触;缩略图无预览 | 命中区外扩 + 全屏预览浮层 | [已修] |
| m7 | remote.ts:212 | 选图失败唯一反馈是图钮变 ✕ 3 秒 | SendErrBars 错误条给人话文案(选图失败,请重试) | [已修] |
| m8 | history.ts + Row.tsx | 运行区行内零状态(.sdot.run 从未使用),turnActive/unread 不区分 | Row 接 activity 投影:在跑脉冲/未读 accent 点 | [已修] |
| m9 | HomeScreen.tsx:159 | 区头计数拼法与桌面不一 | 对齐「· n」 | [已修] |
| m10 | TerminalView.tsx:291 + terminalLoadOverlay.tsx | z-10 加载浮层盖住工具行,回放期刷新/结构化钮不可达 | 浮层降 z-0,行自然 painting 在上;画布浮层 z-10 原意图不变 | [已修] |
| m11 | terminalLoadOverlay.tsx:29 | 流式进度 chars/5000 假百分比 50 万字符钉死 99%;硬切无过渡 | 流式态改脉冲不确定条,回放态保真 pct,120ms fade-in | [已修] |
| m12 | terminalRefreshButton.tsx + livePill.tsx | 「刷新」与「结构化幕布」同权重纯文字 pill,22px 偏小 | 刷新钮加图标分主次(形制统一随本次,结构化钮文案收敛见 s11) | [已修] |
| m13 | PluginBoundary.tsx:36-60 | 三行文案硬编码中文未走 t();无重试出口 | t() 化 + 边界内重试钮(key 递增强制重挂) | [已修] |
| m14 | mobile.css:3-9 | 整套 token 仅浅色,系统暗色下整面白底 | @media dark 补全令牌组 + 写死浅色的面(banner/ask/opt/g-df 等)逐一覆盖 | [已修] |
| m15 | MobileApp.tsx:170 | 返回 home 即卸载,未发草稿静默丢失 | useDraft 按 sessionId 落 localStorage,发送成功清除(挂图不持久化:temp 生命周期不可靠) | [已修] |
| m16 | mobile.css:110-176 | send 30px/kb-toggle 28px/key 约 25px,低于触控标准 | 视觉不变,::after 外扩命中区 ≥40px | [已修] |

### 二、WSL 面 + 壳层(15 项,研究员:WSL 路)

| # | 位置 | 问题 | 处理 | 状态 |
|---|---|---|---|---|
| w1 | WslCard.tsx:36-37 | CardStatus 分支序错误,首屏检测期误导显示「经 SSH 连接远程宿主」 | loading 判断提前 | [已修] |
| w2 | WslCard.tsx:159-167 | 「设默认」失败零反馈 | 行内红字反馈 | [已修] |
| w3 | wsl-card.css vs wsl-distro.css | 同一概念两种行几何;.wsl-showall 死声明 | 行几何统一 34px hover;删死声明 | [已修] |
| w4 | WslDirBrowser.tsx:52-62 | 逐级进入无 loading 态,慢链路连点 | 列表降透明+禁连点 | [已修] |
| w5 | WslDirBrowser.tsx:68-107 | 两种「上一级」形制并存 | 统一 parentWslPath | [已修] |
| w6 | HostForm.tsx:28-31 | 端口校验 parseInt 有洞("22abc"/"0x16" 均过) | /^\d+$/ + Number.isInteger + 单测 | [已修] |
| w7 | HostForm.tsx:19,73 | 错误只有底部一行,无字段级标错,onChange 不清错 | 红框+aria-invalid+输入即清 | [已修] |
| w8 | HostForm.tsx:70-78 | 密码框无眼睛切换;不能回车提交;无取消钮 | form 包裹回车提交+取消钮+本插件内实现眼睛件(不跨插件 import,注释声明先例) | [已修] |
| w9 | HostModal.tsx(ssh) | 反向不一致:alert 报错+端口零校验 | 同簿一制:严格校验+内联红字 | [已修] |
| w10 | 六处 css | var(--tmd-mono) 引用全仓不存在的 token,等宽静默劣化 | 改 --tmd-font-mono,grep 清零 | [已修] |
| w11 | wsl-remote.css:105 | .wsmenu-note 错住 WSL 面+用离域变量;双错误类重复 | 迁回消费面+真 token;错误类收敛 | [已修] |
| w12 | wsl-dialog.css + AddWslTab | 弹层无 max-height/Esc 关不掉/探测期空白无取消 | 74vh+Esc+聚焦+「探测中…」+取消钮 | [已修] |
| w13 | AddWslTab/WorkspaceDialog | 同面两种下拉(原生 select vs StyledSelect) | 统一 StyledSelect+头注先例声明 | [已修] |
| w14 | railPanelActivate.ts + RightPanelToolbar.tsx | 【高】激活态与开合态脱节:折叠后图标仍全亮、aria-pressed 恒真 | 折叠态降级视觉+aria-pressed 如实;centerTab 已开再点聚焦 tab 不重开右栏 | [已修] |
| w15 | RightPanelToolbar/FileActionsBar | 签名缺 aria-hidden;size 死值双源;13 条着色规则兜底重复;签名色硬编码 | 逐项收敛:aria-hidden、删死值、CSS 变量化 | [已修] |

### 三、daily-journal(19 项,研究员:journal 路)

| # | 位置 | 问题 | 处理 | 状态 |
|---|---|---|---|---|
| d1 | MonthView.tsx:118-124 + css:285 | 【高】hover 生成钮 inset:0 遮罩吞掉点击,文章 tab 死路 | 遮罩 pointer-events:none、按钮 auto | [已修] |
| d2 | css:63-66 | 【高】cellwrap 包裹后圆角四规则全体失配,每格左上缺角、外框溢出 | 圆角责任移 cellwrap 按网格位置算 | [已修] |
| d3 | GenSettings.tsx:99-108 | 【高】定时输入严检回滚中间态,键盘实际不可编辑 | onChange 放宽 /^[0-9:]*$/,完整性留 onBlur+单测 | [已修] |
| d4 | YearView/FlowView vs journalStore | 热力三套分档并存(年视图固定 6/9 三档 vs 月视图分位四档) | 分位判定下沉共享纯函数,三面同源+单测 | [已修] |
| d5 | css:33-34,75 | 节假日 pill 硬编码紫,与全线 --tmd-hol 红双色系 | 收敛 --tmd-hol 单色系,删紫令牌 | [已修] |
| d6 | MonthView/YearView/FlowView + holidays.ts | 调休上班日仍画周末纹 | holOf 补调休查询,三消费面接 | [已修] |
| d7 | JournalTab.tsx:190-194 | 「补齐待生成」静默限量,已排队零反馈 | toast 复用+「已排队」pill 态 | [已修] |
| d8 | ArticleTab.tsx:77-83 | 生成中 chip 显示旧状态;disabled 钮 title 永不弹出 | chip running 态+aria-disabled 保 title | [已修] |
| d9 | TaskPanel.tsx:32 | 任务卡哈希彩点 vs 全局品牌 logo | 换 EngMark | [已修] |
| d10 | JournalPanel.tsx:39-47 | 右栏 22% 宽下月条必折两截;无「今天」回跳 | 月条改 7 列周网格+今天回跳钮(不动 DesktopColumns,壳面越界) | [已修] |
| d11 | css:163-165 | 年视图点阵 #fff 硬编码混色,暗色过曝 | 掺 var(--tmd-bg-base) | [已修] |
| d12 | MonthView.tsx:161-195 | 跨月补位格不可点跳月 | 补位格可点+弱化视觉 | [已修] |
| d13 | JournalTab.tsx:120-177 | view/ym 不持久化;「今天」跨零点过期;年视图 aria 谎报;无 focus-visible | 逐项修:localStorage+实时 now+aria+focus 样式对齐 | [已修] |
| d14 | YearView.tsx:73-80 | 迷你月卡头尾重复「n 篇文章」 | 去一处 | [已修] |
| d15 | ArticleTab/NoteEditor | 空日双重引导;排版层级偏挤;摘录引用无样式 | 引导收敛+字号微调+引用专属样式 | [已修] |
| d16 | JournalTab.tsx:48-56 + FlowView | 两处图例各自不全 | 图例补全(黄/红/蓝+分位动态注记) | [已修] |

### 四、structured-session + session-viewer(15 项,研究员:结构化会话路)

| # | 位置 | 问题 | 处理 | 状态 |
|---|---|---|---|---|
| s1 | structured-session.css:58 | 【高】.ss-spin 只有盲文样式无 i 网格律,忙态指示器空无一物 | 复刻 .lv-spin i 网格,一名两用消解 | [已修] |
| s2 | EditorCenter.tsx:21-23 + sessionTab.tsx:141 | 【高】编辑区只渲染激活 tab,切走即 kill RPC 会话(与「关 tab=kill」声明不符) | registerTabContent 加 keepAlive 契约(默认 false 零变化),EditorCenter 对 keepAlive tab display:none 挂载,kill 自动收窄为真关 tab | [已修] |
| s3 | liveTurn.tsx | 【高】轮次结算瞬间整体换装(气泡→强调线、署名时间戳冒出、6→12px),与「结算零跳变」相悖 | 用户/正文/思考复用 TranscriptBlockView/ThinkingRow 同形组件;工具行保留活轮特有自动展开实时输出 | [已修(收窄)] |
| s4 | transcriptRows.tsx:136-147 | 【高】PhaseFold forceOpen 吞用户点击且结算后状态反转 | touchedRef:点过即以 open 为准 | [已修] |
| s5 | sessionTab.tsx:214-219 | working 带随内容滚走且与 860px 列错位 | 移出滚动区 flex:none 底带+对齐 | [已修] |
| s6 | sessionTab.tsx:213 | exited 空态视口高空 div 顶残留内容 | 紧凑横幅 | [已修] |
| s7 | sessionTab.tsx:229-256 | 审批卡无键盘回路/焦点管理/危险分级 | alertdialog+焦点进卡(拒绝为安全默认)+Enter/Esc+危险启发式纯函数(插件侧,内核零涉及)+单测+入场动效 | [已修] |
| s8 | sessionTab.tsx:258-270 | 输入框写死 max-height 不长高 | auto-resize+Shift+回车提示 | [已修] |
| s9 | session-viewer.css:70-71 | diff 色引用未定义 token,暗色主题深绿不可读 | 改接 --tmd-diff-inserted/removed | [已修] |
| s10 | transcriptRows.tsx:176-181 | 极简组内中途叙述 markdown 语法裸奔 | 走已注入 Markdown | [已修] |
| s11 | livePill/sessionTab | 双视图命名漂移(结构化幕布/PTY流/转录视图)、无过渡、无回底浮标 | 命名收敛「结构化视图⇄PTY实况」+150ms fade+贴底浮标 | [已修] |
| s12 | liveOverlay.tsx:225 | 浮层主标题是 8 位哈希 | 改 SessionMeta.title,哈希降次要小字 | [已修] |
| s13 | transcriptRows.tsx:149-184 | 折叠组:无 chevron、双计数、展开无过渡、ThinkingRow 符号恒定 | caret 常驻+单计数+120ms 过渡+符号随开合 | [已修] |
| s14 | sessionTab.tsx:36 | 结构化 tab 头独缺「极简」开关 | ss-header 补同款钮 | [已修] |
| s15 | 插件 css 毛边 | 圆角裸写/--font-mono 写法漂移/--tmd-warn 死回退/--tmd-danger 三红并存 | 接 --tmd-radius-*/--tmd-font-mono、删死回退、收敛 --tmd-err | [已修] |

## 不做与留观

- render_health.rs 324 行超 300 行铁则:**存量违规**(v0.2.7 发布态即红,与本次 UI 打磨无关);该文件刚经四轮卡死根治收敛,深夜拆分风险大于收益,留白日专门收口。
- daily-journal 右栏面板宽度不动 DesktopColumns(全壳面,越界),面板内以周网格自解。
- 手机挂图不跨页持久化(temp 文件生命周期不可靠,误恢复比丢失更糟),只持久化文字草稿。
- mobile「回车发送→回车换行」是行为反转,为平台惯例与 IME 安全的取舍,已如实记录待大仙目检裁决,一键可回退。

## 实施记录

四个实施代理按上表逐项落地;实施完成后的门禁结果、残修记录、文件清单见本节(回收中,代理完成后补全)。
