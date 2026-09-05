# 会话 tab 右键菜单:重命名 + 关闭一套(与文件 tab 同一套 icon)

日期:2026-09-05
状态:已评审通过(用户定向:关闭一套 icon 复刻文件 tab;重命名项纳入)

## 背景与目标

会话标题 tab 条(2026-09-03 落地)只有点击切换与 × 摘 tab 两个交互;对照浏览器/编辑器的 tab 惯例,缺右键菜单。文件 tab 条已有现成范式(`app-shell/TabContextMenu.tsx`:关闭 / 关闭其他 tab / 关闭全部 tab,wsmenu 视觉)。

目标:

1. 会话 tab 右键弹出上下文菜单,项集:**重命名 → 关闭(X) → 关闭其他 tab(SquareX) → 关闭全部 tab(XCircle)**,icon 与文案完全复刻文件 tab 菜单;
2. 重命名走行内输入(与侧栏会话行同一契约),写 settings.sessionTitles 覆盖层,改名即时生效;
3. 关闭语义与 × 一致:**摘 tab 不杀会话**,PTY 继续跑,侧栏仍在。

## 方案取舍

**选定:扩展 `TabContextMenu`,不新建 SessionTabContextMenu。** 加可选 `onRename` / `canRename` 两个 prop(传则首项显示「重命名」);文件 tab 侧不传,行为不变。依据:仓库铁律「同惯例不开第二套」;菜单视觉、portal/backdrop/Escape 范式、视口夹取全部复用, diff 面最小。

**选定:`RenameInput` 从 `plugins/workspace/SessionRows` 沉淀进 `kernel/RenameInput.tsx`。** 会话 tab 条(app-shell)与侧栏(workspace 插件)同时消费行内重命名,按「跨插件基础契约先进 kernel」规则上移;新增 `className` prop(默认 `thread-rename-input`,tab 传 `session-tab-rename-input`)解耦样式钩子。SessionList / PinnedSessions / SessionRows 三处 import 改指 kernel,SessionRows 内的旧定义删除(干净切走,不留 re-export)。

**否决:tab 重命名用弹窗/popover 输入。** 侧栏已确立行内重命名惯例(Enter/blur 提交,Escape 取消),tab 场景同构即可,第二种交互范式只会增加学习成本。

**否决:右键菜单加 Reload 项。** 截图里的 Reload 是浏览器语义;PTY 会话的「重载」= 杀进程重开,状态(滚动回溯、进程内上下文)全丢,与用户对 tab 菜单的预期不符,需求方也未把它列入选定项。

### 语义细节

- **重命名可用性**:仅当会话已绑定磁盘身份(`host.getCliSessionId(id)` 非空)时可用;未落盘会话菜单项 disabled + title 提示「会话尚未落盘,暂不可命名」——与侧栏「未落盘不可命名」同一契约(覆盖层以 CLI 身份为 key)。
- **批量关闭**:`closeOtherSessionTabs(id)` 只留目标,活跃 tab 被一并摘掉时指针切到保留 id;目标不在条内 / 仅剩一个时静默无操作。`closeAllSessionTabs()` 摘尽,活跃会话在条内时指针置 null 回 welcome。两者都不杀会话。
- **竞态防御**:菜单存活期会话可能退出——重命名入口双重检查 meta 与磁盘身份;提交时复查会话存活,已退出则丢弃输入(覆盖层不残留)。
- **重命名态**:该 tab 的标签替换为输入框(× 同时隐藏),失焦提交、Escape 取消、空串清除命名回归默认标题。

## 改动面

| 文件 | 改动 |
|---|---|
| `kernel/sessionTabs.ts` | 新增 `closeOtherSessionTabs` / `closeAllSessionTabs`(摘 tab 语义,活跃指针切换/置 null) |
| `kernel/sessionTabs.test.ts` | 批量摘 tab 契约测试:指针切换、目标即活跃不动指针、单 tab 无操作、ghost id 空操作、摘尽回 welcome |
| `kernel/RenameInput.tsx`(新) | 行内重命名输入 + `RenameTarget` 上移 kernel,加 `className` prop |
| `plugins/workspace/SessionRows.tsx` | 删除 RenameInput/RenameTarget 旧定义,改引 kernel |
| `plugins/workspace/SessionList.tsx` / `PinnedSessions.tsx` | import 改指 `@kernel/RenameInput` |
| `app-shell/TabContextMenu.tsx` | 可选 `onRename`/`canRename` 首项(Pencil icon);夹取高度按项数(3 项 120 / 4 项 150) |
| `app-shell/SessionTabBar.tsx` | tab 挂 onContextMenu;菜单接线四项;重命名态行内输入;标题解析收敛为 `resolveTitle` |
| `styles/titlebar.css` | `.session-tab-rename-input`(复刻 thread-rename-input 聚焦边语义,尺寸随 24px tab) |

## 验证

`pnpm typecheck && pnpm test && pnpm check:arch-boundary && pnpm check:file-size && pnpm build` 全绿(779 tests,含新增 4 项批量关闭契约)。`pnpm tauri:dev` 真窗已起;自动化截图与辅助访问被 macOS 权限拦截,交互目检在真窗手动完成:右键弹菜单四项 icon 齐全、未落盘会话重命名禁用、重命名行内输入 Enter/blur/Escape、关闭其他/全部的活跃指针切换、文件 tab 菜单回归(无重命名项)。
