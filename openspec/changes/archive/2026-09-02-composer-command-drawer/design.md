# Design: Composer 命令抽屉

> 交互与视觉基准:`docs/design/composer-drawer-demo.html`(浏览器实测记录见 proposal 验收节)。
> 2026-09-03 紧凑化改造后与 demo v2 的差异:标题/搜索/横排 tab 三行移除,分区切换改左缘竖排 rail(顶部关闭、底部计数;二次修订 chip 去文案改图标),抽屉高度自适应内容(上限 = 容器),点外不再自动关闭;demo 保留为 v2 历史对照。
> 本文档把 demo 的每一块映射到真实实现,并补齐 demo 里刻意省略的契约细节。

## 1. 协议层(kernel/cli.ts 增量)

```ts
/** 抽屉点击意图。缺省 "insert":send 会立即写入 PTY,缺省必须选无副作用的一侧。 */
export type SuggestionAction = "send" | "insert";

export interface CliSuggestion {
  value: string;
  description?: string;
  /**
   * 点击行为。判定规则:bare 合法(无必需参数 / 参数可选 / bare 打开的
   * 交互 picker 由幕布内 TUI 接管,如 /model)→ send;有必需参数或需要任务上下文 → insert。
   * 初判清单与校准记录:openspec/changes/composer-command-drawer/proposal.md §action 初判
   */
  action?: SuggestionAction;
  /** 语义图标名(drawerIcons.tsx 内置集),未声明回退 kind glyph(/ $)。 */
  icon?: string;
  /**
   * 完整 wire/插入文本,覆盖按 kind 合成的默认值("/name"、"$name")。
   * 用途:MCP 引用等非标准语法(codex `$github` mention、claude `/mcp` 管理入口)。
   * send 时作为 prepareSendPayload 的输入(translate 仍生效);insert 时原样插入。
   */
  token?: string;
  /** 覆盖默认分区标题;缺省按 kind(命令 / 技能)。 */
  group?: string;
  /** 同分区内排序权重,小的在前;缺省按声明顺序。 */
  order?: number;
}

/* 实现校订(2026-09-02):未引入独立 McpServerRef 接口 —— MCP 项即
   CliSuggestion(带 token/action),协议面保持单一 */
export interface McpServerRef extends CliSuggestion {
  /** MCP 服务器名即 value;desc 建议带传输方式(command/sse)。 */
}

export interface CliProfile {
  // …现有字段不变…
  /**
   * 运行时命令/技能发现(磁盘扫描 / CLI 查询),声明后覆盖静态 suggestions;
   * 返回 null = 回退静态表。对齐 listSessions 惯例:插件自扫,kernel 只给原语。
   */
  listSuggestions?: (
    kind: "command" | "skill",
    cwd: string,
  ) => Promise<CliSuggestion[] | null>;
  /**
   * MCP 服务器发现(读自家 CLI 的配置文件),声明后抽屉出现 MCP 分区。
   * 不声明 = 该 CLI 无此区(qoder/kimi/omp/pi v1 现状)。
   * 本机实证:claude ~/.claude.json mcpServers(+项目级)、codex ~/.codex/config.toml [mcp_servers.*]。
   */
  listMcpServers?: (cwd: string) => Promise<CliSuggestion[] | null>;
}
```

向后兼容:`CliSuggestion` 的三个消费方(profile 作者、`suggest.ts` 下拉、抽屉)里,下拉只读 `value/description`,新字段对它不可见。

## 2. 数据流(四分区)

