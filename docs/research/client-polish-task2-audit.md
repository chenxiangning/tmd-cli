# 客户端打磨任务2 五路审计(主题/i18n 译文/新近提交/设置面/微交互)

- 日期:2026-10-02
- 状态:已完成(发现已按同日 spec 裁决实施;见 spec 实施注记)
- 范围:上两轮(`ui-polish-0.2.5-to-0.2.7.md` 65 项 + `client-polish-half-month-audit.md` P0×3/P1×30/P2×45)覆盖面之外的增量;五个此前未系统扫过的角度
- 方法:5 路并行只读代码审计(主题 token used/defined 全集程序化 diff、preset 键签名比对、locales 15 域 + 38 插件词典精读、9 设置 section/15 tab 逐面走查、新近四提交逐笔 git show);P0 级发现全部经主会话实证复核
- 性质:能力调研,零代码改动

## 结论先行

上两轮把交互与 i18n 键位的大头清掉后,剩余欠账集中在四个新域:**原生弹窗残留**(window.confirm/alert/prompt 约 18 处代码位,git 面注释已实证 Tauri WKWebView 下 confirm 可能不弹窗直接放行)、**新主题适配长尾**(六套 tmd 主题落地后,写死深色档语义色、未定义 token 键、固定黑阴影三类破相)、**i18n 译文质量**(键位对齐但术语漂移 8 组约 90 词条、ja 硬伤 14 处、插件市场动态键 en/ja 直显中文)、**设置面形制与校验口径**(原生 select/checkbox 未收敛、三处数值校验 UI 与 kernel 域脱节)。共 64 项代码级发现(3+2+1 P0 / 29 P1 / 其余 P2)+ i18n 五类。

## 一、主题适配长尾(16 项)

token 主链健康:light8/dark4 preset 键集与旧族签名严格一致,映射器全键兜底。缺口全在消费侧:

