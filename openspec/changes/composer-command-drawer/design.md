# Design: Composer 命令抽屉

> 交互与视觉基准:`docs/design/composer-drawer-demo.html`(浏览器实测记录见 proposal 验收节)。
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
   * 交互 picker 由幕布内 TUI 接管)→ send;有必需参数或需要任务上下文 → insert。
   * 初判清单与校准记录:openspec/changes/composer-command-drawer/proposal.md §action 初判
   */
  action?: SuggestionAction;
  /** 语义图标名(drawerIcons.tsx 内置集),未声明回退 kind glyph(/ $)。 */
  icon?: string;
  /** 覆盖默认分区标题;缺省按 kind(命令 / 技能)。 */
  group?: string;
  /** 同分区内排序权重,小的在前;缺省按声明顺序。 */
  order?: number;
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
}
```

向后兼容:`CliSuggestion` 的三个消费方(profile 作者、`suggest.ts` 下拉、抽屉)里,下拉只读 `value/description`,新字段对它不可见。

## 2. 数据流

```
cli-* 插件 activate
  └─ registerCliProfile({ suggestions, listSuggestions?, translate?, triggers, … })
        │
useActiveProfile()(composer 已有 hook)
  └─ drawerItems.ts resolveDrawerItems(profile, cwd)
       ├─ kind 派生:profile.triggers 里声明过的 kind 才成区(qoder 无 $ → 无技能区)
       ├─ 来源:静态 suggestions[kind] 与 listSuggestions(kind, cwd) 择一
       │        └─ provider 返回 null / reject → 回退静态;60s 缓存(同 listDirCached 纪律,失败不缓存)
       └─ 排序:order 升序,缺省保持声明序;action 缺省 "insert"
            │
  ┌─────────┴──────────┐
CommandDrawer(消费者 2)   SuggestionList(消费者 1,现状不动)
```

resolver 是模块级纯函数 + 独立缓存 Map(key = `profileId\0kind\0cwd`),与组件生命周期解耦,切换会话/CLI 回来时命中缓存。

## 3. 组件结构(plugins/composer/)

```
view/ComposerToolbar.tsx   「只读」→ 抽屉开关(24×24,aria-expanded,⌘K;置灰当无活跃会话)
view/CommandDrawer.tsx     抽屉本体:head(标题+profile badge+关闭)/ search / 分区列表 / foot 图例
drawerItems.ts             resolveDrawerItems + 缓存(唯一数据入口,UI 不直接摸 profile.suggestions)
drawerIcons.tsx            语义图标集:name → path(初步:clear model help resume history plugins
                           settings sparkles zap clipboard search code review),kind glyph 兜底
```

状态与键盘(全部 demo 已实现,平移):

| 交互 | 实现 |
|---|---|
| 开合 | `isOpen` + `.open` class,transform 260ms cubic-bezier;`prefers-reduced-motion` 降级 |
| 点外关闭 | document pointerdown 捕获,抽屉/开关外即关 |
| Esc / ⌘K | document keydown;⌘K 与 settings.sendShortcut 无冲突(不占 Enter) |
| 过滤 | 受控 input,`render(filter)` 重渲;**开抽屉时先清 filter 再 render**(demo 修过的 bug) |
| ↑↓ Enter | 平铺可见项数组 + activeIndex;Enter 触发点击; ArrowDown/Up 在 input 内 stopPropagation 后走全局 |
| send 点击 | `prepareSendPayload(profile, token)` → `ipc.sessionWrite(sessionId, payload)` → toast → 320ms 后收起(让 flash 动画可见) |
| insert 点击 | 复用 `Composer.insertAtCursor` 同款逻辑(光标处插入 + setSelectionRange + focus) |

**send 的 wire 文本**:command = `/name`,skill = 走 profile 自己的 translate(即把 `$name` 喂给 `prepareSendPayload`,omp → `/skill:name`、grok → `/skills name`、claude → `/name`)。抽屉不出现任何具体语法。

## 4. 与 demo 的对应关系

| demo 元素 | 真实实现 |
|---|---|
| `ITEMS` 数组(含 mode 字段) | `profile.suggestions` + `action` 字段(数据归插件) |
| `ICONS` 按命令名 hardcode 的 map | **demo 简化,不照搬** → `drawerIcons.tsx` 语义集 + kind glyph 兜底 |
| `.mode-tag`(⚡ 直接发送 / ↵ 插入) | 由 `action` 派生的同一 pill 组件 |
| terminal mock + `wireOf()` | 删除;真发送 = `ipc.sessionWrite`,翻译交给 translate |
| toast / flash / 滑入动画 | 原样平移进 CommandDrawer |
| 硬编码 omp badge | `profile.renderIcon?.(12)` + `profile.name` |

## 5. 幕布焦点移交

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

## 6. 测试设计

| 文件 | 覆盖 |
|---|---|
| `drawerItems.test.ts` | 静态/动态合并、null 回退静态、缓存命中(同 key provider 只调一次)、TTL 过期、triggers 派生分区、action/order/group 缺省值 |
| `cli-profiles.contract.test.ts`(新增) | 遍历全部注册 profile:声明的 send 项 ⊆ proposal §初判清单的 bare 合法集合;icon 名 ∈ drawerIcons 导出集。防手滑,也是 M4 实测校准的落点 |
| `composer focus` 判定 | 抽成纯函数 `resolveArrowIntent({ value, matches, isComposing, key })` → "default" \| "handoff",直接单测五行判定顺序 |
