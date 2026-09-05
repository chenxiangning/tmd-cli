# 类似客户端产品盘点(GitHub)

日期:2026-09-06
状态:完成(对标观察清单,非选题决策)
范围:截至 2026-09-06 公开 GitHub 上以「多 CLI 编码 Agent 桌面宿主 / 多 Agent 协同」为主轴的开源项目。纯单 CLI wrapper、纯 IDE 插件、纯 SaaS 不在此列;闭源商业产品(Cursor、Windsurf、Claude Desktop 官方等)仅作背景对照,不入表。

---

## 结论先行

1. 同类产品「同时支持多家 CLI Agent」已成 2026 上半年的明确赛道,GitHub 上 1k+ star 的项目 ≥ 6 个,赛道热度被 OpenDesign、cc-switch、codeg 三家分别从「设计 / 切换器 / 工作站」三面同时拉动。
2. tmd-cli 的核心定位(**「插件化多 CLI 桌面客户端 + 原始终端幕布 + 离线优先 + 9 引擎 + 19 个 plugin + 完整工程面板」**)在六家公开竞品里几乎没有完全重合:最近的是 codeg 和 desktop-cc-gui,前者侧重多 Agent 协同 + 移动端,后者侧重工程面板 + Project Map / Memory。
3. tmd-cli 已经在 6 个关键差异化维度(原始终端幕布 xterm.js、SSH 一等会话、审批线 + 守卫、quotas/额度 chip、网络代理面板、插件市场可视化插排)上领先或持平;落后于 cc-switch(provider 配置统一管理 + 团队赞助规模)和 desktop-cc-gui(Prompt Enhancer + Project Map 等纵深能力)。
4. 没有「完美竞品」:每个项目都有自己的权衡(详见下文「核心差异矩阵」)。选题上不需慌张对标,但值得把 cc-switch 的 provider preset / desktop-cc-gui 的纵深面板作为下一阶段看齐方向。

---

## 一、同类开源项目清单(详细)

> 排序按 GitHub stars 由高到低(数据采集于 2026-09-06);只列主项目,不列 fork。

### 1. cc-switch — farion1231/cc-switch

- 仓库:<https://github.com/farion1231/cc-switch> · 主页:<https://ccswitch.io>
- License:MIT · 平台:Windows / macOS / Linux · 技术栈:**Rust + Tauri 2** + 前端
- Star:**131,209**(本盘点最高,被 Trendshift 收录)
- 创建:2025-08 · 最近发布:v3.16.x(2026-09 持续更新)
- 一句话定位:Claude Code / Codex / Gemini / Grok / OpenCode / OpenClaw / Hermes 等 8 个 CLI 的「All-in-One 提供商切换器 + MCP/Skills 统一面板」。

**核心能力**

- 50+ provider preset(AWS Bedrock、NVIDIA NIM、PackyCode 等社区中转站),可视化一键切换
- 通用 provider 跨 Claude Code / Codex / Gemini 同步
- 统一 MCP 面板(双向同步 + Deep Link 导入)
- 跨 CLI 的 Prompts(CLAUDE.md / AGENTS.md / GEMINI.md)与 Skills 一键安装 / GitHub 仓库源
- 系统托盘快捷切换;Dropbox / OneDrive / iCloud / WebDAV 云同步
- 本地代理 + 热切换 + 熔断 + 健康监控;会话管理器 / 工作区(OpenClaw)
- 用量仪表板:token、请求、趋势、请求日志、按模型计费

**关键借鉴价值**

- **provider preset 模式**:把社区里碎片的中转站预先打成可一键导入的配置,tmd-cli 目前只在欢迎页做凭据盘点,没做 provider preset —— 这是一处明显的产品差距。
- **统一 MCP / Skills 跨 CLI 同步**:tmd-cli 的插件市场目前只管 tmd-cli 自身插件,不接管各 CLI 自带的 MCP / Skills 配置;竞品已实现了跨 CLI 统一面板。
- **「Shared Config Snippet」** 处理 provider 切换时的私有配置丢失问题。

**关键短板(相对 tmd-cli)**

- 不做会话本身的 GUI(它就是切换器,不是工作站);没有原始终端幕布、没有工程面板。
- 没有审批线 / Checkpoints;没有 SSH 远程;没有内置终端。

---

### 2. desktop-cc-gui — zhukunpenglinyutong/desktop-cc-gui

- 仓库:<https://github.com/zhukunpenglinyutong/desktop-cc-gui> · 主页:<https://www.mossx.ai/download>
- License:MIT · 平台:macOS / Windows / Linux · 技术栈:**Tauri 2 + React 19 + TypeScript + Rust + Vite 7 + Tailwind 4**(与 tmd-cli 同代)
- Star:4,159 · 创建:2026-02 · 最近 push:2026-09-04
- 一句话定位:Claude Code / Codex / Gemini / OpenCode / **DeepSeek Harness(DSH)** 等多家 CLI 的「多引擎桌面客户端」,**与 tmd-cli 定位最接近**。

**核心能力**

- 注册 runtime adapter(Claude Code、Codex、Gemini、OpenCode、DSH),每个引擎在 GUI 里是平起平坐的一等公民
- **DSH 作为原生 runtime**:可挂接已在跑的本地 `dsh web` host,或自启一个 host 来对话;模型与凭据留在 DSH 端
- `@` 文件引用 / `/` 命令 / 粘贴图片 / 附件 / 内置 terminal / Git 面板 / Worktree
- **Prompt Enhancer**(内置 AI 润色用户输入)
- **Project Map**(扫描项目构建交互式知识图谱,增量更新)
- **Project Memory**(`@@` 引用 + 显式 Memory Reference 检索)
- **Context Ledger**(可视化当前回合的上下文来源 + token 估算 + 新鲜度 + 归因置信度)
- 用量统计 / 21 个 VS Code 派生主题 / 10 语言 / Composer / 面板 / 导航 / 文件操作可配快捷键
- Browser Agent(只读浏览 + 快照)
- in-app 自动更新
- 8k+ star 的 OpenSpec 工作流(`openspec/changes/`、`openspec/specs/`、`openspec/docs/` 分层管理),中文 / 英文双 README

