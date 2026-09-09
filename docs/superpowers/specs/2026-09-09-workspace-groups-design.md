# 工作区分组:侧栏分组 + 设置页管理 + 右键移动(参考 codemoss)

日期:2026-09-09
状态:已确认(用户拍板范围 = 三件套;实现随本 spec 提交)

## 背景与目标

tmd-cli 工作区数量增长后侧栏一平到底,缺乏归属组织手段。codemoss 已有成熟的
工作区分组实现(`src/features/workspaces/hooks/useWorkspaces.ts` 单一落点),
本特性按 codemoss 蓝本移植,裁剪掉 tmd-cli 无对应物的部分。

用户拍板范围(**三件套**):

1. 设置页组管理(新建 / 重命名 / 删除 / 上移下移);
2. 侧栏按组渲染 + 组头折叠(持久化);
3. 工作区行右键菜单「移动到组」。

明确不做:组内拖拽排序(仓库无 DnD 依赖,要时另议)、copiesFolder(codemoss
克隆副本目录,tmd-cli 无克隆特性)、MainHeader/GitHistory 等分组消费(无对应
页面)、组头计数与组头右键菜单。

## 方案取舍

**选定:groupId 落 workspaces.json,组定义与折叠落 settings.json。**

- `WorkspaceMeta` 增加 `groupId?: string | null`(Rust `session.rs` 加
  `group_id: Option<String>`,`#[serde(default)]` 向后兼容)——与 codemoss
  `workspace.settings.groupId` 同构,工作区归属跟随工作区本体持久化。
- `settings.json` 增加 `workspaceGroups: { id, name }[]`(数组顺序即显示顺序,
  组上移/下移 = 数组换位,**不需要 codemoss 的 sortOrder 字段**)与
  `workspaceGroupCollapsedMap: Record<string, boolean>`(照
  `workspaceCollapsedMap` 现有 sanitize 模式)。纯前端 schema,Rust 透传零改动。
- 组内工作区顺序 = workspaces.json 数组顺序(即现状添加顺序),不做组内排序。

**否决:全部塞 settings.json**(groupId 用 workspaceId→groupId 映射表)。零
Rust 改动但引入双写一致性负担(删工作区要清映射),且与 codemoss 蓝本不同构,
后续对照维护成本高。

**否决:组内 DnD 排序。** codemoss 用 sortable list 需 @dnd-kit;仓库零 DnD
依赖,组内排序需求未证实,先按添加顺序。

## 设计

### Kernel(仅持久化拥有者,分组语义留在插件)

- `kernel/ipc.ts`:`WorkspaceMeta` 加 `groupId?: string | null`。
- `kernel/workspace.ts`:`Workspace` 同步字段;新增
  `assignWorkspaceGroup(workspaceId, groupId | null)`——改 list 后
  `configWriteWorkspaces` 持久化。
- `kernel/settingsTypes.ts` / `settingsSanitize.ts` / 默认值:
  `workspaceGroups`(sanitize:id/name 非空字符串才保留)与
  `workspaceGroupCollapsedMap`(照 `workspaceCollapsedMap` 只收 boolean)。

### 插件:`src/plugins/workspace/groups.ts`(新增,分组语义唯一落点)

- `useGroupedWorkspaces()` 派生 `{ ungrouped: Workspace[], named: { group, workspaces }[] }`:
  按 groupId 分桶,桶内保持数组序;非法 groupId(组已删)归未分组(只读兜底,
  不回写);侧栏跳过空命名组。
- CRUD(校验同 codemoss):`createGroup` / `renameGroup`(trim、大小写不敏感
  重名拒绝、保留名「未分组/Ungrouped」禁用)/ `deleteGroup`(组内工作区
  groupId 全归 null 落回未分组)/ `moveGroup(id, "up" | "down")` /
  `assignToGroup(workspaceId, groupId | null)`。

### 侧栏渲染(`workspace/index.tsx`)

未分组桶直挂列表顶(无组头,同 codemoss),命名组按 settings 数组序跟随后:
组头 = 折叠箭头 + 组名(无计数无右键),整行点击切折叠,存
`workspaceGroupCollapsedMap`;组内照常渲染 `WorkspaceCard`。现有「全部折叠/
展开」caption 按钮语义不变(只管卡片内会话折叠)。

### 右键菜单(`SessionMenu.tsx` overlay)

底部加「移动到组」分区:「未分组」+ 各组名,当前组打勾;仅当
`workspaceGroups.length > 0` 时出现(codemoss 同款条件)。无 worktree 分支。

### 设置页

workspace 插件 `ctx.registerSettingsSection` 注册「工作区分组」section:
顶部新建输入框 + 组行列表(名称内联编辑、上移/下移、删除——确认提示组内工作区
将移到未分组),复用现有设置页样式类。

### i18n

`t()` 新键:组管理标题、新建占位、删除确认、移动到组、未分组。en/ja 双语。

## 验证

- `groups.ts` 配 `groups.test.ts`:分桶顺序、非法 groupId 兜底、重名/保留名
  拒绝、删组回落未分组、moveGroup 换位;`kernel/workspace.test.ts` 补
  `assignWorkspaceGroup` 持久化断言。对标现有测试风格。
- `pnpm typecheck && pnpm test && pnpm check:arch-boundary && pnpm check:file-size && pnpm build`;Rust `cargo test && cargo clippy --all-targets -- -D warnings && cargo fmt --check`。
- 桩目检(1421 dev server):建组 → 右键移动工作区 → 折叠组 → reload 恢复。