```
cli-* 插件 activate
  └─ registerCliProfile({ suggestions, listSuggestions?, listMcpServers?, translate?, triggers, … })
        │                                    │
useActiveProfile()                    kernel pluginLifecycle
  └─ drawerItems.ts resolveDrawerItems      └─ listPluginStates()(市场同源)
       ├─ 分区派生:command/skill 由 triggers 声明派生;mcp 由 listMcpServers 声明派生;
       │            plugin 固定存在(feature 类过滤后非空才渲染)
       ├─ 来源:静态表 与 provider 择一;null/reject 回退静态;60s 缓存(失败不缓存)
       └─ 归一为 DrawerItem { section, name, desc, action: send|insert|open, icon, token? }
            │
  ┌──────────┼──────────┬──────────┐
命令(/)   技能($)    MCP      插件
profile    profile    profile   kernel(与 CLI 无关,切会话不变化)
```

- **MCP 点击语义由 profile 声明**(token + action):codex = insert `$<name>`(mention 原生);claude = send `/mcp`(管理入口);qoder 未声明 `listMcpServers`(其 `/mcp-config` 以命令区候选存在)→ 无独立 MCP 分区;omp/pi v1 不声明 → 无该区
- **MCP 数据读取原语已核实**(2026-09-02 查证):`ipc.fsReadFile`(ipc.ts:160)读全文件;claude = JSON.parse,零依赖;codex TOML **不引解析库**,轻量按行提取 `[mcp_servers.<name>]` 头即可(name + command 够用),符合不新增包政策
- **插件分区**:仅 `category: "feature"`;点击 = `filePanel.setFilePanelMode(id)`(git/files 已注册面板);无面板的 feature 插件 = 现成 `settings.openSettingsPanel()`(kernel/settings.ts:333,已核实;section 定位不含,YAGNI)。composer 读内核注册表,无任何插件名硬编码
- resolver 缓存 key = `profileId\0kind\0cwd`;plugin 区不走缓存(直接读内核态,启用态变化即时反映)

## 3. 组件结构(plugins/composer/)

```
view/ComposerToolbar.tsx   「只读」→ 抽屉开关(24×24,aria-expanded,⌘K;置灰当无活跃会话)
view/CommandDrawer.tsx     抽屉本体:左缘竖排图标分区 rail(关闭 + 全部/命令/… + 计数)/ 分区列表 /
                           foot 图例;高度自适应内容(v3 紧凑化,无标题/搜索行;点外不自动关)
drawerItems.ts             resolveDrawerItems + 缓存(唯一数据入口,UI 不直接摸 profile.suggestions
                           / pluginLifecycle)
drawerIcons.tsx            语义图标集:name → path(初步:clear model help resume history plugins
                           settings sparkles zap clipboard search code review server folder gear
                           git-branch),kind glyph 兜底
```

状态与键盘(全部 demo v2 已实现,平移):

| 交互 | 实现 |
|---|---|
| 开合 | `isOpen` + `.open` class,transform 260ms cubic-bezier;`prefers-reduced-motion` 降级 |
| 点外不关闭 | v3.1 修订:失焦/点外不自动关;显式关闭 = 开关按钮 / ⌘K / Esc / rail × |
| 分区切换 | `activeTab: "all" \| section`;左缘竖排图标 rail 只渲染实际有数据的分区(文案进 title/aria-label);打开抽屉时重置为 all(重置先于渲染);单分区视图不重复渲染组头 |
| Esc / ⌘K | document keydown;⌘K 与 settings.sendShortcut 无冲突(不占 Enter) |
| ↑↓ Enter | 平铺可见项数组 + activeIndex;键盘监听挂抽屉容器(搜索框已移除),焦点落在按钮上时 Enter 走原生 click 防双激活 |
| send 点击 | `prepareSendPayload(profile, token)` → `ipc.sessionWrite(sessionId, payload)` → toast → 320ms 后收起(让 flash 动画可见) |
| insert 点击 | 复用 `Composer.insertAtCursor` 同款逻辑(光标处插入 + setSelectionRange + focus) |
| open 点击 | `setFilePanelMode(panelId)` → toast → 收起 |

**send 的 wire 文本**:command = `/name`,skill = 走 profile 自己的 translate(即把 `$name` 喂给 `prepareSendPayload`,omp → `/skill:name`、grok → `/skills name`、claude → `/name`)。抽屉不出现任何具体语法。

