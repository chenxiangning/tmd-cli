# 客户端打磨任务3 实施设计(UI 整体效果:设计系统收口轮)

日期:2026-10-02
状态:已实施(门禁与目检注记见文末;审计依据 `docs/research/client-polish-task3-audit.md`)

## 背景与目标

任务1/2 收掉交互缺陷与颜色语义后,五路审计证实「整体效果」短板的根因是**缺设计系统**:字号 27 值双轨、间距 36 档无栅格、圆角化率 44%、动效 11 档零入场、浮层/选中/空态形制分裂。本轮目标:

1. **token 阶梯一次建齐**:字号六档、间距六档(4 栅格)、圆角五档、动效三档+两曲线,`@theme` 桥接 Tailwind 标准类,全仓字面量批量迁移。
2. **层次模型落地**:L0-L4 各归其位(浮层统一 popover、模态统一、选中/hover 各一种范式),浅色三主题对比度达标。
3. **状态三原语**:Empty(图标+一句话+引导钮)/ Spinner(一份 keyframes)/ 错误契约三分(持久条/Toast/红字),高频面接入。
4. **机械卫生**:图标四档 rem 化、badge 统一、等宽三轨归一、阴影/写死橙/状态色清尾。

非目标:不动架构与插件边界;不动 mobile 树独立 token 体系(声明保留);主窗 L0/L1 扁平口径不翻(左右栏不刷 panel 底,维持现口径仅规范成文);壁纸 elevated 打穿(card 档)留观;markdown em 相对制保留。

## 方案取舍

| 方案 | 取舍 | 理由 |
|---|---|---|
| **token 阶梯+批量迁移+原语(选定,用户拍板全量三梯队)** | 一次把设计系统建齐并全仓收敛,正文定 12px | 半吊子收敛(只建 token 不迁移)会留下双轨并存,比现状更混乱;11/12 双轨对半,12px 与 token 定义、text-xs 主流一致,迁移量最小 |
| 只做高频面点修(否决) | 只改看得见的几十处 | 根因是系统性缺档,点修后新增代码继续发散,下轮还得再来 |
| 全量含 mobile/壁纸打穿(否决) | mobile 树一并 token 化 | mobile 自带独立 token 与 dark 覆盖,体量一轮吃不下;壁纸 card 档涉 punch.ts 层次重设计,留观 |

## 实施裁决(统一约定)

