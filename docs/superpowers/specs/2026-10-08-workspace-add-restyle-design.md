# 添加工作区浮层重构(来源卡片两步)设计

日期:2026-10-08
状态:已落地(commit 22534a9f + 评审收口;门禁全绿、桩目检双主题闭环)

## 背景与目标

添加工作区浮层(`WorkspaceAddDialog.tsx`,锚定入口按钮右侧滑出)现状是「标题 + tab 段控 + 一行说明 + 右下角按钮」的素堆叠,且带着一个实锤 bug:段控类 `.wsl-mode-seg` 在全仓库无任何 CSS 定义(0.3.x 删 WSL 卡段控时样式被一并删除,弹层侧成了孤儿),两个 tab 按钮裸渲染黏连成一坨。另有 review P2(2026-09-14):弹层复用 `wsl-*` 跨插件类名(`wsl-hint`/`wsl-remote-err`/`wsl-dialog-foot`/`wsl-btn`),CSS 耦合。

目标:

1. 修复段控裸类缺陷,整体视觉重构为「来源卡片两步」形态:入口步 = 本地目录卡 + 各来源注册卡;本地卡点击直达系统目录选择器,来源卡进入第二步(返回键 + 该来源 addTab 组件)。
2. 弹层自有 `wsadd-*` 中性类名,清掉对 wsl 插件类的依赖(收 review P2)。
3. 顺手修 i18n 缺口:`addTab.label` 注册时是裸中文串(`"WSL 发行版"`),en/ja 界面显示中文。

锚定浮层形态本身不动(2026-09-13 用户验收拍板:居中 modal 离入口太远)。

## 方案取舍

选定:方向 B「来源卡片两步」(大仙拍板)。理由:入口即选择,语义直给;本地路径零步骤(点卡即开 picker,比现状还少一步);来源可扩展(第三个来源注册 = 自动多一张卡);WSL 的重内容(发行版探测 + 目录浏览器)收进第二步,不再挤压弹层首屏。

被否决:

- 方向 A「密排打磨」(单步段控 + 全宽主按钮):改动更小,但本地 tab 内容天然只有一句话 + 一个按钮,单步结构下弹层永远半空;段控对「两个不对等的来源」是错误控件(本地是一键直达,WSL 是表单流程)。已做原型供对照,弃。
- 居中 modal:2026-09-13 验收否决过,不再复议。

契约取舍:`WorkspaceOrigin.addTab` 扩可选 `desc`(卡描述)与 `icon`(卡图标,类型照抄 `SidebarActionIcon` 先例 `ComponentType<{ size?; className? }>`),缺省有兜底图标——不强制第三方来源改注册面。弹层第二步的头部(返回键 + 来源 label)归弹层,addTab 组件内容不动(`AddWslTab` 的发行版选择/目录浏览/底栏全保留)。

样式落点:`wsadd-*` 规则从 `workspace-menu.css`(249 行,再加必破 300 铁则)拆出独立 `workspace-add.css`,由 `global.css` 同点 import。

## 验证

- 单测(新增 `WorkspaceAddDialog.test.tsx`,node renderToStaticMarkup 静态渲染):注册假来源后入口步出两卡(label/desc 透传);无来源注册回落单卡;段控类回归锚(永不再现 `wsl-mode-seg`)。两步切换/返回/本地卡直达 picker 属交互路径,走桩目检不在此钉(仓库测试先例均为静态渲染)。
- `wsl/contributions.test.ts` 回归:addTab 契约形状不变。
- 桩目检(1421 + Tauri IPC 桩):浅/深主题截图对比卡片布局、hover/focus 态、WSL 第二步浏览器内容、返回键;确认段控黏连 bug 消失。
- 门禁:`pnpm typecheck && pnpm test && pnpm check:arch-boundary && pnpm check:file-size && pnpm build`;提交收口 react-doctor 100。
- i18n:en/ja 界面下卡片标题/描述显示译文(裸中文串缺陷消除)。