**关键借鉴价值**

- **`src/features/<能力>` 平铺**:每个能力一个独立目录,UI-only 改 feature 内,需要 Rust 支持就新增 `#[tauri::command]` 并注册到 `command_registry.rs`。tmd-cli 的 kernel / plugins 分层是更严肃的方案,但 feature 子树独立原则可借鉴。
- **Prompt Enhancer**:内置一个轻模型把用户输入润色成更适合 Agent 的提示 —— tmd-cli 现在只做了 `translate` 钩子(`$skill` → `/skill:skill`),没做润色能力。
- **Project Map**:对超大型项目(数百文件)构建知识图谱,Agent 检索时可定向查找 —— tmd-cli 的 `@` 触发器是 fs 索引 + 模糊匹配,没做语义索引。
- **Context Ledger**:把当前会话「谁贡献了哪些上下文」可视化展示 —— 这是 tmd-cli 的事件归因(审批线)想达到但没专门建面的方向。

**关键短板(相对 tmd-cli)**

- 没有「不渲染」的原始终端幕布(README 强调"no more staring at a black terminal",实质是舍弃了 raw 模式),tmd-cli 反向坚持 xterm.js 原始透传 —— 是 tmd-cli 的差异化坚持
- 没有 SSH 一等会话(SSH 不在它的引擎清单里);没有审批线 + 守卫
- 引擎数量少:tmd-cli 已注册 9 个 CLI engine,desktop-cc-gui 是 5 个;qoder / pi / kimi / grok / omp 没在支持列
- 没有插件市场(README 明说"Coming Soon");tmd-cli 的 19 个 plugin + 插排可视化已成体系

---

### 3. codeg — xintaofei/codeg

- 仓库:<https://github.com/xintaofei/codeg> · 主页:<https://docs.codeg.app>
- License:Apache-2.0 · 平台:macOS / Windows / Linux + **Web Service + Docker + iOS/Android** · 技术栈:Rust(主语言为 Rust,与 tmd-cli 一样)
- Star:3,223 · 创建:2026-02 · 最近 push:2026-09-05
- 一句话定位:**多 Agent 协同编码工作站** —— 把 Claude Code / Codex / Gemini / OpenCode / Cline / Hermes / CodeBuddy / Kimi / Pi / Grok / Cursor / DeepSeek Harness / Qoder / Antigravity 等 15 家统一接入,主打「`@` 提及跨 Agent 委托」+ To-do 看板 + 移动端。

**核心能力**

- 15 个内置 Agent + 可注册任意 ACP(Agent Client Protocol)兼容 Agent —— 比 tmd-cli 的 plugin 体系更聚焦在「CLI Agent 接入」本身
- **`@` 提及跨 Agent 委托**:同一条消息里 `@claude @codex`,两个 Agent 在自己会话里并行跑,流式回到主线程
- 子 Agent 卡片:Claude Code / Codex / Grok / OpenCode 拉子会话时,每个子任务是独立卡片,实时更新
- **To-do 看板**:每个 To-do 自带 git worktree + 自有分支;多任务并行,完成后进 review 列;通过 `git` 校验合并状态,失败回 review
- **Split View**:中央可拆出任意多的 tab 群组(支持左右 / 上下 / 网格),布局持久化(含草稿)
- **Office 文档 in-tab 实时预览**(`.pptx` / `.docx` / `.xlsx`),自带 `officecli` 二进制 —— 与 tmd-cli 的 docx/pdf 预览同构但更深度
- 完整 Git 客户端(commit / fetch / pull / push / stash / rebase / merge / 三路冲突编辑器 / worktree 流程)
- 失败回合分类(connection / access / limit / rejection / service)+ 工具条提示 + Retry / Reconnect / Sign in
- token 用量统计全维度(趋势 / 缓存命中 / 文件夹 / Agent / 模型 / 会话)
- **Telegram / 飞书 / 微信 / Discord / QQ 频道桥**
- iOS / Android 原生客户端(open source)连接到 desktop 的 Web Service

**关键借鉴价值**

- **ACP(Agent Client Protocol)**:用协议而不是硬编码来接入第三方 Agent。tmd-cli 当前用 `Plugin` 接口 + 各 CLI profile 适配,本质同构但没提炼成协议文档。codeg 把这套契约名化为「Agent Client Protocol」,值得借鉴做对外宣传。
- **`@` 跨 Agent 委托**:同一条消息挂多个 Agent,各自并行跑。tmd-cli 当前是「一个会话一个 CLI」,跨 CLI 协同未做;短期内不一定要做,但属于可选项。
- **失败回合分类 + Reconnect + retry 视觉**:tmd-cli 现在会话退出只删日志,没分类,没 Retry 按钮。
- **to-do 看板 + 自带 worktree**:每个任务独占 worktree,落地前由 Agent 跑 lint / build。tmd-cli 没做独立工作区(worktree)层面。

**关键短板(相对 tmd-cli)**

