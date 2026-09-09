# 全局界面字号:文字级缩放适配所有模块

日期:2026-09-08
状态:已落地(浏览器桩目检:默认态 titlebar 33px/侧栏 244px 不胀,20px 态文字 11→13.75px、图标 14→18px)

## 背景与目标

2026-09-07 外观四件套(commit 9e19b1c)落地的字号能力只有终端一侧:`terminalFontSize`(10–20 px)仅作用于
xterm 幕布。用户判定不符合设计意图:需要的是**客户端所有模块的文字字号**统一受一个「界面字号」设置控制,
而不只是终端大小加减。

目标:

1. 新设置 `uiFontSize`(html 根字号,12–20 px,默认 16),即时生效,覆盖所有模块的文字与图标。
2. `terminalFontSize`(终端)、`uiZoom`(整窗缩放)保留原语义,互不混叠。
3. 默认态(16)像素零变化:全部迁移为二进制精确的 px→rem 等值换算。

## 方案取舍

**选定:root font-size 缩放 + 全库 px→rem 等值迁移。**
实证支撑(2026-09-08 构建产物 `dist/assets/index-*.css` 核对):

- Tailwind 4 `text-xs`/`text-sm` 编译为 `font-size:var(--text-xs)`(0.75rem/0.875rem)→ 随根字号自动缩放;
- 间距编译为 `calc(var(--spacing)*N)`,`--spacing` 保持绝对 0.25rem 不覆写 → **布局壳(padding/gap/标准档位)不随文字放大**,
  这正是"纯文字缩放"与"整窗 zoom"的分界;
- `text-[11px]` 编译为字面量 `font-size:11px`,不随根字号变 → 163 处任意 px 字号类必须 codemod 成 rem
  (11px=0.6875rem、10px=0.625rem、10.5px=0.65625rem、11.5px=0.71875rem、9px=0.5625rem、9.5px=0.59375rem、
  12px=0.75rem、13px=0.8125rem、14px=0.875rem,全部二进制精确);
- 图标:phosphor `size?: string | number` 原生接受字符串;SVG `width="0.75rem"` 属性在 Chromium 解析为
  12px@root16(headless 实测)→ JSX `size={N}` 等值改 `size="N/16rem"`,自绘 glyph/`renderIcon(size)` 同链路。

**否决 A:字号并入 uiZoom(整窗缩放)。** 零迁移成本,但语义是等比放大整窗(布局壳一起胀),
与用户"文字字号"诉求不同,且 `uiZoom` 已独立存在——两控件重复。

**否决 B:CSS 变量覆写 `--text-*` 而不动任意 px 类。** 已实证标准类走 `var(--text-xs)` 可覆写,
但 163 处 `text-[Npx]` + ~190 处 CSS 内 px `font-size` 绕过变量体系,覆盖率不足一半,"所有模块适配"不成立。

**否决 C:em 替代 rem。** em 随父级继承复利(嵌套行高/图标逐级滚雪球),rem 单点锚定根字号,可预测。

## 设计

### 内核

- `settingsTypes.ts`:`uiFontSize: number`(12–20 整数,默认 16),常量 `UI_FONT_SIZE_MIN/MAX/DEFAULT`;
  `settingsSanitize.ts` 越界/非整数/非数回落默认。
- 新 `src/kernel/uiFontSize.ts`:仿 `uiZoom.ts` 通道 —— `bootUiFontSize()` 幂等,写
  `document.documentElement.style.fontSize = N + "px"`,`subscribeSettings` 跟随。`main.tsx` boot。
- 与 `uiZoom` 正交:zoom 改 webview 缩放因子,字号改 rem 基准;两者独立滑杆。

### 迁移(等值,默认态不变)

1. JSX 类:163 处 `text-[Npx]`、10 处 `leading-[Npx]` → 对应 rem 字面量。
2. CSS 文件:~190 处 `font-size: Npx` 与 3 处 `line-height: Npx`(含 `--sidebar-*-font-size` 等
   变量定义处)→ rem。`letter-spacing`/`background-size` 等排版外属性不迁。
3. 图标:全库 JSX `size={N}` → `size="N/16rem"`(phosphor + 内联 SVG 组件 + welcome/SessionList
   `renderIcon(12)` 类调用点同改);`kernel/cli.ts renderIcon?:(size:number)`、`plugin.ts icon`、
   `sidebarActions.ts`、`filePanel.ts` 等类型 `number` 处随用法需要拓宽为 `number | string`。
   git 插件 `h-3 w-3` 类定尺寸图标 → `h-[0.75rem] w-[0.75rem]`。
4. 不迁:固定 px 布局壳(`h-[21px]`/`w-[30px]`/`pl-[88px]`/圆角/border/定位偏移)、xterm 像素测量链路、
   `cmTheme.ts` 编辑器 fontSize(CodeMirror 以 px 量行,单独评估:随迁 rem)。

### 设置 UI

外观卡 `SystemAppearanceCard` 新增「界面字号」行:range 12–20 step 1 + 值显示 px + 非默认「重置」按钮,
排在「界面缩放」前。en/ja 词典补键。

### 已知上限

- 文字放大到 125%+ 时个别 px 定高小徽章(如 `h-[14px]` 行)视觉溢出 —— 接受,出现点杀,不预防性改壳。
- 终端不随「界面字号」(有独立字号设置);xterm DOM 文本层在 zoom 下非整数倍略糊为既有已记录行为。

## 验证

1. `pnpm typecheck && pnpm test && pnpm check:arch-boundary && pnpm check:file-size`。
2. 默认态像素回归:迁移前后 1421 浏览器桩截屏比对(侧栏/会话行/git 面板/设置页)应逐像素一致。
3. 125% 目检:`documentElement.style.fontSize=20px` 下全模块文字+图标放大、布局壳宽度不变。
4. 等值核对:codemod 后全库无残留 `text-\[\d+(\.\d+)?px\]` / CSS `font-size:\s*\d+px`(排除白名单)。
