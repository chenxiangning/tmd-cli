# 工作区双菜单 UI 重排评审(提交收口)

日期:2026-10-08
状态:已收口(门禁全绿 + 桩目检双态确认)

## 范围

纯 UI 布局重排,功能零改动,4 文件 +146/-52:

- `src/plugins/workspace/WorkspaceAddDialog.tsx` + `src/styles/workspace-add.css` —— 添加工作区浮层视觉打磨
- `src/plugins/workspace/SessionMenu.tsx` + `src/styles/workspace-menu.css` —— 新建会话菜单压高重排

## 改动清单与动机

| 改动 | 动机 |
|---|---|
| 浮层关闭图标 `Cross` → `X` | `Cross` 渲染成 ✚ 十字,在「添加工作区」标题旁形似「再加一个」,语义误导 |
| 浮层标题栏加 1px 底部分隔线 | 头部与来源卡片区缺层次 |
| 浮层卡片 hover 三联动(描边 accent / 图标块反色 / 箭头着色右移) | 整卡可点语义弱,hover 反馈只有灰底 |
| 引擎区两列网格(`wsmenu-grid`/`wsmenu-cell`) | 10 引擎纵排 10 行致菜单 592px 溢出滚动;两列后 431px 一屏全览 |
| 刷新钮收格内右上角角标 | 原行尾 ⟳ 与两列布局冲突;角标位 `padding-right: 26px` 防长名叠字 |
| 「设置别名」「删除工作区」并排(`wsmenu-ops`) | 再省一行;`canRemove=false` 时 flex 拉满自动独占整行 |
| 分区标题 12px/600/字距 0.05em/faint 色 | 与 13px/500 菜单项拉开层级 |
| 危险项 hover 淡红染(`color-mix(err 12%)`) | 与普通行灰底区分;`:not(.is-armed)` 保武装态反色优先 |

## 评审结论

已核,无阻塞问题:

1. `wsmenu-item-row` 仍被 welcome `VersionMenu.tsx` 消费 —— 旧规则保留未动,新增类不借不占。
2. 窄菜单(min-width 256px)并排两操作项:每格约 119px,「删除工作区」5 字 13px + 图标 + padding 约 103px,不触发行换行(label nowrap ellipsis 兜底),桩目检确认。
3. 触摸设备兜底:`@media (hover: none)` 下刷新钮常显,动作不可达风险关闭。
4. i18n 零新词条;键盘路径 `.wsmenu-cell:focus-within` 与行 hover 同权显形刷新钮。
5. 危险红染经 vite lightningcss 编译为 `var(--tmd-err)` + `@supports` 回退,计算样式实测 `color(srgb … / 0.12)`。

留档 nit(不修):格内角标 ⟳ 与右邻格视觉间距偏近(目检图 omp 格刷新钮贴近 pi 格图标),系 `right: 4px` 相对格缘所致;若后续嫌挤,格间 gap 2px → 6px 一行可调。

## 验证

- `pnpm typecheck` / `pnpm test`(3771 全绿)/ `pnpm build` / `pnpm check:file-size` / `pnpm check:arch-boundary` 全绿
- `npx react-doctor@latest -y` 100/100
- 1421 桩目检(深色主题):菜单 592→431px 零滚动、10 格 2 列 5 行、格 hover 刷新 opacity 0→1、危险项红染、浮层 X 图标与 hover 三联动均实渲确认
