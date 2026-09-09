# 设置外观四件套:i18n / 终端字体字号 / 界面缩放 / 终端 ANSI 配色

日期:2026-09-07
状态:已落地(浏览器桩目检通过:浅色 ANSI 16 色逐槽比对、三语切换整树换语、缩放/字号滑杆、字体下拉平台过滤)

## 背景与目标

设置「外观」tab 目前只有主题模式 + preset 网格。本次补四件事:

1. **语言 i18n**:中文 / English / 日本語 三语切换,即时生效、重启保持。用户裁决:**全量覆盖**(~500-900 条用户可见文案,~120 文件)。
2. **终端字号**:10-20 滑杆,默认 13(现状硬编码),即时生效。
3. **终端字体**:平台默认栈 + 常见等宽字体下拉(带可用性检测)+ 自定义 family 输入。
4. **界面缩放**:80%-150% 步进 5,整窗缩放(用户裁决要做,不只是终端)。
5. **浅色终端配色修复(根因)**:`mapPresetToTokens` 目前只给 xterm 提供 bg/fg/cursor/selection 四值,**ANSI 16 色完全未映射**,xterm 落到自带默认调色板(为深色底设计)——浅色主题下黄/亮青/亮绿等「太亮看不清」即此根因。方案:采用现成配色方案 —— VS Code 官方终端 ANSI 默认色(一手源值,MIT),浅色侧全部为深色调、bright 系与 base 同值或加深,白底对比度全部可读;深色侧同源。

## 方案取舍

### i18n 机制

**选定:gettext 式 `t(源中文, params)` + 语言切换时根组件重挂载**

- 词典以中文源串为 key(zh 即恒等映射,零中文词典);en/ja 词典按域分文件(`src/kernel/locales/{en,ja}/<domain>.ts`),天然满足 300 行铁则。
- 即时生效:`main.tsx` 根 `<AppShell key={settings.language}/>`,语言变化整树重挂载(低频操作,等价于主题级切换;host/PTY 态全在 React 外不受影响,幕布回放机制本就按重挂载设计)。
- 模块顶层数据(cli.ts profile 描述、快捷键命令名等)**不在定义处调 t()**,消费点渲染时 `t(field)` 包裹,避免 import 期固化语言。
- 插值:`t("共 {n} 条", { n })`,`{name}` 占位符全量替换。不做复数/性别/日期格式(桌面工具语料不需要,YAGNI)。
- 落盘:`AppSettings.language: "zh" | "en" | "ja"` 默认 zh;`bootI18n` 同步 `<html lang>`。

**被否决**:
- *i18next / react-intl*:新依赖,违反「不引入新框架」;我们只需要查表 + 插值,50 行内核解决。
- *英文语义 key + 三语词典*:多维护一份中文词典、每条文案要先起 key,纯增重。
- *useT() hook + 局部订阅重渲染*:每个组件多一行样板;收益只是省一次整树重挂载(低频),不值。

### 界面缩放

**选定:Tauri `Webview.setZoom`(macOS WKWebView pageZoom / WebView2 zoomFactor / WebKitGTK zoom_level)+ capability `core:webview:allow-set-webview-zoom`;浏览器 dev 兜底 `#root` CSS zoom**

- VS Code 同款思路(window zoomLevel 即浏览器 zoom 因子),xterm.js 在 Chrome 各级缩放下正常工作是日常事实。
- CSS px 语义在 page zoom 下自洽:getBoundingClientRect 随缩放归一,xterm 无需感知。

**被否决**:
- *全量 CSS rem 化*:改所有样式文件且高度/内边距耦合 px,工程量与回归风险远超收益。
- *只放大字体不缩放布局*:固定高度的徽章/按钮会溢出。

已知上限(记录不处理):缩放非整数倍时文本层可能有轻微发糊,VS Code 同款行为;用户可用终端字号设置精确控制终端文字。

### 终端 ANSI 配色

**选定:`themeTokens.mapPresetToTokens` 增 16 个 `--tmd-terminal-ansi-*` token;preset 可用 VS Code 命名 `terminal.ansiBlack`…`terminal.ansiBrightWhite` 覆盖;fallback 按外观取 VS Code 官方默认(浅色/深色两张表);`TerminalView.readTerminalTheme` 全量映射进 xterm ITheme**

