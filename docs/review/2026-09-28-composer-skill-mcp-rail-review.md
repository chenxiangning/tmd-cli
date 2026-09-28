# Composer 技能/MCP 唤醒双图标设计评审与裁决(2026-09-28)

> 评审对象:`docs/superpowers/specs/2026-09-28-composer-skill-mcp-rail-design.md` v1。
> 评审组成:交互/设计视角 + 代码契约视角 两路独立评审,仲裁事实全部本机/仓库内复核。
> **结论:BLOCK → 已裁决修订为 v2。** 两条 P0(两阶段渲染竞态、Sparkle 撞形)、十条 P1、七条 P2,全部落裁决;方案骨架(复用抽屉做分区直达、隐藏优于置灰、否决独立浮层)成立不动。
> 裁决已回写:spec v2 + 调研文档 §3.2/§7 四处事实更正。

## 0. tmd-cli 自有设计裁决基准(本次评审起生效)

tmd 是多 CLI 客户端,没有现成行业规范覆盖「一个客户端管十家 CLI 的 skill/MCP 交互」,裁决基准自定并沉淀如下,后续同类设计照此对表:

1. **图标诚实性**:输入轨/面板图标即能力探针 —— 只在能力实证存在时亮,隐藏优于置灰,置灰优于报错;远程会话下本机数据不可信则不亮。
2. **单一真相交互**:已有弹层/抽屉能承载就不造第二个浮层;同一行为只有一个入口语义(⌘K、工具条、轨图标指向同一抽屉状态机)。
3. **数据可判后才落位**:UI 一次性决策(落哪个分区)必须等数据解析完成,不得在静态第一拍消费一次性状态。
4. **点击即所见**:点击向幕布写的命令名必须有实证出处(仓库 academy 目录/二进制取证),未实证降级为展示性条目并明示。
5. **一次消费的状态不许悬留**:一次性请求状态(如 requestedSection)消费、关闭、超时三处都要有清理路径。
6. **图标同排不撞形**:同一图标行内不出现两枚同形异义图标;锚点图标(轨 ↔ 抽屉分区)的语义优先,冲突方让路换形。
7. **300 行铁则是设计约束不是补丁**:方案改动面表必须报行数账,临界文件(≥285 行)新增逻辑前先算账或换拆分路线。
8. **格式知识就近沉淀**:同一磁盘格式 ≥2 家消费即下沉 `cli-shared/`,解析器带契约单测。

## 1. 分维度结论(两路评审合并)

| 维度 | 结论 | 关键证据 |
|---|---|---|
| 双图标语义与主流语言 | 有条件过 → Sparkle 锚点保留、撞形方换图标 | Sparkle=技能符合 claude.ai/Copilot 星芒惯例;与抽屉 `SECTION_TAB_ICONS` 同源锚点成立;但 `prompt-enhancer/EnhanceButton.tsx` order 50 已用 SparkleIcon 且无条件渲染 |
| 随能力显隐 | 过 | 显隐先例充分(平铺广播钮自门控、工具条 remoteEngine 门控);追加行尾不位移既有图标 |
| 抽屉分区直达心智动线 | 基本过,落位竞态为实缺陷 | 复用抽屉避免双真相交互;两阶段渲染(先静态后异步)下「打开瞬间消费 requestedSection」在 claude(静态 skill 表为空)上必然失效 |
| 边界三态 | 欢迎页过;远程会话/空分区需裁决 | 无会话不挂 composer,图标天然不存在;远程引擎会话扫本机磁盘 = 假探针;空分区兜底被竞态破坏 |
| 窄屏排布 | 过,否决 flex-wrap | 满配 6 钮≈168px,320px 宽富余近半;换行垂直跳动比溢出更糟 |
| 状态机完备性 | 不过 → 已定义 | `drawerOpen.setDrawerOpen` 早退 `open===next` 使「已开时点另一图标」静默失效且 requestedSection 悬留到下次 ⌘K |
| 仓库事实准确性 | 不过 → 已更正三处 | qoder 已声明 `$` skill 触发(`qoderPlugin.tsx:57-61`,契约测试钉死);spec 误写「qoder 未声明」;omp `/mcp` 17 子命令、grok `/mcps` 在仓库 academy 目录已有实证,spec「无实证」为假 |
| 实现面正确性 | 有条件过 | railSections store 属多余(组件可直接 `useActiveProfile()`);Composer.tsx 299 行,原方案加 effect 必破 300 铁则;CSS 归属 composer-anchors.css 正确但需报行数账 |
| 三家引擎格式 | 大体过,两处更正 | kimi 旧居双扫无据(`~/.kimi/` 只有 `[mcp.client]` 超时残留,无 mcp.json);qoder 真相源本机实证为 `~/.qoder/shared_client/mcp.json`(标准 `mcpServers` 形状),原「未知项不赌」理由作废 |
| i18n/铁律/边界 | 过 | en/ja 结构对齐;别名与相对路径惯例对齐;新增文件均小;CommandDrawer 260→~280 行安全 |
| Mounts order 排序 | 过(实证) | `hostRegistry.test.ts:127` 钉住按 order 升序返回 |
| kimi/grok 点击命令 | 实机复核后维持/更正 | kimi dist 取证:`/mcp` = "Show MCP server status"(spec 对),`/mcp-config` 是配置面;grok academy 取证 `/mcps`(spec 的 insert 降级过度,应 send) |