- R1 **正文字号 = 12px**(--tmd-font-ui 定值;text-xs/0.75rem 同义):壳层 0.6875rem 系全量迁 12px 档,**固定行高同步档位化**(22/24/26→24,28 保留)防溢出;10px 档(text-[0.625rem]/0.625rem)→ --tmd-font-xs(meta);8-9.5px 徽标档 → --tmd-font-2xs(9px);孤值(0.68/0.7/0.72/0.65625/0.71875rem)就近归档。
- R2 **间距 4 栅格** --tmd-space-1..6(4/8/12/16/20/24):右栏面板容器统一 12、卡片 12/16 两档、中央 tab 页边距统一(页级 24/40,侧栏式 16)、行高 24/28 两轨、孤值 3/5/7/9/11/13 机械归档(3→4、5→4、7→8、9→8、11→12、13→12);命中区 <20px 钮 ::before 外扩 ≥24。
- R3 **圆角五档**:--tmd-radius-xs 4px 新增(图标微钮/迷你标签);10px 档消灭(卡片归 8、浮层归 12);7px→6;pill 统一 999px;@theme 映射 --radius-xs/sm/md/lg→token 消名值错位;热力格像素格(2/2.5/3px)注释保留。
- R4 **动效三档** --tmd-dur-1/2/3(120/180/240ms)+ --tmd-ease-out(ease-out)/--tmd-ease-move(cubic-bezier(0.2,0,0,1)):微反馈 120、浮层/弹层/toast 入场 180(fade+rise 4px)、大容器 240;spinner 收敛 global 一份 tmdSpin(1s linear);prefers-reduced-motion 全局化;DialogShell 补入场(全部弹层一次收口);离场维持瞬消(规范成文)。
- R5 **层次模型**:浮出层(菜单/下拉/tooltip/建议列表)统一 bg-popover+shadow-popover;模态统一 bg-popover+border-strong+shadow-modal+遮罩一档;模态四档底全部归位;选中态=accent-soft 底+fg 文字+weight 600(文件树/styled-select/panel-overflow 归位,bg-active≡accent-soft 保留双名文档合一);hover=bg-hover 纯色不叠边框;fg-faint 限纯装饰,信息文案升 subtle;浅色 mix 系数收紧至约 0.28/0.42/0.62(muted≥4.5、三档区分度拉开);写死橙收敛 --tmd-decor(默认现橙);text-white 全改 accent-fg;QR 白底加框、markdown 图片 sunken 垫底。
- R6 **状态三原语**:kernel `Empty`(图标 1.25rem fg-faint + 一句话 text-xs fg-faint + 可选次级动作钮)与 `Spinner`(0.75rem,引用 tmdSpin);五个高频空态接入(会话历史/检查点/命令抽屉/看板/mcp);加载文案统一前缀「加载中…」;错误契约:可重试取数失败=持久条+重试钮、瞬态动作失败=toast、行内校验=红字(HistoryView 空错分流);DialogShell 提交中加 Spinner;盲文 spinner 换原语。
- R7 **图标四档**:12(行首/行内)/14(按钮/面板头/菜单头)/16(工具钮)/24+(空态插画),密集表格 10 例外;size 统一 rem 字符串写法(消灭 px 数字);weight 默认 regular、激活 fill、强调 bold、duotone 仅空态。
- R8 **badge 统一**:999px、中性=描边/语义=tint 底二选一成对、padding 1px 6px、字号 0.625rem(密集 0.5625rem 例外)、文案原样大小写。
- R9 **等宽归一**:@theme 桥接 --font-mono: var(--tmd-font-mono);ui-monospace 直写与 --code-font-family/--font-mono 平行 token 全部并回;代码字号内联 11/块 13。
- R10 **顺手项**:mcp-hub ServersView 删除确认与 skill-hub SkillPreviewDrawer 补 useEscClose;字重 650→600、面板标题 600/页面 700;break-all→overflow-wrap:anywhere;滚动隐藏收敛 .tmd-scroll-hide。

## 实施分批(基座先行,9 域并行,文件所有权互斥)

| 域 | 范围 | 主项 |
|---|---|---|
| K 基座(主会话) | themes.css/global.css | R1-R4 token 阶梯、@theme 映射、tmdSpin、focus-visible ring、:active 按压、.tmd-scroll-hide |
| K2 kernel | kernel tsx/ts | Empty/Spinner 原语+测试、DialogShell 入场+提交 Spinner、themeTokens 浅色系数、bg-active 文档合一 |
| S1 壳层 CSS | src/styles/*.css | 全维度迁移(字号/行高/间距/圆角/动效/层次/选中/hover) |
| S2 插件 CSS-A | git/checkpoints/session-*/workspace/files | 同上 |
| S3 插件 CSS-B | hubs/market/academy/lsp/wsl/ssh/network-proxy | 同上 |
| S4 插件 CSS-C | daily-journal/intent-canvas/composer/memory/approval/web-access/wallpaper/notify/structured/viewer/local-loader/cli-config/marks/enhancer/settings | 同上 |
| T1 壳+kernel TSX | app-shell/kernel | text-[*] 归类、图标 rem 化、R7 |
| T2 插件 TSX-A | git/checkpoints/session-*/workspace/files/ssh/wsl | 空态/错误契约/spinner 接入、text-[*]、图标 |
| T3 插件 TSX-B | 其余插件 tsx + R10 顺手项 | 同上 |

## 验证

