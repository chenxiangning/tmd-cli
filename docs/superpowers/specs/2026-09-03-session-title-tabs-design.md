# 会话标题 tab 条:顶栏中央同时展示打开的会话

日期:2026-09-03
状态:已评审通过(用户定向:顶栏中间、最多 4 个、外观页可关)

## 背景与目标

多会话并行是本客户端的核心场景,但切会话目前只有左侧栏一条路径:会话行折叠在工作区分组里,层级深;顶栏中央(`header.breadcrumb` 右侧)长期空白。

目标:

1. 顶栏中央新增会话 tab 条,同时展示最多 **4 个**已打开会话;点击切换活跃会话,活跃 tab 高亮;
2. tab 标题与会话列表同优先级(手动命名 > 打开时捕获的标题快照 > 短码),改名即时生效;
3. tab 条可在 设置 / 基础设置 / 外观 里整体关闭(`sessionTabsEnabled`,默认开)。

## 方案取舍

**选定:内核 MRU store + 事件驱动,零侵入 host。** 新增 `kernel/sessionTabs.ts`,订阅 `KernelTopics.activeSessionChanged` 与 `sessionsChanged`。依据:host 中所有打开/聚焦路径(spawn、恢复磁盘会话、侧栏点活会话、删除后隐式切换)最终都收敛到 `activeSessionChanged` 广播,store 纯事件驱动即可拿到「打开」事实,host 与全部调用点一行不改。

**否决:host 内嵌 tab 状态。** host.ts 已 452 行(500 行铁则),且 tab 条是展示层导航态,不是会话服务职责。

**否决:tab 列表持久化。** PTY 会话不跨应用重启存活,持久化只能恢复出死 id,纯垃圾状态。

**否决:tab 渲染时读磁盘解析原生标题。** 每 tab 一次 `listSessions` 磁盘扫描,顶栏高频渲染路径不可接受。改为**打开时捕获标题快照**:点击处(侧栏活行/置顶行/欢迎页最近会话)本就持有解析好的标题,一行 `noteSessionTabTitle` 随手喂给 store;之后改名走 settings 覆盖层(响应式),快照仅兜底。

### 语义细节

- **打开次序稳定**:新打开的会话追加到队尾;重复聚焦不重排(避免 tab 跳动);超过 4 个时挤掉最早打开的 tab(会话本身不受影响,仍在左侧栏)。
- **关闭 = 摘 tab 不杀会话**:tab 的 × 只把会话从 tab 条摘掉,PTY 继续跑;若摘的是活跃 tab,自动切到剩余 tab 中最近打开的一个,没有则回 welcome(与「回到首页」同语义)。杀会话仍归侧栏右键菜单。
- **存活跟随**:`sessionsChanged` 时剪除已不存在的 id(会话被删/进程退出,tab 同步消失)。
- **性能**:store 内存态 ≤4 id + 标题快照(跟随存活剪除);组件三个订阅(host 版本号 / settings / tab store)均为 O(1) 快照,host.notify 不在 PTY 输出热路径上;tab DOM ≤4 个,标题单行 ellipsis,溢出不撑破顶栏。空态与关闭开关下渲染 null。

## 改动面

| 文件 | 改动 |
|---|---|
| `kernel/sessionTabs.ts`(新) | MRU store:cap 4、打开去重、存活剪除、标题快照、`closeSessionTab` |
| `kernel/sessionTabs.test.ts`(新) | 打开次序/上限挤除/稳定位/剪除/关闭切换 |
| `kernel/settings.ts` | `sessionTabsEnabled: boolean`(默认 true)+ sanitize 布尔兜底 |
| `kernel/sessionTitles.ts` | 沉淀 `shortId()`(原 workspace 私有 util,现跨层共用);workspace 侧改引内核 |
| `app-shell/SessionTabBar.tsx`(新) | tab 条组件:标题解析、活跃高亮、未读点、× 摘除 |
| `app-shell/contributions.tsx` | `header.breadcrumb` 挂点注册(order 200,面包屑之后) |
| `styles/titlebar.css` | `.session-tabs` 段(复用 `--tmd-*` tokens,按钮自动继承 no-drag) |
| `plugins/settings/BasicAppearanceTab.tsx` | 外观页「会话标题 tab」pref-row(segmented 开启/关闭,复用现有类零新 CSS) |
| `main.tsx` | `bootSessionTabs(host.events)` 与其余 boot 并列 |

挂点复用 `header.breadcrumb`(契约注释即「工作区-会话导航区」),不新增 MountPoint 类型,对既有贡献者零破坏。

## 验证

`pnpm typecheck && pnpm test && pnpm check:arch-boundary && pnpm check:file-size && pnpm build` 全绿;`pnpm tauri:dev` 真窗目检:开 4+ 会话看挤除、切会话高亮、× 摘除不杀会话、改名即时反映、外观页关闭后 tab 条消失、顶栏拖拽区不被 tab 条阻断。
