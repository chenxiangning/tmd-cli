# 插排徽标升级:CLI 品牌字形 + 功能模块彩色语义图标

日期:2026-09-03
状态:已评审通过(用户确认配色取向:CLI 跟随主题单色;功能图标独立彩色)

## 背景与目标

插件市场页(插排)目前所有插头一律渲染 `meta.abbr` 两字母 monogram(会话列表预算甚至是"预算"两个汉字)。问题:CLI 插件没有品牌辨识度,功能插件的字母缩写不符合直觉语义。

目标:

1. CLI 引擎 8 位换用**品牌 logo**(项目内已有现成字形组件,与欢迎页引擎卡/侧栏会话行同源);
2. 界面功能 + 核心系统 8 位换用**语义 icon**(lucide),各图标独立彩色;
3. 插排视图与清单列表视图同步生效。

## 方案取舍

**选定:插件自声明。** `PluginMeta` 增加两个可选字段,16 个插件各自声明徽标:

```ts
export interface PluginMeta {
  // ...existing
  /** 插头/卡片徽标组件(品牌字形或 lucide 语义图标),渲染时兜底回退 abbr。 */
  icon?: ComponentType<{ size?: number }>;
  /** 徽标颜色(CSS color 值),施加在容器上经 currentColor 传导;缺省跟随主题 accent。 */
  iconColor?: string;
}
```

理由:符合"一切能力皆插件"架构,新插件自带徽标、市场页零映射表;现有 Glyph 组件签名 `({ size })` 与字段直接吻合,CLI 侧零新代码。

**否决:市场页集中映射表**(id→图标)。qoder 变体的 profile id 来自常量、无法按 `cli-` 前缀反查;且新插件需要回头改市场页,契约被倒置。

## 图标映射(定稿)

### CLI 引擎 · 8 位 —— 复用已有品牌字形,按官方品牌色着色(修订)

字形组件不内部改色,统一经 meta.iconColor 施加(容器 currentColor 传导):

| 插件 | 组件 | iconColor | 依据 |
|---|---|---|---|
| cli-omp | `OmpGlyph` | —(字形自带粉紫→蓝渐变) | 上游 hero 标志 |
| cli-pi | `PiGlyph` | —(跟随主题;官方品牌色无权威来源,暂缺) | — |
| cli-kimi | `KimiGlyph` | `#1783FF` | Moonshot 官方 Branding-Guide k-only-light.svg 实测 |
| cli-codex | `CodexGlyph` | `var(--tmd-fg)` | OpenAI 单色品牌:浅色黑/深色白 |
| cli-claude | `ClaudeGlyph` | —(字形自带品牌橙 #D97757) | vendored 官方日芒标志 |
| cli-grok | `GrokGlyph` | `var(--tmd-fg)` | xAI 单色品牌:浅色黑/深色白 |
| cli-qoder | `QoderGlyph` | `var(--tmd-fg)` | 官方 favicon 实测单色 #0F0D0C(浅)/反白(深) |
| cli-qoder-cn | `QoderGlyph` | `var(--tmd-fg)` | 同上 |

注:品牌色只作用于插件市场页(meta 层);侧栏会话行/欢迎页等处 renderIcon 仍跟随主题色,维持全局单色语言。

### 界面功能 + 核心系统 · 9 位 —— lucide 语义图标 + 独立彩色

取中明度色值,深浅主题均可读:

| 插件 | 图标 | 语义 | iconColor |
|---|---|---|---|
| workspace 工作区 | `FolderOpen` | 工作目录容器 | `#5B8BE8` 蓝 |
| session-budget 预算 | `Gauge` | 配额仪表(替掉汉字"预算") | `#E8B84D` 金 |
| files 文件编辑 | `FilePen` | 文件+书写 | `#4DAF7C` 绿 |
| git | `GitBranch` | 分支 | `#F05032` Git 官方橙红 |
| checkpoints 批次审批 | `History` | 快照回溯(实现时新增的第 17 位插件) | `#2FB8AD` 青 |
| network-proxy | `Network` | 代理拓扑 | `#45B8C8` 青 |
| composer 输入区 | `SquarePen` | 输入框 | `#A78BFA` 紫 |
| settings 设置 | `Settings` | 齿轮 | `#9AA5B1` 中性灰 |
| welcome 欢迎页 | `House` | 首页 | `#E36BD4` 粉 |

## 渲染与样式

- 消费点两处:`PluginMarketPage.tsx` 插排视图 `pm-plug-icon` 与清单视图 `pm-card-icon`,渲染 `meta.icon ? <meta.icon size={...}/> : meta.abbr` 兜底。
- `iconColor` 施加在容器 span 的 inline style 上;lucide(stroke=currentColor)与品牌字形(fill=currentColor)统一继承。缺省走现有 CSS accent 色。
- 软色块底、LED、焊死锁标、插拔动画全部不动。
- CSS 小调:`plugin-market.css` / `plugin-market-cards.css` 补 svg 尺寸约束;`.is-out` 拔出态对 `iconColor` 彩色图标补降透明度(现规则靠 color 变灰,对 inline style 无效)。

## 改动面与验证

改动:`kernel/plugin.ts` 契约、16 个插件 meta 各 1–2 行、`PluginMarketPage.tsx` 两处渲染、两个 css 文件。

纯渲染变更,无数据流/错误处理变化。验证:`tsc` + vitest 全量回归(`host.plugins.test.ts` 自建合成 meta,可选字段不破坏契约)+ 打开插件市场目检:插排/列表两视图、拔出态、核心焊死态。