- 同样没有「raw terminal」,所有 CLI 输出经他们自己的 React 层渲染 —— 失去 TUI 的逐字节保真
- 没 SSH 远程;没审批线 + Checkpoints;没原始终端幕布
- License Apache-2.0 但**桌面包体积巨大**(实测单端 ~150 MB+);tmd-cli 的 portable-pty + Rust 内核更轻

---

### 4. open-design — nexu-io/open-design

- 仓库:<https://github.com/nexu-io/open-design> · 主页:<https://open-design.ai>
- License:Apache-2.0 · 平台:macOS / Windows / Linux · 技术栈:TypeScript(Bun) + Electron
- Star:94,281(注意:Star 数量异常高,被广泛宣传/刷榜,但项目活跃度高)
- 创建:2026-04 · 最近 push:2026-09-05
- 一句话定位:**Claude Design 的开源平替** —— 把任意 Agent(Claude Code / Codex / DeepSeek Harness / OpenCode / Cursor / Copilot / Hermes / Kimi 等 26 个)变成「设计引擎」,专门生成 prototype / 文档 / 仪表盘 / PPT / 视频。

**核心能力**

- 26 个编码 Agent 的 runtime(20+ 通过 MCP,4 个 Native Runtime 其中包括 DSH)
- Brand-grade `DESIGN.md`(151 个内置 design system package;新包可加 manifest.json / tokens.css / 组件 / 资产 / provenance)
- 100+ functional skills / 277 plugins / 39 Seedance 提示词 / 93 图像提示词
- 输出 artifact 6 类:prototype / deck / mobile / image / document / HyperFrame(HTML→MP4)
- 沙箱 iframe 预览 + HTML / PDF / PPTX / MP4 导出
- BYOK proxy:`POST /api/proxy/{anthropic,openai,azure,google,ollama,senseaudio}/stream`,SSRF 守护
- 5 个 SSRF 守护 + 300+ 模态模型 Atlas Cloud 聚合

**核心特征**

- 这是「**Agent-Native 设计工具**」,不是「编码工作站」,所以它和 tmd-cli 不在同一类;但它对「多 Agent 接入」的思路(`apps/daemon/src/runtimes/defs/` 注册)与 tmd-cli 的 plugin 注册同构,可借鉴 daemon-style 注册表 + adapter 模式

**关键短板(相对 tmd-cli)**

- 几乎不面向纯编码用户(它的核心价值是设计/产物导出,而非软件工程)
- 不做原始终端、不做工程面板;Electron 而非 Tauri

---

### 5. cc-haha — NanmiCoder/cc-haha

- 仓库:<https://github.com/NanmiCoder/cc-haha> · 主页:<https://cchaha.ai>
- License:MIT · 平台:macOS / Windows / Linux · 技术栈:**Electron + React + Vite + Bun + Ink + Commander.js + Anthropic SDK**
- Star:14,287 · 创建:2026-03 · 最近 push:2026-09-05
- 一句话定位:**桌面 Claude Code 工作站**(号称"Claude Code 桌面版"),覆盖多会话工作区 + 内置浏览器预览 + 5 档权限 + 多模型 + 桌面宠物 + H5 远控 + IM 整合。

**核心能力**

- 多会话工作区 / 全局搜索(Cmd+K 跨所有会话)
- Branch / Worktree 启动(选分支 + 决定用当前工作树或独立 worktree)
- 文件级 diff review,逐文件 undo 整轮改动
- **内置浏览器预览**(被改的页面直接内嵌预览,带 cookie / 登录态)
- 5 档权限模式(从 "ask every time" 到 "skip permissions")
- BYO 模型:Claude / ChatGPT / Grok / 预设(DeepSeek、Kimi、Zhipu GLM)+ 本地(LM Studio、Ollama)
- 图像生成(ChatGPT / Grok 即用,或 OpenAI 兼容 Images API)
- 6 主题 + Skill 市场(ClawHub / SkillHub,带 source / safety 状态展示)
- **Agent Teams workbench**:可视化多 Agent 协作(成员 / 任务 / 通信 feed / 依赖泳道画布)
- **动态 Workflow 编排**:模型写并运行编排脚本,并发驱动子 agent / 管线 / 阶段视图 / 中断 / 恢复
- **Model trace**:每个模型请求本地落库 + 状态 + 时长,搜索过滤
- Computer Use:截屏 / 点击 / 输入 / 控制桌面 app(需授权)
- 桌面宠物(Dada / Huhu / Bubu / Huihui,根据任务变化行为)
- **H5 远控**:扫码用手机浏览器继续会话,锁屏不杀任务
- IM 整合:Telegram / 飞书 / 微信 / 钉钉 / WhatsApp
- 计划任务 + 用量统计

**关键借鉴价值**

- **H5 远控 / 移动控制**:用 WebView / 子服务暴露给手机浏览器。tmd-cli 没做移动端,可作为远期选项。
- **Model trace**:每个模型请求独立日志,便于排查 stuck / 失败。tmd-cli 的 `EditWatch` 类似但只覆盖 write 事件。
- **Agent Teams workbench**:把多 Agent 协同做成可视化画布。
- **Skill 市场(ClawHub / SkillHub)**:带 source / safety 状态展示,tmd-cli 的「插排」目前没标 source。

**关键短板(相对 tmd-cli)**

- 实际只服务 Claude Code(其他模型都通过 Anthropic SDK,不是「接入各家 CLI」,而是「接入各家 API」)—— 它不是「多 CLI 引擎宿主」,而是「Claude Code 的 GUI」加上 BYO 多模型 API;与 tmd-cli 的「CLI 子进程 + PTY 透传」路线根本不同
- Electron 体积大、内存高;不渲染原始终端
- 没有 SSH / 没有审批线 / 没有 checkpoints

