# 插件市场（插排）设计文档

日期：2026-09-02
状态：已确认（用户确认原型与 PLAN）
原型：`docs/prototypes/plugin-market-strip.html`（已浏览器验证 dark/light + 插拔交互）

## 1. 背景与目标

tmd-cli 的架构铁律是"一切能力皆插件，内核只做宿主"（`src/kernel/plugin.ts`），
但当前 10 个内置插件（`src/plugins/index.ts`）编译期注册、运行期一次性激活，
用户无法感知更无法管理插件。

目标：

1. titlebar「回到首页」左侧新增「插件市场」入口 icon。
2. 点击打开独立的插件市场页，采用**插排**视觉隐喻：
   客户端 = 插排本体，插件 = 插头。
3. 用户可在页面对插件进行插拔（停用/启用），核心插件焊死不可拔。
4. 页面底部预留「在线市场」占位区（远程安装为后续阶段，本期不做）。

## 2. 关键决策

| 决策点 | 结论 | 理由 |
|---|---|---|
| 页面边界 | 内置插件管理器 + 预留市场 | 运行时无外部代码加载能力，真远程市场工作量大一个数量级（用户选定） |
| 拔插语义 | 停用持久化，**重启生效** | `activateAll` 一次性组装，无反注册机制；热拔插会泄漏 PTY 监听/事件订阅。插排隐喻"断电需合闸"诚实传达该语义 |
| 核心插件 | `welcome` / `settings` / `composer` 焊死 | 无 welcome 则无首页兜底；无 settings 失去配置面；无 composer 无法输入（用户选定"核心插件保护"） |
| 页面形态 | 替换中央主区（非 overlay 弹层） | "独立页面"语义；关闭即回原位（session 现场不丢） |
| 入口位置 | titlebar 左区：折叠侧栏 \| **插件市场** \| 回到首页 | 与现有两个 action 同构（26×22 titlebar-action） |

## 3. 架构与数据流

```
┌─ titlebar Plug icon ──────────────┐
│  onClick → marketOpen = true      │
└──────────────┬────────────────────┘
               ▼
AppShell: marketOpen ? <PluginMarketPage/> : 原三栏主区
               ▼
PluginMarketPage 读取 host.listPluginStates()
  = allPlugins 元数据 × settings.disabledPlugins 的 join
               ▼
插拔 → updateSettings({ disabledPlugins }) → 持久化(config.json / localStorage)
               ▼
下次启动 main.tsx → host.activateAll(allPlugins 过滤 disabled 后)
```

### 3.1 内核契约扩展（`src/kernel/plugin.ts`）

```ts
export interface PluginMeta {
  /** 显示名,如 "Claude Code"。 */
  name: string;
  /** 一句话能力描述,插排页卡片用。 */
  desc: string;
  /** 插头/卡片的两个字母缩写(monogram),如 "CC"。 */
  abbr: string;
  /** true = 焊死的核心插件,市场页不可拔。 */
  core?: boolean;
}

export interface Plugin {
  readonly id: string;
  readonly meta: PluginMeta;   // 新增,必填
  readonly dependsOn?: readonly string[];
  activate(ctx: PluginContext): void | Promise<void>;
  deactivate?(): void;
}
```

### 3.2 设置持久化（`src/kernel/settings.ts`）

- `AppSettings` 新增 `disabledPlugins: string[]`，默认 `[]`。
- `sanitize` 清洗：仅保留非空字符串、去重、排序（手改 JSON 兜底，确定性）。
- 现有未知字段被 sanitize 丢弃的行为天然兼容旧配置（无迁移）。

### 3.3 宿主过滤（`src/kernel/host.ts`）

- `activateAll(plugins)` 入口过滤：`getSettingsState().settings.disabledPlugins`
  命中的插件不进入激活循环（连同其 dependents 自然跳过——依赖等待逻辑已有）。
- 新增 `listPluginStates(): { plugin, enabled }[]`：把"注册清单 × disabled 集合"
  join 成市场页可直接消费的结构。注意：`activateAll` 之后才可知全量清单，
  未激活（disabled）的插件也要出现在列表里，因此清单来源是 `allPlugins`
  传入时的快照，而非 `this.plugins`（已激活集合）。

### 3.4 启动时序约束