## 4. 与 demo 的对应关系

| demo 元素 | 真实实现 |
|---|---|
| `ITEMS` 数组(含 mode / token 字段) | `profile.suggestions` + `action`/`token` 字段(数据归插件);MCP/插件分区为 demo 演示数据 |
| `ICONS` 按命令名 hardcode 的 map | **demo 简化,不照搬** → `drawerIcons.tsx` 语义集 + kind glyph 兜底 |
| `.mode-tag`(⚡ 直接发送 / ↵ 插入 / ⇱ 打开) | 由 `action` 派生的同一 pill 组件 |
| terminal mock + `wireOf()` | 删除;真发送 = `ipc.sessionWrite`,翻译交给 translate |
| toast / flash / 滑入动画 / 切换分区 | 原样平移进 CommandDrawer;分区切换自 v3 为左缘竖排 rail |
| demo 的 head(标题+badge)行 / 搜索框 / 横排 tab 行 | v3 移除;关闭移入 rail 顶部,计数移入 rail 底部,高度自适应内容 |

## 5. send 与手动发送同路径(零拦截)

抽屉 send 只是把 `token ?? char+name` 喂给现有 `sendCurrent` 同一条链(`prepareSendPayload → ipc.sessionWrite`);用户手敲 `/model` 回车不经任何 composer 解析、确认或拦截。透传铁律(`cli.ts` 头注释)在抽屉场景零例外。

## 6. 幕布焦点移交

`messageAnchors.ts`(现成注册表,锚点栏在用):

```ts
export interface TerminalHandle {
  // …现有 buffer/scroll 方法…
  /** xterm 聚焦。composer 空输入 ↑↓ 移交用;无 handle 时调用方静默返回。 */
  focus(): void;
}
```

TerminalView 注册处补一行 `focus: () => termRef.current?.focus()`(同款写法已在 closeSearch 出现)。

composer 的 `onKeyDown` 判定顺序(**顺序即契约**):

```
1. IME 组合中(e.nativeEvent.isComposing)            → 不移交
2. suggestion 下拉打开(matches 非空)                → 下拉自己的 ↑↓,不移交
3. settings.sendShortcut 的 Enter 分支               → 现状不变
4. ↑/↓ 且 value === ""(trim 后)                    → preventDefault + getTerminalHandle(sid)?.focus()
5. 其余                                              → 浏览器默认(光标移动)
```

- 只认"完全空":有草稿时 ↑↓ 是光标移动,抢走会打断编辑
- 幕布拿到焦点后,↑↓ 经 xterm → PTY 原生透传,语义归 CLI(kimi 历史回溯 / 选择等),tmd 不解释
- 焦点移交是纯前端行为,零 IPC;`getTerminalHandle` 无 handle(会话未挂载)时静默

## 7. 测试设计

| 文件 | 覆盖 |
|---|---|
| `drawerItems.test.ts` | 静态/动态合并、null 回退静态、缓存命中(同 key provider 只调一次)、TTL 过期、triggers 派生分区、MCP 区按 listMcpServers 派生、action 缺省 insert、token 覆盖默认合成、order/group 缺省值 |
| `drawerPlugins.test.ts` | 插件分区 = listPluginStates() ∩ feature 类;点击映射 setFilePanelMode;禁用插件不出现 |
| `cli-profiles.contract.test.ts`(新增) | 遍历全部注册 profile:声明的 send 项 ⊆ proposal §初判清单的 bare 合法集合;icon 名 ∈ drawerIcons 导出集;token 项的 action 必须显式声明。防手滑,也是 M4 实测校准的落点 |
| `composer focus` 判定 | 抽成纯函数 `resolveArrowIntent({ value, matches, isComposing, key })` → "default" \| "handoff",直接单测五行判定顺序 |