---

### 6. opcode — winfunc/opcode

- 仓库:<https://github.com/winfunc/opcode> · 主页:<https://opcode.sh>
- License:AGPL-3.0 · 平台:macOS / Windows / Linux · 技术栈:**Tauri 2 + Rust + React + Vite + Bun**
- Star:22,394 · 创建:2025-06 · 最近 push:2025-10(注:近一年几乎不活跃,但 star 仍高)
- 一句话定位:**Claude Code Toolkit + GUI**:管理 Claude Code 项目 / 会话 + 自定义 Agent + 后台执行 + Usage 仪表板 + MCP 管理 + 时间线 + Checkpoints + CLAUDE.md 编辑。

**核心能力**

- 可视化项目浏览器(扫 `~/.claude/projects/`)
- 会话历史 + 智能搜索 + resume
- **CC Agents**:自定义系统提示 + 后台执行(独立进程,不阻塞 UI)
- 用量 / 成本 / token / 按模型时间序列分析 + 导出
- MCP Server 注册表 + Claude Desktop 导入 + 连接测试
- **时间线 + Checkpoints**:会话版本化 + 分支时间线 + 一键 restore + fork 会话 + 任意 checkpoint 间 diff
- CLAUDE.md 内置编辑器 + 实时预览 + 项目内全 CLAUDE.md 扫描

**关键借鉴价值**

- **Checkpoints + 时间线 + 分支**:这套模型与 tmd-cli 的审批线事件归因不同 —— opcode 把整个 session 当成 git 一样 branch / restore,tmd-cli 把每一轮改动当 git patch 来 diff / apply / revert。两者同源不同表达,tmd-cli 的方案更细粒度(批级别 vs session 级别)。
- **Claude Desktop 导入 MCP**:通过配置文件批量迁移;tmd-cli 没做。
- **CC Agents 后台执行**:独立进程跑,tmd-cli 的 session-budget 是另一种思路(配额限制)。

**关键短板(相对 tmd-cli)**

- 只服务 Claude Code(单引擎),不是真正的多 CLI 宿主
- 最近一年几乎无活跃 push,发展速度落后
- 没 SSH / 没多引擎 / 没工程面板 / 没插件市场

---

### 7. GT-Office — Laplace-bit/GT-Office

- 仓库:<https://github.com/Laplace-bit/GT-Office> · 主页:<https://laplace-bit.github.io/GT-Office/>
- License:Apache-2.0 · 平台:macOS / Windows / Linux · 技术栈:**Rust + React + Tauri**(与 tmd-cli 完全同栈)
- Star:21(早期) · 创建:2026-02 · 最近 push:2026-09-02
- 一句话定位:**多 Agent 桌面工作站**(Claude Code + Codex CLI + Gemini CLI)—— 多个 Agent 在统一工作区持续运行 + 持久化 + Agent 间通信 + 远端 IM 通道。

**核心能力**

- Workspace-centric:Agent 一次创建,跨会话持久化(不丢失)
- **Agent-to-Agent 通信**(`gto` CLI):Agent 间分派任务 / 共享上下文 / 移交工作
- **外部通道代理**:Telegram / 微信 / 飞沙;手机上监控并下发指令
- **对抗式推理**:预配置 Generator-Evaluator 角色,交付前自动评审
- 视觉化模型切换:零配置文件修改
- Tasks / Files / Git / Explorer / 通道 5 个核心视图

**关键借鉴价值**

- **Agent 间通信总线**:通过 `gto` CLI 让 Agent 互派任务 —— 是「`@` 跨 Agent 委托」的另一种实现。tmd-cli 没做跨会话通信,可作远期方向。
- **对抗式 Generator-Evaluator 角色**:让两个 Agent 互相校验,tmd-cli 没做(但其「approval line + 守卫」是用户视角的对抗)

**关键短板(相对 tmd-cli)**

- star 极少(21),项目处于早期 demo 阶段
- 没 SSH / 没 Checkpoints / 没插件市场

---

### 8. Orkas — Orkas-AI/Orkas

- 仓库:<https://github.com/Orkas-AI/Orkas> · 主页:<https://orkas.ai>
- License:MIT · 平台:macOS / Windows + Linux(源构建) · 技术栈:Electron + 内置 Commander / Specialist Agent(不是 CLI 宿主,而是自带 agent 框架)
- Star:1,733 · 创建:2026-04 · 最近 push:2026-09-05
- 一句话定位:**多 Agent 团队协作桌面应用**(自带 9 个 specialist agent + Commander)+ BYO 模型 + 自我进化。

**核心能力**

- 9 个内置 specialist agent(DeepResearcher / ContentWriter / PptMaker / ProductDeveloper / OfficeWorker / VideoStudio / ImageStudio / UIDesigner / SeoGeoAgent)
- Commander:理解目标 → 拆解 → 派发给 specialists(串行或并行)
- **可驱动外部 CLI Agent**:Claude Code / Codex / OpenCode / Cline(把它们当本地子进程挂到自己的 Commander 下)
- Local-first(数据/keys/agents 全在本地磁盘);模型 API 调用直连 provider
- 可选「Orkas model」托管模型(自费)
- 内置 whisper.cpp(语音转写)
- 自我进化:每个 agent 有自己的 COMPETENCE.md / LEARNING_STRATEGIES.md + 反思触发

**关键借鉴价值**

