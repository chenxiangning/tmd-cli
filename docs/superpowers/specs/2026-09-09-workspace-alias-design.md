# 工作区别名:显示名覆盖(行内重命名)

日期:2026-09-09
状态:已落地(commit 9ed4911)

## 背景与目标

工作区显示名 = 目录末段(`deriveWorkspaceName`),用户不可改。两目录同名(如多个 fork/worktree 副本)或目录名不符合语义(仓库名是代号、实际是「支付后端」)时,侧栏/钉住/运行区/welcome 各处全显示同一个目录名,无法区分。

目标:给工作区一个可选**别名**,作为纯显示层覆盖——别名非空则处处显示别名,清空则回归目录名。身份字段(id / root)不动,会话扫描、锚点、恢复零感知。

参考实现:codemoss `WorkspaceSettings.projectAlias`(已核对其类型/展示/弹窗全链)。交互形态与生效范围已与用户确认:**行内重命名**(沿用会话重命名惯例)+ **全部展示位**生效。

## 方案取舍

**选定:别名进 Workspace 记录。** `Workspace` 增 `alias: string | null`;Rust `WorkspaceMeta` 同步增 `#[serde(default)] pub alias: Option<String>`(约 3 行,serde camelCase 自动映射,旧 `workspaces.json` 无该字段照常反序列化)。理由:别名随工作区记录生死,`removeWorkspace` 自动清理,数据归属正确。

**否决:settings 存 `workspaceId → alias` 映射**(零 Rust 改动)。代价:需要 sanitize 函数、removeWorkspace 孤儿清理、语义散落两处文件——省 3 行 Rust,多写 20 行配套代码,数据归属错位。

**否决:弹窗表单(照搬 codemoss WorkspaceAliasPrompt)。** tmd-cli 会话已有行内重命名先例(kernel `RenameInput`:Enter/blur 提交、Escape 取消、空值 = 清除),工作区照此办理交互一致且无弹层;弹窗的信息量(标题/副标题/错误槽)对单个输入框属冗余。

## 设计

### kernel 契约(src/kernel/workspace.ts)

```ts
export interface Workspace {
  // ...existing
  /** 显示名覆盖;null/空 = 显示目录名。trim 后落库。 */
  alias: string | null;
}

/** 设置别名:trim,空串清为 null;不可变替换列表项 + persist + emit。 */
export function setWorkspaceAlias(id: string, raw: string): void;

/** 全部展示位的唯一取名口:alias 非空取 alias,否则 name。 */
export function workspaceDisplayName(ws: Workspace): string;
```

`RenameInput`(kernel 共享重命名 UI)的 `target` 类型从 `RenameTarget`(profileId/cliSessionId/current)收窄为 `{ current: string }`——现有两个会话调用方传完整对象,结构兼容零改动;「空值 = 回归磁盘原生标题」语义与别名清除同构,直接复用。`loadFromDisk` 对旧文件条目归一化 `alias: w.alias ?? null`,保证字段恒为 `string | null`。

### UI(src/plugins/workspace/)

- 入口:`SessionMenuOverlay` 工作区操作组新增「设置别名」项(PencilSimple 图标,置于「删除工作区」上方);点击 → 关菜单 → 该卡片行进入重命名态。
- 受控:`WorkspaceSection` 持有 `renamingId: string | null`,经 props 下发 `renaming` / 进入与退出回调(与 collapsed 受控同模式;菜单与卡片跨组件,不走模块级 ref 桥)。
- `WorkspaceCard`:renaming 时 `RenameInput` 替换名称文本;名称 span 补 `title={root}`,别名化后原路径仍可查看。双击仍是折叠切换,不动。

### 展示位全量替换(一处帮助函数,五处消费)

| 消费点 | 现状 |
|---|---|
| `WorkspaceCard.tsx` 行名 | `workspace.name` |
| `PinnedSessions.tsx` 行文本 + title | `row.workspace.name` |
| `RunningZone.tsx` 行文本 + title | `row.workspace.name` |
| `welcome/RecentSessions.tsx` 分组名 | `group.workspace.name` |
| `app-shell/RightPanelToolbar.tsx` git 右栏标签 | 由 root 推导、不经 workspace——按 `getWorkspaces()` 查 root 命中后取 `workspaceDisplayName`,未命中维持原推导 |

别名非空时全 app 无处显示目录名——同名目录问题即此消除。

### 词条

`locales/{en,ja}/workspace.ts` 各补「设置别名」一条;zh 源串即键。

### 不做(YAGNI)

- 「别」角标(codemoss 有):tooltip 已可见原路径,行宽紧张。
- 双击重命名、F2 快捷键:入口唯一(菜单),需要再议。
- 别名参与任何身份/排序/匹配逻辑:纯显示字段。

## 改动面与验证

改动:`kernel/workspace.ts`(+约 30 行)、`kernel/RenameInput.tsx`(类型收窄)、`plugins/workspace/` 四文件、`plugins/welcome/RecentSessions.tsx`、`app-shell/RightPanelToolbar.tsx`、`src-tauri/src/session.rs`(+3 行)、locales 两文件、`kernel/workspace.test.ts`。

验证:

1. `kernel/workspace.test.ts` 增用例:setWorkspaceAlias trim/空值清除/emit;persistence 往返含 alias;`workspaceDisplayName` 兜底(无 alias / 空 alias);loadFromDisk 兼容旧文件(无 alias 字段)。
2. Rust 侧 `cargo test`(serde 往返含旧格式无 alias)。
3. 前端全链:`pnpm typecheck && pnpm test && pnpm check:arch-boundary && pnpm check:file-size && pnpm build`。
4. `pnpm tauri:dev` 目检:菜单设置别名 → 卡片/钉住/运行区/welcome/git 标签同步切换;清空别名回归目录名;重启后别名仍在。

## 实现对照(落地后回写)

- `alias` 落为**可选字段**(`alias?: string | null`),`loadFromDisk` 不归一化——与同文件 `groupId` 先例一致,旧数据兼容由单测钉住。
- `RightPanelToolbar` 不再维持 `deriveWorkspaceLabel(root)`:激活工作区对象直取 `workspaceDisplayName` 后大写化;因 store 原地变更(列表项引用不变),`useMemo` 会滞 stale,标签改为每次渲染直接计算,`deriveWorkspaceLabel` 与 `deriveWorkspaceName` 导入随之删除。
- `RenameInput` 除 `target` 收窄外,另加可选 `placeholder`(默认会话文案,工作区传「别名(留空清除)」)。
- 目检走 1421 vite dev + 浏览器桩(双同名工作区),验证菜单入口、行内重命名、trim 提交、持久化载荷、title 原路径;Escape/清除路径由 `workspace.test.ts` 5 条用例锁 store 语义。
- 落地时并行会话的工作区分组特性尚在途:本提交经 hash-object 手术只含别名 hunks(14 文件 +141/-21),分组 WIP 未动。