`main.tsx` 当前顺序：`ensureSettingsBooted()` 异步 load，随后立即
`host.activateAll(allPlugins)`。settings load 是异步的 → 过滤时必须拿到
**已落盘的 disabledPlugins**。方案：`activateAll` 等待 settings 首载完成
（settings.ts 暴露 `settingsReady: Promise<void>`，`ensureSettingsBooted` 赋值，
`load()` resolve）。无新依赖，单次 await。

## 4. UI 设计（插排页）

布局自上而下（视觉规范全部来自 design-tokens.md `--tmd-*`，见原型）：

1. **页头**：标题「插件市场」+ 副标题「客户端是插排，插件是插头 —— 插上即用，拔掉即停」+ 关闭按钮。
2. **插排场景**：
   - 插排本体：长条圆角面板（`--tmd-bg-elevated` + `--tmd-border-strong`），
     左端品牌区「tmd-cli / 客户端·插排本体 / 总电源 LED 常亮」，右端电缆接出。
   - 插座单元 × N：孔位面板（两个插孔槽）+ 插头（monogram 图标 + 名称 +
     状态 LED + 双插脚 + 顶部走线 SVG）。
   - 插入态：插头贴面、LED 亮（accent glow）。
   - 拔出态：插头上浮 34px、旋转 -4°、降透明度/饱和度、LED 熄灭、插脚露出。
   - 焊死态：左上 🔒，hover 抖动（weld-shake keyframes），cursor not-allowed。
   - 插拔过渡：`transform .22s cubic-bezier(.34,1.56,.64,1)`（回弹手感）。
3. **插件清单**：卡片网格（图标/名称/id/描述/徽章/插拔按钮），与插排状态联动；
   dirty（当前态 ≠ 启动态）显示「重启后生效」徽章。
4. **在线市场**：虚线边框占位面板，文案「远程插件市场 · 建设中」+ disabled 按钮。
5. **Toast**：插拔后底部弹出「已拔出 cli-codex —— 重启后从插排断电」。

交互：点插头或卡片按钮 toggle；核心插件点击仅抖动提示。

## 5. 文件改动清单

| 文件 | 改动 |
|---|---|
| `src/kernel/plugin.ts` | +`PluginMeta`，`Plugin.meta` 必填 |
| `src/kernel/settings.ts` | +`disabledPlugins`、sanitize、`settingsReady` |
| `src/kernel/settings.test.ts` | +disabledPlugins 清洗用例 |
| `src/kernel/host.ts` | activateAll 等 settingsReady 并过滤 disabled；+`listPluginStates()` |
| `src/kernel/host.test.ts` | +过滤/列表用例 |
| `src/plugins/*/index.tsx` ×10 | 各补 `meta` 字面量 |
| `src/app-shell/PluginMarketPage.tsx` | 新页面（移植原型） |
| `src/styles/*.css` | 插排页样式（沿用现有样式组织方式） |
| `src/app-shell/AppShell.tsx` | titlebar +Plug icon；`marketOpen` 状态；主区条件渲染 |

## 6. 错误处理

- settings 读取失败：沿用现有 sanitize 回落（disabledPlugins = []，即全启用，
  失败安全方向 = 插件可用）。
- 持久化失败：现有 persist catch → console.warn，UI 态仍在（重启丢失，可接受）。
- 手改 config 写入未知插件 id：sanitize 不裁剪（内核不认识注册表外的 id 无害）；
  host 过滤时仅对清单内 id 生效。

## 7. 测试策略

- `settings.test.ts`：disabledPlugins 清洗（非字符串剔除、去重、缺省回落）。
- `host.test.ts`：activateAll 跳过 disabled；dependsOn 依赖被禁用时 dependent 亦不激活；
  listPluginStates 返回全量（含 disabled）。
- 手动 smoke：`pnpm dev` 起 app → 开市场页 → 拔 cli-codex → toast → 重启 app →
  codex 引擎不出现（welcome 引擎卡/侧栏分组消失）→ 插回 → 重启恢复。

## 8. 非目标（YAGNI）

- 远程插件源 / 下载 / 签名 / 沙箱（预留 UI 占位）。
- 运行期热拔插（deactivate 完整实现）。
- 插件排序、搜索、分类（10 个内置插件无需）。
