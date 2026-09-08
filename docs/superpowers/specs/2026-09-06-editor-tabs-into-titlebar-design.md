# 编辑 tab 条上移顶栏:与会话 tab 合并一行(双激活并存)

- 日期:2026-09-06
- 状态:已落地(实现随本 spec 提交)

## 背景与目标

编辑区(文件/记忆/diff 等 tab 的容器)自带一行表头,叠在顶栏之下形成第二排 tab(用户截图圈注:.gitignore / tmd-cli / Magic Context 一行)。用户裁决:不好看,取消第二排。

目标:全部编辑 tab 与会话 tab 合并进顶部窗体头部同一行 tab 栏;编辑栏只留内容区。非目标:不动四栏布局、不动 kernel/tabs 激活语义、不动快捷键。

## 方案取舍

**选定:tab 条上移 + 双激活并存。**

- 会话 tab 管中央幕布显示哪个会话,编辑 tab 管编辑栏显示哪个文件,两个激活高亮并存、互不打断。
- 保留"左边看终端跑、右边看文件"的并排工作流(现役高频用法)。
- 改动面最小:tab 条迁出 + 挂点注册 + CSS 重写,AppShell 布局与 panel 结构零改动。

**否决:单激活 VS Code 式**(顶部一条 tab 同一时刻只激活一个,点文件 tab 时中央幕布整块换成文件内容、编辑栏消失)。理由:失去并排工作流;中央路由(MainPanel)、editorMaximized 语义、四栏 panel 布局全要重做,改动面与收益不成比。两案经用户二选一确认,选定双激活。

**否决:保留原位仅微调样式。** 不解决"第二排"本身,不满足诉求。

## 方案落点

1. 新件 `src/app-shell/EditorTabStrip.tsx`:FileTabIcon / FileTab / 右键菜单(TabContextMenu)/ 最大化切换自 EditorCenter 原样迁入;无 tab 时返回 null。
2. `contributions.tsx` 挂 `header.breadcrumb` order 300,排在会话 tab 条(order 200)右侧、面包屑(order 100)之后 —— 沿既有挂点,TopBar 零改动。
3. `EditorCenter.tsx` 只留 kind 路由内容区与空态,表头整行删除。
4. `tab-bar.css` 重写为顶栏比例:24px 圆角条,与会话 tab 同视觉语言(hover/active 背景、label ellipsis、detach/close 按钮 hover 或激活时显隐,同 `.session-tab-remove` 节奏);与会话 tab 的间距由 `.titlebar-center` gap 提供(用户复核:不加竖线)。溢出走马灯:滚轮竖向增量转横向 `scrollLeft`(EditorTabStrip onWheel),滚动条 CSS 隐藏。
5. 语义不变项:kernel/tabs store、⌘W 关闭激活 tab、Ctrl+Tab 轮换、脏标记圆点、右键菜单项集、editorMaximized。
6. 追加(同日用户复核):会话 tab 前置引擎品牌 logo —— `host.getCliProfile(meta.profileId)?.renderIcon?.(12)`,与侧栏分组段头/新建会话菜单同源;`.session-tab-switch > svg` 防挤压。

## 验证

- `pnpm typecheck` / `pnpm test`(120 文件 935 用例)/ `check:arch-boundary` / `check:file-size` / `pnpm build` 全绿。
- 浏览器桩目检(vite 1421 + `__TAURI_INTERNALS__` IPC 桩,页面上下文 import `/src/kernel/*.ts` 驱动真实 store):
  - 顶栏单行呈现 [面包屑 | 会话 tab ×3(带引擎 logo)| 编辑 tab ×8],`.tab-bar` 在 `.titlebar-center`,编辑栏 `#editor` 内无任何 `.tab-bar`(第二排消失);
  - tab 条 `border-left` 计算值 0px(竖线已除);
  - 8 tab 溢出(scrollWidth > clientWidth)时派发 WheelEvent(deltaY 240)→ `scrollLeft` 0→240,滚动条不可见;
  - 注入 profileId claude/omp/kimi 假会话 → 每个会话 tab 前各渲染一枚品牌 SVG logo;
  - 点 tab 切激活、× 关闭、激活 tab 内容(CodeMirror)正常渲染。
- kernel/tabs 与交互逻辑零改动,纯挂点迁移,不新增测试。
