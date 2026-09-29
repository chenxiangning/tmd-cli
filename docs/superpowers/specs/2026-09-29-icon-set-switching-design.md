# 图标组合切换:5 套可切换界面图标(现状/实心/换隐喻/Lucide 细线/Lucide 变体)

日期:2026-09-29
状态:已实现(门禁绿 + 1421 桩目检过;真机 tauri:dev 复验留大仙。候选对照见 `docs/design/icon-set-candidates.html`)

## 背景与目标

iconDecor 提供 34 键独立取色 + 呼吸闪烁,但图标字形本体由各组件硬编码,风格唯一(bold 圆胖),长期观看审美疲劳。目标:在「图标装饰」设置卡新增「图标组合」切换,共 5 套——组合1 现状(零变化)、组合2 实心(同字形 fill)、组合3 换隐喻(逐键换 Phosphor 图标)、组合4 Lucide 细线、组合5 Lucide 细线变体(4↔5 切换经 morphicons 弹簧变形,组合切换即全表 34 图标同时变形演出)。每键自定义颜色与呼吸闪烁机制正交不动(CSS 变量吃 `currentColor`)。

范围注记:spec 初稿按当日 17 键白名单设计;并行提交 6cdeb24a(图标装饰扩编 34 键,工作区行/顶栏/composer 工具条与输入轨)落地后,组合机制同步扩到全 34 键。非目标:不动 CLI 供应商品牌图标;不做用户自定义字形导入。

## 方案取舍

**选定:kernel `iconSetTables.ts`(解析表)+ `iconSet.tsx`(DecorIcon 组件)+ `settings.iconSet` 字段。**

- `settings.iconSet: "classic" | "solid" | "metaphor" | "lucide" | "lucide-alt"`,默认 `"classic"`;存量 settings.json 无此字段由 sanitize 白名单回落,零迁移。
- 渲染位以 `<DecorIcon id Fallback={原图标} ...props />` 接管(13 文件):组合1 下 Fallback 原样渲染(仅 newchat 保留显式 duotone 现状),像素级等值;未知动态 id(未来注册的面板/动作)自动 classic 语义,组合不生效。
- kernel 持表合规:34 键白名单本就是 kernel 跨插件契约(`ICON_DECOR_IDS` 先例),字形表不含单插件私有语义。

**新增依赖(2 个,理由如后)**:`morphicons@1.7.1`(MIT,零依赖,react peer ≥18,~6-8KB gzip,ESM+TS,SSR 静态输出)——图标弹簧变形引擎,组合4/5 的核心效果;`lucide@1.48.0`(ISC,纯 IconNode 数据包)——stroke 图标数据源。技术栈铁律的例外理由:变形动画引擎与 stroke 图标数据是自研不经济的基础能力(morph 数学 = 贝塞尔重采样+Procrustes 对齐+弹簧物理),两包均零传递依赖、可 tree-shake(单键引入),体积增量可控;无此依赖则组合4/5 无法成立。

**被否决方案对照:**

| 方案 | 内容 | 否决理由 |
|---|---|---|
| 全局 Phosphor IconContext 线重档位 | 组合 = regular/fill/duotone 全局默认(~30 行) | 覆盖面是全应用而非装饰位;线重变化不被大仙视为「新的一套图标」 |
| 注册面扩展 | 各插件注册时提供多套图标变体 | 每插件负担 + 注册 API 破坏性扩容;字形知识散落 14+ 插件 |
| app-shell 持 DecorIcon | 组件放壳层 | workspace/settings/session-board/web-access 等插件无法 import `@shell/*`(R4) |
| Phosphor 图标之间 morph | 现有组合间也做变形 | morphicons 只吃 stroke 图标,Phosphor 是 fill 绘制(官方明示不兼容);组合1-3 之间切换 = 直接跳变 |
| 组合4 单套 Lucide | 只加一套 | 跨族(Phosphor↔Lucide)切换只能跳变,单套几乎看不到 morph 演出;双套互切才有完整效果 |

