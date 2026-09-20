# 增强提示词(composer 增强入口)设计

- 日期:2026-09-21
- 状态:已确认(大仙拍板:引擎全 8 家 / 模型自由文本)

## 背景与目标

composer 左下 inputRail 现有三个图标(assets 唤醒双图标 + 平铺广播),尾部缺一个「增强提示词」入口:把输入框草稿交给一次性 CLI 改写成更清晰的提示词,并排对照后一键回填。交互参照 mossx 的 PromptEnhancerDialog(图 2:引擎选择 + 强度三档 + 开始增强 + 高级设置折叠 + 左右双栏 + 保留/使用双按钮)。

## 方案取舍

| 决策点 | 选定 | 被否决 | 理由 |
|---|---|---|---|
| 落位 | 新插件 `src/plugins/prompt-enhancer/`,经 `ctx.contribute("composer.inputRail", order 50)` 挂图标 | 塞进 composer 插件 | 新增 UI 能力标准路径;inputRail 挂点本就是跨插件贡献面(assets order 0 / composer 广播 order 40) |
| 引擎面 | 8 家静态 adapter 表(claude/codex/omp/pi/opencode/kimi/qoder/grok),本机逐一 `--help` 实证均有一次性模式 | 仅 claude+codex(mossx 同款) | 大仙拍板;新增引擎 = 表内加一行 |
| 一次性执行 | 既有 `proc_communicate` 通用原语(`closeStdin: true`,prompt 走 argv,超时强杀) | 新增 Rust 命令 / 复用 PTY 会话 | Rust 零改动;PTY 会话过重且污染会话列表 |
| 模型选择 | 高级设置内自由文本,空 = CLI 默认(旗标按家:`--model` claude/omp/pi,`-m` 其余) | 截图式模型 chip + 每引擎静态模型表 | tmd-cli 无模型清单知识源,建表即造私有格式;自由文本零知识成本 |
| 草稿读写 | kernel `composerExt` 新增 `composerDraftRef`(读)+ `composerReplaceRef`(整替)两个模块级 ref 桥,Composer 挂载期交接 | 跨插件读 `#composer-textarea` DOM | 同 `composerInsertRef` 先例;DOM id 耦合脆弱 |
| 指令语言 | 固定中文指令(指令要求保留草稿原语言) | 按界面语言切 zh/en 指令(mossx 做法) | 改写质量与指令语言弱相关;少一套分支 |
| 强度档 | 三档:轻润色(只整理措辞,短句不扩写)/ 结构化(小节重组,不虚构)/ 可执行(≤6 行短句,只留约束与交付格式),共享 base 指令 | mossx 单档 | 图 2 明示三档 |
| 对话框骨架 | kernel `DialogShell` + `StyledSelect` + 手写 footer 双按钮 | 自绘 overlay / `DialogActions` | DialogShell 是弹层既定原语;DialogActions 的「取消」文案钉死不合「保留原始版本」语义 |

错误文案分类(超时 / 空结果 / 非零退出附 stderr)移植 mossx 的 kind 思路但收敛为三态字符串,不建错误类。

## 验证

- 门禁:`pnpm typecheck && pnpm test && pnpm check:arch-boundary && pnpm check:file-size && pnpm build`
- 单测:`enhanceEngines.test.ts` 钉 argv 组装(prompt 位置/模型旗标/空模型省略)、三档指令差异、围栏剥离、超时钳制
- 真实冒烟:本机 `claude -p` 实跑一条改写指令验证端到端 stdout 文本
- 目检:1421 dev 桩确认 inputRail 第五图标与对话框交互(浅色主题基准)
- 收口:`npx react-doctor@latest -y` = 100