- **「自建 Commander + 接管外部 CLI Agent」**:既不与各家 CLI 抢生态,又能用自家 agent 编排他们 —— 是「CLI 宿主」的进阶形态。
- **自我进化模式**:agent 通过 reflection 自我改进,沉淀 skills 到私有 SKILL.md。tmd-cli 的 memory-coordinator 是项目级 Magic Context,这是 agent 维度,层级不同但哲学相通。
- **30 agent marketplace**:tmd-cli 的 19 个 plugin 规模小,但有更严的内核约束(plugin 不入 kernel)。

**关键短板(相对 tmd-cli)**

- 它不是「CLI 宿主」,而是「自带 agent + 可挂 CLI」 —— 路线不同
- Electron,体积大
- 没 SSH / 没审批线 / 没工程面板

---

### 9. palot — ItsWendell/palot

- 仓库:<https://github.com/ItsWendell/palot> · 主页:无
- License:MIT · 平台:macOS / Windows / Linux · 技术栈:**Electron 40 + Vite + React 19 + Bun + Hono + Jotai + TanStack Router + shadcn/ui + Tailwind 4**
- Star:179(早期) · 创建:2026-02 · 最近 push:2026-05(近 4 个月不活跃)
- 一句话定位:**OpenCode 单引擎桌面 GUI** —— 「OpenCode 的图形外壳」,把 OpenCode 终端 agent 包成多项目窗口 + diff + 调度 + 历史迁移。

**核心能力**

- 多项目工作区(OpenCode 本身每实例一项目,palot 突破该限制)
- 完整聊天界面 + SSE 流式 + Markdown 渲染 + 自动滚动 + 懒加载分页 + 草稿持久化
- Undo/Redo(`Cmd+Z` 撤销 Agent 整轮改动)
- `/` 服务端命令(`/compact` `/help`)+ `@` 文件/上下文引用
- 工具调用可视化:读(行号 + 高亮)/ 写(inline diff)/ Bash(ANSI 着色)/ glob/grep/web fetch/任务列表
- Sub-agent 卡片:实时活动卡片 + 自动完成时折叠
- 模型 + agent 选择器(按 provider 搜索 + reasoning variant + 最近用 + 收藏)
- 内联权限审批 + 交互式问题(radio / checkbox / 自由文本)
- **Review panel**:虚拟化 + worker pool 高亮,数百改动仍流畅
- **Diff 评论**:点行加评论,自动收集注入下一轮 prompt
- **Commit & push**:内嵌对话框,创建分支 / 提交 / push / 开 PR
- **RRule 调度自动化任务**(周期化运行 Agent)
- **从 Claude Code / Cursor 迁移**(CLAUDE.md → AGENTS.md、MCP / rules / hooks 全转换)
- macOS 26+ Liquid Glass 窗体 + 系统 accent color + 托盘 + Dock badge

**关键借鉴价值**

- **Worker pool 高亮 + 虚拟化 Review panel**:把 diff review 性能做到「数百文件也不卡」,tmd-cli 的 `git-history` 与 patch 抽屉还没做到这量级。
- **Diff 评论自动注入下一轮 prompt**:用户体验闭环,值得借鉴。
- **从 Claude Code / Cursor 迁移**:MCP / rules / hooks 转换。tmd-cli 没做 CLI 之间的迁移工具。
- **macOS 26 Liquid Glass**:用了 `NSGlassEffectView`,tmd-cli 目前走的是更稳的 WebKit2GTK / WKWebView 路线。

**关键短板(相对 tmd-cli)**

- 只服务 OpenCode 单引擎,不是真正的多 CLI 宿主
- 近 4 个月无活跃 push,处于 alpha 早期

---

### 10. CodePilot — op7418/CodePilot

- 仓库:<https://github.com/op7418/CodePilot> · 主页:<https://www.codepilot.sh/>
- License:**BSL-1.1**(商用限制,2029-03-16 转 Apache 2.0) · 平台:macOS / Windows / Linux · 技术栈:**Electron + Next.js + Vite + Tailwind 3**
- Star:6,445 · 创建:2026-02 · 最近发布:2026-09-05
- 一句话定位:**多模型 AI agent 桌面客户端**(17+ provider)+ MCP + skills + 远程桥(Telegram / 飞书 / Discord / QQ / 微信)+ 媒体生成 + 任务调度。

**核心能力**

- 17+ provider 直连:Anthropic / OpenRouter / Bedrock / Vertex / Zhipu GLM / Kimi / Moonshot / MiniMax / Volcengine / MiMo / Aliyun Bailian / Ollama / LiteLLM + 自定义 OpenAI 兼容端点
- **不是 CLI 宿主** —— 直连 API,Claude Code CLI 是可选增强(用于直接编辑文件 / 跑 terminal / git 操作)
- Persona files(soul.md / user.md / claude.md / memory.md)+ onboarding + 每日 check-in
- Generative UI:AI 创建交互式仪表盘 / 图表 / 可视化 widget
- 远程桥:连接 Telegram / 飞书 / Discord / QQ / 微信,从手机发消息
- MCP(stdio / sse / http)+ skills.sh marketplace
- 媒体工作室(Gemini 图像生成,批量任务 / gallery / tag)
- 任务调度(cron + interval)
- 暂停 / 恢复 / **rewind to checkpoint** / 归档
- **Split-screen 双会话并列**
- 用量统计 + 按日趋势 + 成本估算
- 导入 Claude Code CLI 历史
- SQLite WAL 本地存储
- 中英文双语

**关键借鉴价值**