源值:microsoft/vscode `src/vs/workbench/contrib/terminal/common/terminalColorRegistry.ts`(ansiColorMap.defaults,MIT,现役 main 分支一手抓取,非二手转述):

- light:black #000000 / red #cd3131 / green #107C10 / yellow #949800 / blue #0451a5 / magenta #bc05bc / cyan #0598bc / white #555555;brightBlack #666666,brightRed/Magenta/Blue/Cyan 与 base 同值,brightGreen #14CE14,brightYellow #b5ba00,brightWhite #a5a5a5。
- dark:black #000000 / red #cd3131 / green #0DBC79 / yellow #e5e510 / blue #2472c8 / magenta #bc3fbc / cyan #11a8cd / white #e5e5e5;brightBlack #666666 / brightRed #f14c4c / brightGreen #23d18b / brightYellow #f5f543 / brightBlue #3b8eea / brightMagenta #d670d6 / brightCyan #29b8db / brightWhite #e5e5e5。

浅色侧设计要点正是用户痛点的解:bright 系**不比 base 亮**(红/蓝/品红/青直接同值),杜绝「亮黄亮青糊白底」。

**被否决**:
- *One Half Light(iTerm2-Color-Schemes 端口)*:其 bright 系挪用 One Dark 值(如 brightGreen #98c379、brightWhite #ffffff),白底对比度 1.9:1 乃至同色,恰恰复现「看不清」。
- *Catppuccin Latte*:成套且优雅,但整体粉彩低对比;用户主诉是可读性,不作默认(不排除未来作为 preset 级 `terminal.ansi*` 覆盖引入)。
- *Solarized Light*:以低对比著称,与主诉相反。
- *保持 xterm 默认 + 手调*:重造轮子且无先例背书。

### 终端字体字号

**选定:`AppSettings.terminalFontSize`(10-20,默认 13)+ `terminalFontFamily`(""=平台默认栈;否则 CSS family 串);`TerminalView` 挂载期读 settings,`subscribeSettings` 里 live 更新 `term.options.fontSize/fontFamily` + `fit.fit()`;字体下拉按平台过滤 + `document.fonts.check` 标注不可用项 + 自定义输入**

**被否决**:*枚举系统全部字体*(需要 Rust 侧新命令枚举字体目录,收益低);*npm webfont 打包*(体积与风格劫持)。

## 验证

- `pnpm typecheck && pnpm test && pnpm check:arch-boundary && pnpm check:file-size && pnpm build` 全绿。
- 新增测试:settings sanitize(新字段合法域);themeTokens ANSI token 存在性 + 浅色值正确;词典 en/ja 键位一致且值非空。
- 浏览器桩目检(1421 dev + `__TAURI_INTERNALS__` 桩):浅色主题下外观页 ANSI 16 色板渲染、语言切换整树换语、缩放生效、字号滑杆即时改幕布。
- 真实窗口(tauri:dev)浅色主题下开一个 CLI 会话目检 ANSI 输出可读性(幕布 canvas 颜色最终以真窗为准)。

## 落地修订(实施期决定,2026-09-08)

- 相对时间/日期:kernel/relativeTime.ts 改走 Intl.DateTimeFormat / Intl.RelativeTimeFormat(en/ja 零词典,zh 保持手写口径);顺手修了 day≥360 时「0 年前」的旧边界。
- git 域词典超 300 行:按 themePresets 先例拆 git.ts + git2.ts(前半文件内 merge 导出)。
- QuotaChip 快照字段(title/planLabel/usedLabel/窗口 label)统一在渲染点 t() 包裹;「{id} 额度」动态标题与「{title},点击查看详情」等动态键已入词典。
- 已知边界(记录不处理):Rust checkpoints/view.rs 下发的 doneReason 是中文字面量,前端以 t() 最佳努力翻译,根修需后端改发 code;QuotaWindow.label 兼作数据比较键,codex 本地动态窗口标签(如「14 天」)en/ja 回落源中文;memory 面板 toLocaleDateString("zh-CN") 固定 locale 未随语言切换。
- 文案迁移规模:10 个分域并行任务覆盖全部 22 插件 + 外壳,~975 条字面量键,词典 en/ja 各 ~1190 条;locales.test.ts 钉键位一致/占位符保留/方向正确三契约。
