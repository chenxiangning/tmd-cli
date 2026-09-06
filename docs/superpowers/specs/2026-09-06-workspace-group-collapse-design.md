# 左侧工作区会话分类折叠

日期:2026-09-06
状态:已落地(实现随本 spec 提交)

## 背景与目标

工作区卡片展开后,各 CLI 分组(段头 = 品牌 logo + 名称)与其下会话全部平铺,会话多的工作区树过长难扫视。目标:

1. 每个分类(CLI 分组 + 终端 + SSH)可折叠/展开,段头即开关;
2. 折叠态段头右侧显示该组会话数;
3. 默认折叠(缺失记录的组一律折叠,与工作区级折叠键同语义);
4. 折叠态写盘(settings.json),重启恢复。

## 方案取舍

**选定:settings 新键 `workspaceGroupCollapsedMap`。** key = `${workspaceId}:${groupId}`(groupId = CLI profileId 或 `shell` / `ssh`),value = 是否折叠;完整复用 `workspaceCollapsedMap` 的既有语义链:缺失默认 `true`、sanitize 只收 boolean 且限量、`updateSettings` 写盘、重启 sanitize 恢复。

理由:工作区级折叠(`settings.workspaceCollapsedMap`,见 WorkspaceSection)已经把「折叠态 = UI 偏好,落 settings」定为先例;分类折叠是同一偏好的下一层,同形新键零新机制,sanitizer 直接复用。

**否决:写进 workspaces.json 的 Workspace 结构。** 分组折叠是 UI 偏好不是工作区数据;且 workspaces.json 无 sanitize 层,手改脏数据直接进运行时。

**否决:仅 CLI 分组可折叠。** 终端/SSH 组同处一棵树,行为不一致反成视觉噪音;三者共用同一 hook 与段头组件。

计数口径:折叠态显示「展开后可见总数」= 活会话 + 工作区置顶 + 未置顶磁盘历史(global 置顶已离组,不计入);终端/SSH = 活会话数。扫描 hook 折叠时照常运行,计数实时。空组照旧不渲染,计数不为 0。

## 改动面

- `kernel/settingsTypes.ts`:新字段 `workspaceGroupCollapsedMap: Record<string, boolean>` + 默认空表;`settingsSanitize.ts`:新字段复用 `sanitizeWorkspaceCollapsedMap`(同形 Record)。
- `plugins/workspace/`:新增 `useGroupCollapsed.ts`(读/写/默认折叠)与 `GroupHeader.tsx`(段头按钮:logo / 名称 / 计数 / chevron);`CliSessionGroup`、`ShellSessionGroup`、`SshSessionGroup` 接入,折叠时不渲染置顶块/行/「更多」按钮。
- `styles/workspace-sessions.css`:段头按钮化重置 + 计数徽标 + chevron 样式;时间轴段头节点样式不动。

## 验证

`pnpm typecheck && pnpm test && pnpm check:arch-boundary && pnpm check:file-size && pnpm build`;dev server 起真实前端目检:默认全折叠、点段头展开/收起、折叠计数随会话增减、重启(重载)后恢复上次折叠态;原生窗口目检由用户复核。