- **Generative UI**:让 Agent 在对话流里生成交互式 widget(仪表盘 / 图表 / 表单)。tmd-cli 当前的 Composer + 锚点栏 + 审批面板是自家 UI,没让 Agent 动态生成 widget。
- **Persona files + memory.md + 每日 check-in**:Agent 行为的「记忆层」由 Markdown 文件 + 用户确认机制驱动,与 tmd-cli 的 Magic Context 思路相近但表达不同。
- **Split-screen 双会话**:同时开两个并排会话。tmd-cli 的 tab 条是堆叠,没做 split view。

**关键短板(相对 tmd-cli)**

- 它不是「CLI 宿主」,而是「直连 API 的桌面客户端 + 可选 Claude Code CLI 增强」,与 tmd-cli 的「CLI 子进程」根本路线不同
- Electron + Next.js 体积大;License BSL-1.1 限制商用
- 没原始终端幕布;没 SSH;没审批线 + 守卫

---

### 11. LongHorizon-Harness — AMAP-ML/LongHorizon-Harness

- 仓库:<https://github.com/AMAP-ML/LongHorizon-Harness> · 主页:<https://lh-harness.pages.dev> · 论文:<https://arxiv.org/abs/2608.01964>
- License:MIT · 平台:macOS(主) + Windows · 技术栈:**Python(uv/pip)+ FastAPI/React 工作台 + Bun + Computer-Use plugins**
- Star:1,465 · 创建:2026-08 · 最近 push:2026-08-20
- 一句话定位:**「Loop Engineering」** —— 给 Claude Code / Codex / OpenCode / DeepSeek Harness 加 Manager / Executor / Auditor 三角色,做长时任务持续推进。

**核心能力**

- 三角色:Manager(规划) / Executor(执行,新 context) / Auditor(独立校验),通过 `AgentAdapter` 协议接入各家 agent
- `lh-harness web` 起一个 React/FastAPI 工作台(浏览器可访问)
- **Computer-Use plugin**:在 GUI 桌面 app 和 CLI 之间切换操作同一任务
- 数百任务基准(WeaveBench / OSWorld 2.0 / Terminal-Bench 2.1)实测:**~50% → ~80% GUI+CLI 完成率**,**3× 全桌面任务完成率**(OSWorld 2.0)
- Manager / Executor / Auditor 可分别配不同模型或 backend

**关键借鉴价值**

- **Manager / Executor / Auditor 三角色 + Auditor 独立校验**:与 tmd-cli 的「Approval Line + 守卫 + 反悔」是用户视角的同构设计 —— 但 LongHorizon 让 AI 自己对抗;tmd-cli 让用户对抗。两种思路可融合(让 tmd-cli 的「应用/反悔」后台跑 Auditor 校验后再放行)。
- **Computer-Use 跨 GUI 桌面 + CLI 连续任务**:一套代码既操作浏览器又操作终端。tmd-cli 没做 GUI 操作,但 SSH 终端是它自己的同类能力。

**关键短板(相对 tmd-cli)**

- Python CLI + Web 工作台,不是真桌面 app;依赖外置 uv + Python 3.10+
- 只做了「长任务推进」,不是「会话管理 GUI」
- 没插件市场 / 没原始终端幕布 / 没工程面板

---

### 12. OpenContext — 0xranx/OpenContext

- 仓库:<https://github.com/0xranx/OpenContext> · 主页:<https://0xranx.github.io/OpenContext/>
- License:MIT · 平台:桌面 + Web UI · 技术栈:**Tauri + Node.js CLI + MCP Server**
- Star:756 · 创建:2025-12 · 最近 push:2026-06(近 3 个月不活跃)
- 一句话定位:**Agent 的个人上下文知识库** —— 「给 AI 助手持久记忆」+ 复用现有 CLI(Codex / Claude Code / OpenCode)+ Skills/工具生成 + GUI。

**核心能力**

- `oc` CLI 管理全局 `contexts/` 库(文件夹 / 文档 / manifests / 搜索)
- MCP Server 让 Cursor / Claude Code / Codex / Agent 调用 OpenContext 作为工具
- `oc init` 生成 user-level skills(slash commands,Cursor/Claude Code/Codex)
- **复用现有 coding agent CLI**(Codex / Claude / OpenCode),不替换
- 桌面 app / Web UI / CLI 三形态

**关键借鉴价值**

- **「复用现有 CLI 不替换」**:和 tmd-cli 的同构主张 —— tmd-cli 也是宿主,不抢 CLI 生态。
- **`oc init` 一次性生成 user-level skills + slash commands**:Onboarding 体验,tmd-cli 的「插排」可以借鉴这种「一个命令挂好一切」的设计。
- **全局 context 库 + Agent 通过 MCP 读**:与 tmd-cli 的 Magic Context / memory-coordinator 是不同表达,但同样解决「跨项目、跨会话的知识持久」。

**关键短板(相对 tmd-cli)**

- 它是「context store」,不是「CLI 宿主」 —— 只解决知识层,会话层靠各家 CLI 自己
- 近 3 个月无 push,开发放缓

---

## 二、纯单 CLI 包装类(参考但不入正表)

> 这些项目只服务一家 CLI,严格意义上不是「多 CLI 宿主」,但部分设计可借鉴。

- **OpenCursor**(PawanOsman) — VS Code 插件,Cursor 的开源平替,6k+ star,但 VS Code 生态,不算独立客户端
- **FlyCrys**(SergKam) — Linux GTK4 native GUI for Claude Code,Rust 替代 Electron
- **grok-build-vscode**(phuryn) — Grok Build 桌面客户端(Windows/macOS)+ VS Code/Cursor 扩展,后期扩到 Codex / Claude Code
- **CursorLens**(HamedMP) — Cursor IDE 的开源 dashboard,记录 AI 代码生成 / 用量统计 / 控制 AI 模型(包括本地)
- **code-buddy**(phuetz) — Terminal-first AI coding agent,64 个 LLM provider,30 个免费/本地,220+ 工具
- **GT-Office / dockit / frp-panel / lamda / repomon / NextLeader …** — 主题不直接相关,略过