| # | 位置 | 问题 | 级别 |
|---|---|---|---|
| T1 | workspace-sessions-extras.css:117,144 | .sv-radial-item/.thread-gear-btn 背景 var(--surface, var(--bg-elevated, #fff)) 两键全仓未定义恒落白;sv-radial 经 createPortal 脱离侧栏作用域,深色新主题下环形菜单一簇白圆破相 | P0 |
| T2 | web-access 全插件 | --tmd-bg/--tmd-error/--tmd-success/--tmd-surface-1 为从未定义的键:外网风险弹窗背景透明(WebWanRiskDialog.tsx:28),成功/失败语义色整面失效 | P0 |
| T3 | session-board.css:92 | .sb-lh-running 泳道名写死 #3fb950,浅色新主题对比 ≈2.1:1 不可读(workspace-sessions.css:249 已立浅色降档先例,看板漏接);另 55-60 状态点写死 #4493f8/#e5484d | P0 |
| T4 | workspace-file-browser.css:50 | .wsfb-search var(--tmd-bg) 未定义无 fallback → 背景透明 | P1 |
| T5 | workspace-sidebar.css:17、file-editor.css:63,159、file-preview.css:36、file-preview-docs.css:59、ssh.css:95、ssh-sftp.css:74,176 | #f87171(深色档红)写死 11-12px 错误文字,浅色新主题 ≈3.0:1;themes.css 已有 --tmd-err 分外观 | P1 |
| T6 | ssh-settings.css:256,265-267 | 警示文字写死 #f59e0b,浅色底 ≈2.2:1 | P1 |
| T7 | 19 个 css(quota/panel-overflow/assets/composer-anchors/plugin-market*/file-editor/start-failure-toast/ssh/session-budget/network-proxy/workspace-menu/styled-select/Tooltip/file-preview*/wsl-dialog) | 浮层阴影固定黑 rgba 0.32-0.55 不分外观,纸感浅色底上过重;plugin-market.css:157 inset 白高光浅色下不可见 | P1 |
| T8 | BasicAppearanceTab.tsx:190 | 预设卡 is-active/对勾只比 customThemePresetId 不校验 settings.theme:非 custom 模式对勾停在旧预设上,标识失真 | P1 |
| T9 | lsp.css:261,264 | 指南 ok #3a9d5d / warn #c2762a 写死,深色新主题 ≈3.2-3.4:1 偏弱 | P1 |
| T10 | dark4.ts | 三套深色新预设未带 terminal.ansi* 16 色,回落 VS Code 官方深色表(高饱和),与低饱和定位相悖;light8 已调 ANSI 四槽 | P2 |
| T11 | PluginBoundary.tsx:55 | var(--tmd-fg-secondary, #c9c9c9) 键不存在,fallback 浅色 ≈1.9:1(错误兜底屏) | P2 |
| T12 | markdown-preview.css:136、file-preview-docs.css:91、file-preview-structured.css:106、markdown-codeblock.css:190 | 激活态固定掺 #5fa3ff 系蓝 tint,不随 accent,棕/紫 accent 主题下突兀 | P2 |
| T13 | workspace-sessions-manage.css:55、lsp.css:291 | 主按钮 color:#fff 写死,不接 --tmd-accent-fg | P2 |
| T14 | BasicAppearanceTab.tsx:165-210 | 预设网格 37 套平铺无二级分组/默认角标/hover 预览(纯增强,留观) | 留观 |

## 二、i18n 译文质量(五类)

覆盖 kernel 15 域 en/ja 各 1835 条 + 38 插件词典 1118/1117 条;占位符全量比对 0 错位,ja 敬体统一,「会话/工作区/接力/便签/摘录/清扫」单译无漂移。

| 类 | 发现 | 量级 |
|---|---|---|
| a 术语漂移 | 幕布(en 三译 terminal/canvas/pane、ja 四译)、额度(ja 三译 クォータ/残量/使用量)、探测、内网、切换(切替/切り替え)、文件夹(フォルダー/フォルダ)、工作树、看板(ja 直留汉字)、供应商、状态,共 8+ 组 | ~90 词条 |
| b 硬伤 | ja 脱字「認情報」、中文残留(局域网×2/本机/内網×2/定位/級/公网×2/看板)、语义误用(決済=货款结算/競合接続)、「確認更新/检查更新」同译冲突;en 语法断裂 1、全角【】残留 3 | 14 处 |
| c zh 源标点 | 全角，13 条(338 条半角中的漂移);全角。259 条且半角 0(规范与实践系统性现状,裁决成文不逐条翻);"..." 14 vs "…" 114;全角冒号 1 | 28 条 |
| d 拼接复数 | en「{n}+复数名词」35 条 n=1 出 "1 items";ja 脆弱拼接 2 处(引号拆条/「戻る:」拼句) | 37 条 |
| e 漏译 | 动态键 plugin meta.name/desc 7 个完全无词典(check 脚本 t(variable) 盲区),en/ja 市场页直显中文:CLI 学堂/跨引擎接力/会话检索/会话查看器/看板 | 7 键 |

## 三、新近四提交增量自查(10 项)

整体质量高:preset 键集对齐、themes.css 静态值与映射器输出一致、单文件 ≤300 行达标、新增词条插值零错位、预设网格分组折叠齐全。

| # | 位置 | 问题 | 级别 |
|---|---|---|---|
| N1 | cli-omp/catalog.ts:111-121,150 | mergeCatalog 对已存在条目不补 curated 标记;精选条目 weeklyDownloads=0 沉底,在线模式被 CATALOG_CAP=20 截断,「精选」徽标仅离线兜底可见(npm omp-plugin 关键词实测 25 命中仅 1/16 精选包) | P1 |
| N2 | .github/workflows/ci.yml | check:i18n-keys 只挂 pnpm script 未入 CI,硬失败防线悬空 | P1 |
| N3 | catalogCurated.ts:6-7 | hasApi 收录门槛只在头注释,无契约测试防线(pi-usage 事件重演风险) | P2 |
| N4 | market.tsx:106-119 | 热门扩展区无过滤框,长包名靠 title(留观,纯增强) | 留观 |
| N5-N7 | check-i18n-keys.mjs | 段切分锚点脆弱/语言面硬编码/动态键前缀不提取(脚本增强,留观) | 留观 |
| N8 | marketCards.tsx:159 + locales | 「已开会的会话」笔误,三处(源+en/ja)同步带病 | P2 |
| N9 | BasicAppearanceTab.tsx | 网格只写 custom 档,浅色/深色/跟随系统模式无法换预设(既有缺口,本笔放大;与 T8 合并处置) | P1 |
| N10 | welcome.css:181 vs 204 | .welcome-ab:disabled opacity .45 源序在 .sec opacity .3 后,次要钮禁用态反而变更亮 | P2 |

## 四、设置面巡检(17 项,9 section / 15 tab)

主面与 notify/wallpaper 的 pref-card + segmented 即存节奏健康;欠账在分区插件:

| # | 位置 | 问题 | 级别 |
|---|---|---|---|
| S1 | CliConfigTab.tsx:109-116 | 切引擎/切配置源/切 GUI↔raw 时 key 重建整树,未保存草稿静默清零(注释自认) | P0 |
| S2 | assets/workspace/ssh 四分区 4 处 window.confirm(并入 P0-1 全仓清零项) | P1 |
| S3 | ShortcutTab.tsx:73-80 | 「全部重置」一键清空快捷键覆盖无二次确认 | P1 |
| S4 | AgentTab:106/PromptTab:178/HostModal:68 | 三个表单弹窗点背景即关丢草稿,无脏态确认无 Esc(并入弹层键盘回路项) | P1 |
| S5 | BehaviorTab.tsx:32-35 vs settingsSanitize.ts:59-64 | 缓冲上限 UI 只校 n>0,kernel 域 5 万-1000 万:输 2000 显示 2000 实际已回落 50 万,UI 与实际脱节 | P1 |
| S6 | WebAccessSection.tsx:79-87 | 内网总开关原生 checkbox,全库二态统一 segmented | P1 |
| S7 | PromptTab:59,199/HostModal:106,153/OmpCustomProviderDialog:96 | 6 处原生 select 违 StyledSelect 规约 | P1 |
| S8 | ConfigForm.tsx:47-55,90-94 | GUI 保存失败走中性 toast 2.6s 即逝,raw 模式失败却是持久红条,同 tab 两制 | P1 |
| S9 | NotifySettingsTab.tsx:13-18 | 阈值清空/非法静默回落默认 10 而非旧值 | P1 |
| S10 | HostModal.tsx:173 | 代理端口 Number(v)||0 静默回落,同窗主端口有 1-65535 严格校验 | P1 |
| S11-S17 | ssh 重置回执/自绘 switch/音量滑杆回显/intent-canvas 布局与布尔 select/组重命名行内错误/OpenWithTab 删除武装 | P2/留观 |
| 附 | WallpaperImageRows.tsx:26-31 | FIT_OPTIONS 模块顶层 t() 固化(上轮 wallpaper 修复漏网) | P2 |

## 五、桌面微交互与文案一致性(21 项)

| # | 位置 | 问题 | 级别 |
|---|---|---|---|
| M1 | ssh(7 文件)/workspace(4)/assets(2)/local-loader/NoteEditor | window.confirm 残留(含便签 Esc 弃稿确认走 confirm);git/mobile 命中均为注释已修项 | P0 |
| M2 | ssh sftpTreeShared/SftpTree/SshPanel/SftpTreeMenu/WorkspaceRowMenu | window.prompt 重命名、window.alert 报错 10 处 | P0 |
| M3 | HostModal/ImportModal/assets×2/skill-hub×2/mcp-hub ServerEditModal | 7 弹层无 useEscClose、无 Enter 提交、无 role=dialog(游离于已收口的 17 处外) | P1 |
| M4 | TopBar data-hint vs 同屏 FileActionsBar/RightPanelToolbar 原生 title | tooltip 双轨制,视觉与时机割裂 | P1 |
| M5 | ConfirmBubble「确认」vs GitConfirmDialog/SshOverlay「确定」 | 二次确认默认词分裂 | P1 |
| M6 | relTime 四源:kernel/relativeTime.ts(全档)vs mobile(无「刚刚」无周月年,注释自称与桌面一致)vs intent-canvas(绝对日期兜底)vs web-access(手写第四份) | P1 |
| M7 | 31 个 CSS 无 :disabled 处理 + not-allowed(14 处)/default(4 处)两约定并存 | 禁用态 cursor 失序 | P1 |
| M8 | memory-coordinator/approval-inbox/intent-canvas 日期格式三口径 + toLocaleDateString("zh") 不随语言 | P1 |
| M9-M21 | title 快捷键三口径/空态裸文本/spinner 四形制/SessionList 加载 return null/错误 toast 无「原因+出路」/wsl 字段错误埋 title/fmtDownloads 万/k 混用/terminalSearch 与 44 处 icon 钮 title 无 aria-label | P2 |

## 处置

见同日 spec `docs/superpowers/specs/2026-10-02-polish-task2-batch-design.md`:P0×6 + P1×29 全修,P2 精选子集(i18n 术语与硬伤、动态键、笔误、武装确认、aria-label 批量、深色 ANSI、透明度倒挂、顶层 t() 漏网),机制建设(空态原语/spinner 统一/错误 toast 模板)与纯增强留观。