## 组合内容

- **组合1 classic**:现状字形,线重仅 `newchat` duotone(其余吃全局 bold)。
- **组合2 solid**:同字形 `weight: fill`(system-proxy 内联梯子 SVG 不吃线重,保持;原型页已示明)。
- **组合3 metaphor**:32 键换隐喻 Phosphor 字形 + bold(挑选见候选对照页;`fold-left/fold-right` 除外——双态方向性 affordance,字形本体指示折叠方向,换字形丢语义,仅颜色/闪烁对它们生效)。
- **组合4 lucide**:Lucide IconNode 细线字形,语义贴近组合1(Rocket/Server/Folder/GitBranch…全表见 `iconSetTables.ts LUCIDE_A`)。
- **组合5 lucide-alt**:Lucide 换隐喻字形(Sparkles/KeyRound/FolderOpen/GitMerge…全表见 `LUCIDE_B`),与组合4 逐键不同 → 4↔5 切换全表 morph。
- 组合4/5 渲染走 `morphicons/react` 的 `MorphIcon`(`reducedMotion="user"` 尊重系统减弱动效;调用点 Phosphor 特有 props(weight/from/to/ref)在 lucide 分支剔除)。

## 实施(实际落点)

1. settings 链:`settingsTypes.ts` / `settingsAppearance.ts`(ICON_SET_IDS + sanitizeIconSet)/ `settingsDefaults.ts` / `settingsSanitize.ts`;`settings.test.ts` 默认快照补 `iconSet: "classic"`。
2. kernel:`iconSetTables.ts`(metaphor/LUCIDE_A/LUCIDE_B 三表 + `resolveDecorIcon` 纯函数,返回 `{kind: phosphor|lucide, glyph?, weight?, icon?}`);`iconSet.tsx`(DecorIcon 组件,MorphIcon 分支;组件文件只留组件,react-doctor only-export-components 纪律)。
3. 渲染位接管 13 文件:`RightPanelToolbar`(rail tab + 溢出菜单,panel.id → `panel-<id>`、ssh 特例 `ssh-panel`)、`SidebarSettingsCluster`(菜单行 + 钉住钮)、`WorkspaceCard`(newchat/worktree/ws-*)、`TopBar`(market/home;fold 双键不接管)、`BoardButton`、`RemoteControlBadge`、`WakeIcons`、`ComposerToolbar`、`RailWakeIcons`、`TileBroadcastButton`、`ComposerDrawToggle`(两态 weight 在 classic 下保留)、`EnhanceButton`、`IconDecorCard`(预览走 DecorIcon)。
4. 设置 UI:IconDecorCard 顶部「图标组合」五段 segmented control;locales zh/en/ja 补键。
5. 顺手修(既有红,非本特性引入):`pluginPermissions.ts` 登记 `sessionSize: null`(内核保留,session-viewer 提交遗留未登记)+ `sanitizeIconSet` 入 SETTINGS_PURE_KEYS。

## 验证(已执行)

- 单测 11 例全绿:`settingsIconSet.test.ts`(默认 classic/合法透传/非法回落/磁盘读取无字段回落);`iconSet.test.tsx`(classic Fallback 原样 + newchat duotone、solid fill、metaphor 换字形 + bold、全表覆盖 fold 例外、lucide/lucide-alt 双表逐键不同 + 未知 id 回落、lucide 24 网格渲染)。
- 门禁:typecheck / vitest(自辖文件全绿;askWatch 系失败与 askWatchCore 301 行属并行会话在途)/ arch-boundary / file-size(自辖文件)/ build / react-doctor 100。
- 1421 桩目检(Tauri IPC 桩 + DOM 驱动):三段 Phosphor 组合切换 rail/market/newchat 字形逐档变化、组合1 还原基线;五段 segmented 渲染;组合4 = Lucide stroke 渲染(viewBox 24);组合4→5 切换 mid 采样 ≠ 终态 = morph 弹簧过渡真实发生;截图留证。
