# 右缘面板 rail(顶栏面板入口迁竖排工具条)设计

- 日期:2026-09-27
- 状态:已落地(实现随本 spec 提交;1421 桩目检通过)

## 背景与目标

右栏面板入口(panel tabs)原先钉在 titlebar 右区(`TopBarPanelTabs`),横向排布。随着面板增多(files / git / marks / checkpoints / approval-inbox / memory 六家钉住外显 + ssh 走侧栏入口),顶栏横向空间吃紧,顶栏右区还要容纳折叠钮、工作区选择器与 `header.right` 挂点。

目标:参照 activity bar 形态(用户提供的参考图)把面板入口迁到窗口右缘的常驻竖排工具条,顶栏只留非面板类动作。UI 按参考图执行,不做自由发挥:窄竖条、图标自上而下堆叠、一条横向分隔线、⋯ 组紧随其后。

## 方案取舍

| 决策点 | 选定 | 被否决 | 理由 |
|---|---|---|---|
| 顶栏 tab 条处置 | 完全移除,入口只在 rail 一处 | 顶栏与 rail 并存双份入口 | 双份入口重复且顶栏拥挤问题只解决一半;用户拍板完全移除 |
| rail 列表语义 | 沿用钉住清单 + ⋯ 溢出菜单(⋯ 在分隔线下方) | 全量平铺所有面板,删除钉住机制 | 钉住语义(localStorage `tmd.filePanel.pinned.v1`)与 `topbarEntry` 契约零变更,kernel 注册面不动;用户拍板沿用 |
| rail 位置 | 内容行最右的常驻 flex 兄弟节点(AppShell 挂 `PanelRail`,右栏收起也在) | 塞进 `react-resizable-panels` Group 当一个 Panel | rail 不参与拖拽分栏,进 Group 要么违反 Panel 子元素契约要么引入假分栏;右栏收起时 rail 必须常驻,Panel 随 `rightOpen` 卸载做不到 |
| 点击行为 | 切面板 + 自动展开右栏(`onActivate` → `setRightOpen(true)`) | 仅切面板(沿用旧行为) | 旧顶栏 tab 在右栏收起时点击无可见反馈,是既有缺陷;rail 常驻后该缺陷不可接受 |
| ⋯ 菜单弹出方向 | 贴按钮左缘向左弹出,纵向按估高夹取 | 沿用向下弹出 | rail 钉在窗口右缘,向下弹会被右缘裁切 |
| 样式落点 | 改造 `right-panel-toolbar.css`(类名 `panel-tab` → `panel-rail-tab`) | 新建 rail 专属 css 文件 | 同一视觉职责域,避免文件碎片;图标装饰的 per-panel 点亮色与 `icon-decor.css` 呼吸表同步改指,`data-panel-id` 契约不变 |

顶栏对齐公式:右区竖线(`.titlebar-actions.is-expanded` 左缘)须与右栏左缘 − 4px 手柄对齐。顶栏右 padding 改为 `calc(12px + var(--tmd-rail-w))` 预留 rail 宽后,右区右缘已随 padding 左移,宽度公式保持 `右栏宽 + 4px − 12px` 不变(初版多扣一次 rail 宽,桩目检测出 44px 偏移后修正)。

## 验证

- `pnpm typecheck` / `pnpm check:arch-boundary` / `pnpm check:file-size` / `pnpm build` 全绿;`pnpm test` 仅 `updateCheck.test.ts` 两例失败,为 HEAD 既有的发版钉版本测试(断言最新小节 0.2.2,仓库已到 0.2.4),与本改动无关(dirty 文件仅本 spec 涉及的 7 个源文件)。
- 1421 常驻 dev server + Tauri IPC 桩目检(headless Chromium 1440×900):
  - rail 44px 宽、贴窗口右缘、顶起 y=33(titlebar 高)、全内容高;6 面板钮 + 分隔线 + ⋯;顶栏 `.panel-tabs-row` 不复存在;
  - 右区竖线 x=1087 vs 右栏左缘 −4=1086.6,亚像素对齐;
  - ⋯ 菜单向左弹出(右缘 1398.5 ≤ 按钮左缘 1402.5)、整体在视口内、6 行、Esc 关闭;
  - 收起右栏:rail 常驻可见;点 rail「Git」:右栏重开(305px)且 git 面板激活(橙色 active + `data-panel-id` 保留,图标装饰选择器已改指)。
- 真窗口目检(含 Windows 自绘控制带与 rail 共存)待大仙例行验收。

## 修订(2026-09-27 同日)

1. rail 宽度按用户口径两轮收窄:44px → 34px → 30px(26px 钮 + 两侧各 2px,`--tmd-rail-w: 1.875rem`)。
2. ~~⋯ 钉到 rail 顶部~~(已回退:用户口径「多改了」,恢复 tab 组 → 分隔线 → ⋯ 原序)。
3. ~~客户端窗口直角化(macOS `decorations(false)` + React 自绘红绿灯)~~(已回退:恢复 `TitleBarStyle::Overlay` 原生标题栏与系统圆角;round-trip 见 commit c7a02e9 与其回退提交)。