---

## 三、闭源商业参考(背景对照,不构成竞品)

- **Cursor / Windsurf / Trae / VS Code + Copilot** — 编辑器级 AI 助手,都是单 LLM 闭环,不走 CLI 子进程路线
- **Claude Desktop 官方** — Anthropic 官方桌面端,只服务自家 Claude Code,不做多 CLI
- **Cline / Continue / Aider** — IDE 插件或 TUI 工具,不在桌面宿主赛道
- **DeepSeek Harness / Hermes-Agent / OpenClaw** — 都不是「客户端」而是「CLI agent 本体」,被上述多个客户端挂载

---

## 四、核心差异矩阵(tmd-cli vs 主要同类)

| 维度 | **tmd-cli** | cc-switch | desktop-cc-gui | codeg | Orkas | CodePilot | LongHorizon |
|---|---|---|---|---|---|---|---|
| **多 CLI 引擎数** | 9 个(cli-* + cli-shared) | 8 个(切换器) | 5 个 | 15 个(含 ACP 自注册) | 0(自带 agent,可挂 4 个 CLI) | 0(17+ provider 直连,Claude Code 可选) | 4 个 CLI(AgentAdapter) |
| **原始终端幕布**(xterm.js 透传) | **是** | 否 | 否 | 否 | 否 | 否 | 否(仅 web 工作台) |
| **不渲染 Markdown/Diff 在终端内** | **是** | — | — | — | — | — | — |
| **PTY 字节流保真**(逐字节) | **是** | 否 | 否 | 否 | 否 | 否 | 否 |
| **SSH 一等会话** | **是**(独立插件) | 否 | 否 | 否 | 否 | 否 | 否 |
| **审批线 + 守卫 + 反悔** | **是** | 否 | 否 | 否 | 否 | 否 | Auditor 替代 |
| **Checkpoints** | 否(改用文件级 diff 审批) | 否 | 否 | 否 | 否 | rewind to checkpoint | 否 |
| **网络代理 + 进程 env 注入** | **是** | 否 | 否 | 否 | 否 | 否 | 否 |
| **插件市场 + 可视化插排** | **是**(19 plugin) | 否 | 否(Coming Soon) | 否 | 内置 agent 30 个 | skills.sh 集成 | 否 |
| **本地首存 SQLite WAL** | 否(settings.json + 文件) | **是**(SQLite WAL) | 否 | 否 | 否 | **是** | 否 |
| **跨会话 to-do / worktree** | 工作区 ≈ 容器,无 worktree | 否 | 是(Worktree 启动) | **是**(每 todo 一 worktree) | 否 | 否 | 否 |
| **`@` 跨 Agent 委托** | 否(一 CLI 一会话) | — | 否 | **是** | Commander 内部 | — | Manager 派 Executor |
| **远程控制(IM / 手机)** | 否 | 否 | 否 | **是**(Telegram/飞书/微信 + iOS/Android) | 否 | **是**(Telegram/飞书/Discord/QQ/微信) | 否 |
| **Model trace / 请求级日志** | 否(仅事件归因) | 否 | Context Ledger | **是**(多维) | 否 | 用量 + 成本 | 否 |
| **生成式 widget UI** | 否 | 否 | 否 | 否 | 否 | **是** | 否 |
| **Provider preset / 一键导入** | 否(仅凭据盘点) | **是**(50+ preset) | 部分 | 否 | 否 | 17+ provider | 否 |
| **License** | (私有,用户项目) | MIT | MIT | Apache-2.0 | MIT | BSL-1.1(2029 转 Apache 2.0) | MIT |
| **GitHub star** | (用户内部) | 131,209 | 4,159 | 3,223 | 1,733 | 6,445 | 1,465 |
| **桌面框架** | **Tauri 2 + React 19 + TS 7** | **Tauri 2 + Rust** | **Tauri 2 + React 19 + TS** | **Rust 主导 + Vite** | Electron + 自家 agent | **Electron + Next.js** | Python + FastAPI/React |
| **文件 tab + 中央编辑器** | **是** | 否 | 否 | 是(file tree + editor) | 否 | 否 | 否 |
| **Markdown 渲染** | **是**(rich Composer) | 否 | 是 | 是 | 是 | 是 | 否 |
| **PDF / Office 文档预览** | PDF(是)+ docx(是) | 否 | 否 | **是**(officecli) | 是(OfficeWorker) | 是 | 否 |
| **Skill 市场 + source / safety 标注** | 否 | 是(部分) | 否 | 否 | 否 | 是(skills.sh) | 否 |
| **设定持久化加密** | 否(settings.json 明文) | 否 | 否 | 否 | 否 | **是**(safeStorage) | 否 |
| **Composer 触发器 CLI 真相源**(`/ `$` `@`) | **是** | — | 是 | 是 | — | — | — |
| **磁盘身份 ↔ 活会话绑定** | **是**(自证 + 落窗仲裁) | — | 是 | 是 | — | — | — |

> 加粗 = tmd-cli 当前领先或持平的维度;`—` = 不适用。

---

## 五、关键观察

### 5.1 tmd-cli 当前已形成 6 个领先差异化点

1. **原始终端幕布 + xterm.js + 字节级 PTY 透传**:这是 tmd-cli 的根本路线坚持,6 家公开竞品全部舍弃 raw 模式。tmd-cli 的「PTY bytes → pty://out/{sessionId} → xterm.js 原样透传,严禁在幕布侧做消息气泡 / Markdown / Diff 二次渲染」是定位层面最稳的护城河。
2. **SSH 一等会话 + russh 引擎 + SFTP + 端口转发**:把 SSH 提到与本地 CLI 会话同构的一等公民,所有竞品都没做。
3. **审批线 + 守卫 + 反悔(纯事件归因)**:每一轮文件改动 = 一个批,可 diff / 回退 / 应用 / 反悔,且不依赖 git。这是 LongHorizon Auditor 之外的另一种对抗方案,且用户体验更直接(用户对抗,不是 AI 对抗)。
4. **9 引擎 + 19 plugin + 插排可视化 + 19 个一字排开**:插件市场 UI 是 tmd-cli 的独有视觉形态。
5. **Composer 三触发器(`/ $ @`)+ CLI 真相源 + translate 钩子**:不让 Composer 自己造命令,一切以 CLI profile 声明为准。这套思路与 desktop-cc-gui 同构,但 tmd-cli 的「上一条用户消息锚点 + 60s TTL 缓存 + RPC 副车回退」更细。
6. **网络代理面板 + 进程 env 注入**:Rust `reqwest` 同构兜底 + 进程级 `HTTP(S)_PROXY/ALL_PROXY` 注入,关闭时还原启动 env。竞品都没做。

### 5.2 三个明确的产品差距(下一阶段看齐方向)

1. **Provider preset / 一键导入**(cc-switch 范式):tmd-cli 当前欢迎页只盘点已登录凭据,没做「50+ preset 一键导入」。值得做,但需要明确:这是「切换器」价值,不是「客户端」核心 —— 若做,应放在欢迎页(不抢工作区入口)。
2. **Prompt Enhancer / Model Trace / 用量深度统计**(desktop-cc-gui / codeg / CodePilot 范式):tmd-cli 当前 Composer 只做 `translate`,没做 AI 润色;Ask 提示音已做,但 Model Trace 没做;用量统计只在 Quota chip 上,没按模型 / 会话 / 项目拆。短中期值得做。
3. **跨 Agent 委托 / `@`-mention / Agent Teams workbench**(codeg / Orkas / GT-Office 范式):tmd-cli 当前是「一 CLI 一会话」,跨 CLI 协同未做。是远期方向,需明确「是否做多 Agent 协同」这一战略选择题。

### 5.3 tmd-cli 不应学的地方

- **Electron**:所有 Electron 类项目(cc-haha、CodePilot、OpenDesign、Orkas)体积大、内存高;tmd-cli 的 Tauri 2 + Rust + portable-pty 是正确坚持。
- **BSL / AGPL 商业限制**:tmd-cli 私有项目不受影响,但若未来开源,优先 MIT(对齐 cc-switch / desktop-cc-gui / codeg / Orkas)。
- **「不要 raw 终端」路线**:这是竞品的共同选择,但 tmd-cli 的坚持正是差异化来源。
- **过度通用化**(Orkas 30 agent、codeg 15 agent、OpenDesign 26 agent):tmd-cli 的「单 CLI 会话」+ 「19 plugin」是聚焦的产物,做多到极致会失去方向感。

---

## 六、关键参考链接汇总

| 项目 | 仓库 | 主页 | License |
|---|---|---|---|
| cc-switch | <https://github.com/farion1231/cc-switch> | <https://ccswitch.io> | MIT |
| desktop-cc-gui | <https://github.com/zhukunpenglinyutong/desktop-cc-gui> | <https://www.mossx.ai/download> | MIT |
| codeg | <https://github.com/xintaofei/codeg> | <https://docs.codeg.app> | Apache-2.0 |
| open-design | <https://github.com/nexu-io/open-design> | <https://open-design.ai> | Apache-2.0 |
| cc-haha | <https://github.com/NanmiCoder/cc-haha> | <https://cchaha.ai> | MIT |
| opcode | <https://github.com/winfunc/opcode> | <https://opcode.sh> | AGPL-3.0 |
| GT-Office | <https://github.com/Laplace-bit/GT-Office> | <https://laplace-bit.github.io/GT-Office/> | Apache-2.0 |
| Orkas | <https://github.com/Orkas-AI/Orkas> | <https://orkas.ai> | MIT |
| palot | <https://github.com/ItsWendell/palot> | — | MIT |
| CodePilot | <https://github.com/op7418/CodePilot> | <https://www.codepilot.sh/> | BSL-1.1 |
| LongHorizon-Harness | <https://github.com/AMAP-ML/LongHorizon-Harness> | <https://lh-harness.pages.dev> | MIT |
| OpenContext | <https://github.com/0xranx/OpenContext> | <https://0xranx.github.io/OpenContext/> | MIT |
| opencode(底层引擎之一,被多家挂载) | <https://github.com/anomalyco/opencode> | <https://opencode.ai> | MIT |

---

## 七、给后续决策的 takeaway

1. **短期(本周内)**:不做新的产品方向调整,继续推进已审批的 openspec 变更。
2. **中期(下个 spec 阶段)**:在评估 provider preset(欢迎页改造)和 Model Trace(Composer 工具栏扩展)之前,先看是否与现有插件市场定位冲突 —— 不要引入「切换器」属性。
3. **长期(>1 个月)**:跨 Agent 委托是远期战略题,需先做一次 brainstorming(`skill://brainstorming`)确定「是否走多 Agent 协同路线」再决定。
4. **持续观察**:每月底(或每次发现新竞品)更新本表,登记 `docs/research/similar-products.md` 的版本号 / 日期。