## 2. P0 裁决(两条)

### P0-1 两阶段渲染竞态 → 裁决:落位改为「数据可判后一次性落位」

证据:`useComposerDrawer.ts:65-76` 两阶段(先静态后异步动态);`cli-claude/index.tsx:197-200` claude 静态 `skill: []`;CommandDrawer 打开重置 effect 依赖 `[open]`,消费瞬间 items 只有第一拍静态表甚至空 → requestedSection 被「无条目」误判 → 回落「全部」,第二拍技能条目到达时 tab 已定死。spec 自己的验证 2 按原实现必败。
裁决:CommandDrawer 持 `pendingSection` 状态;`useComposerDrawer` 暴露动态解析完成信号(`drawerResolved`);已解析且分区有条目 → 落该分区,否则回落「全部」;items 变化时当前 tab 不在新 sections 内顺手归一「全部」(覆盖抽屉开着切会话)。单测加 claude 形状用例(静态空 + 异步有,断言最终停 skill)。

### P0-2 Sparkle 撞形 → 裁决:技能保 Sparkle(锚点优先),prompt-enhancer 换 Wand

证据:输入轨将出现相邻两枚同形异义按钮(增强对话框 vs 抽屉技能区),靠 hover title 试错,击穿「语义自明」。
裁决:采纳「锚点不动、撞形方让路」—— 技能轨图标与抽屉分区图标同源是方案核心论证,`prompt-enhancer` 语义是「改写/增强」,换 `Wand`(Phosphor),同步其对话框与插件市场元数据图标。两枚同形图标禁止实施。

## 3. P1 裁决(十条:交互原编 6 + 契约侧补 4)

| # | 问题 | 裁决 |
|---|---|---|
| P1-1 | 远程引擎会话假探针 | 可见性规则加一条:`isRemoteEngineSession` 为真双图标不出现(与铁律「缺失不猜测」一致);远端文件读取经 ssh 通道成立前不放开,记遗留 |
| P1-2 | kimi `/mcp` vs `/mcp-config` 矛盾 | 实机取证两者并存:`/mcp` 状态面板(dist 字符串实证)、`/mcp-config` 配置面。spec 的 send `/mcp` 维持;调研文档同步补记 |
| P1-3 | 已开状态机未定义 + 早退冲突 | `setDrawerOpen(next, section?)`:带 section 时绕过 `open===next` 早退并 emit;已开@A 点 B = 即时切区;已开@A 点 A = 关闭(对齐 ⌘K toggle 惯例);任何关闭清 requestedSection。单测覆盖三路径 |
| P1-4 | 事实错误:qoder 已声明 `$` skill | 背景改为「无技能触发符 = dsh(triggers 空)/ opencode(仅 `/` `@`)」;spec 给出完整可见性矩阵 |
| P1-5 | railSections store 多余 + Composer 破 300 行 | 删。RailWakeIcons 直接 `useActiveProfile()` + `declaredSections()` 派生;Composer.tsx 零改动(299 行不破线) |
| P1-6 | 格式知识未下沉 | TOML `[mcp_servers.*]` 解析下沉 `cli-shared/tomlMcp.ts`(codex 重构消费 + grok 新消费,2 家满足准入);带契约单测 |
| P1-7 | qoder 遗漏 | `~/.qoder/shared_client/mcp.json` 本机实证标准形状,「未知不赌」作废 → 经 `qoderPlugin.tsx` 共享工厂加适配器(双分发版一次覆盖);TUI 命令未实证 → 展示性条目,验证后升级 |
| P1-8 | kimi 旧居双扫无据 | 删。扫描源 = `~/.kimi-code/mcp.json` + `<cwd>/.kimi-code/mcp.json`(项目覆盖);缺失 = 空(不回落旧居) |
| P1-9 | omp/grok 点击语义错 | omp `/mcp`(academy 实证 17 子命令)→ action send;grok `/mcps`(academy 实证)→ action send。调研文档两处更正 |
| P1-10 | 适配器描述串未计入 i18n | 「全局/项目」复用现有键;「仅展示 · 无引用语法」等新串补 en/ja |

(P1 按合并后十条计数;交互评审原编六条,契约评审补充四条。)

## 4. P2 裁决(七条)

title 改「技能($)/MCP 服务器」(不带图标名,对齐资产图标注记惯例);补 `aria-controls="command-drawer"` + `aria-expanded`(对齐工具条先例);否决 flex-wrap(改 320px 目检确认 nowrap);抽屉开着切会话的 tab 归一(并入 P0-1 落位机制);展示性条目 description 前置「无引用语法」;`composer-anchors.css` 232 行 +15 = 247 行安全(报账);「插入后不关抽屉」的例外**否决**(给 insert 分支加特例不值, ponytail)。

## 5. 不回改项(评审中考虑过、裁决不动)

toggleDrawer 语义不改(⌘K 仍是开合不带分区);抽屉右缘锚定位置不改(空间呼应弱点可接受,贴图标弹出会引入定位抖动);HardDrive 图标语义偏「磁盘」不改(库内一致性优先,换 server 类破坏锚点);
远程会话下**抽屉本体**的本地扫描错误不修(既有洞,非本 spec 引入,图标隐藏已止血;修复属另一个提案)。