- 门禁:`pnpm typecheck && pnpm test && pnpm check:arch-boundary && pnpm check:file-size && pnpm build` + `node scripts/check-i18n-keys.mjs` + `npx react-doctor@latest -y` 100 分。
- 量化验收:字号等价值 27→阶梯内(允许 markdown em 与特例注释);间距孤值(3/5/7/9/11/13px)清零;圆角 token 化率≥90%、10px 档清零;transition 时长档外值清零;浮层族 bg-popover 统一(抽查 grep);写死橙/状态色清零;九份 rotate keyframes 归一。
- 对比度:六主题 fg-muted≥4.5(侧栏底)、subtle 三档区分可辨(复算写入实施注记)。
- 真机目检:正文 12px 后全局面密度(防撑破/截断)、六主题浮层/模态层次、文件树选中态、空态五面、弹层入场动效、键盘 focus 环。

## 实施注记(2026-10-02 收口)

- **两波 8 域落地 + 主会话收口**:基座(themes.css token 阶梯/global.css @theme 桥接+tmdSpin+focus-visible+active+scroll-hide+reduced-motion)先行;第一波 K2(kernel 原语+DialogShell 入场+浅色对比度)/S1 壳层 CSS/S2-S4 插件 CSS 三批/T1 壳层 TSX;第二波 T2/T3 插件 TSX 两批(空态/错误契约/spinner 接入+类名图标迁移)。T2/T3 中途故障,主体已落地(类名/图标/Empty×17 文件/Spinner×27 文件/Esc 顺手项全在),残缺由主会话补齐(liveTurn 导入笔误、git-panel/tab-bar 等 css 闭括号、BoardTab 行数、Checkpoints 错误条 role、mcp-hub/skill-hub 删除确认转原生 dialog、welcome/tokens.css 漏网字号、S1 遗留四处滚动隐藏挂类)。
- **量化验收**:字号 token 消费 592 处(11px 字面量清零,正文双轨归一 12px);圆角 token 324 处(10px 档消灭、@theme 值对齐存量零漂移);动效 token 104 处(11 档→3 档,8 份 spin keyframes 收敛 tmdSpin);Empty 原语接入 17 文件、Spinner 27 文件(盲文 spinner/加载文案统一);浅色对比度:muted@侧栏 paper/mist/linen 4.73/4.05/4.06→5.74/4.82/4.85 全部 ≥4.5,深色三主题全升不回退,三档区分度 Δ≥1.5(themeTokens.test 钉死不变量;faint 系数维持 0.68——任务值 0.62 会破 Δ≥1.5 约束,有据偏差)。
- **裁决与偏差**:① rounded-* @theme 按值对齐挂 token(视觉零变化,Tailwind 名比 tmd 名短一档注释声明);② bg-active≡accent-soft 保留双名文档合一;③ terminalRefreshButton/livePill 幕布半透浮钮保留(功能性不遮内容,头注释声明);④ Empty 文案维持 fg-faint 形制规范(可读性留真机目检裁决);⑤ 热力格/像素格 ≤3px 圆角与 em 相对制 markdown 保留(声明特例);⑥ intent-canvas --ui-font 误吃字号 token 修正为字族;⑦ 主窗 L0/L1 扁平口径未翻(非目标),壁纸 elevated 打穿留观。
- **门禁终态**:typecheck 通过;vitest 450 文件/3482 测试全绿;arch-boundary/file-size/i18n-keys(缺键 0)/build(2.15s)/react-doctor 100/100「No issues found」。
- **真机目检清单(留大仙)**:正文 12px 全局密度(防撑破截断);六主题浮层/模态层次(popover 统一)与浅色文字可读性;文件树/styled-select 选中态 accent-soft;空态五面(图标+文案);弹层入场动效(fade+rise)与 DialogActions spinner;键盘 focus 环与按钮按压微缩;daily-journal 月格密度(微字号归 9px 后)。
