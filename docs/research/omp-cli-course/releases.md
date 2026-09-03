# omp 最近版本升级记录 —— 每个版本解决了什么问题

> 数据来源:GitHub [releases](https://github.com/can1357/oh-my-pi/releases) 逐版本 release notes(2026-09-03 抓取),覆盖 v18.0.7 → v18.1.6 共 12 个版本。本地安装版 18.1.6 即当时最新。
> 事实口径:条目摘自官方 notes(英文原文的翻译/精简),无推测补写。

## 发布节奏

约 **每天 1.5 个版本**:2026-08-27 到 09-03 的 8 天里发了 12 个。9-01 一天三连(v18.1.0/1.1/1.2),9-03 一天两连(v18.1.5/1.6)。每个版本都带完整的分包 notes(Added/Changed/Fixed/Breaking/Removed),没有空 notes 的版本。**结论:跟版本要按周看,别按月。**

## 主线脉络(先看这段)

1. **Provider 兼容性战争**:大量修复是"某家上游改了协议 → omp 当场跟进"(Gemini 3 400、Bedrock thinking、DeepSeek DSML、Copilot 身份、Z.AI 用量窗口)。策略从"按模型名匹配特判"升级为"按解析后的兼容性/身份/行为策略驱动"(v18.1.0)。
2. **长会话稳定性**:内存膨胀、流卡死、压缩后上下文损坏、会话恢复崩溃,这一批在 v18.0.8-18.1.3 连续修掉。
3. **模型目录与计费/配额精细化**:models.dev 目录后台自动刷新(v18.0.7)、Z.AI 用量追踪(v18.0.8)、Chat/Spark 配额隔离(v18.0.9)、402/配额误判修复、`omp usage` 重做(v18.1.0)。
4. **编辑与流式可靠性**:hashline 锚点漂移修复、SM:EDIT 文本编辑恢复成真工具调用(v18.1.2)、流式工具参数更新(v18.1.6)。
5. **工程化**:VCS 双后端(Git/Jujutsu)、clone-first worktree、tiny 本地模型替换、大量 TUI/PTY 修复。

---

## v18.1.6 — 2026-09-03(Latest)

[release](https://github.com/can1357/oh-my-pi/releases/tag/v18.1.6)

**新增**
- 流式工具参数更新:工具调用进度更实时
- agent reactions(emoji 徽标)、`/copy link`、`/open`、option-click 光标定位
- ffmpeg 视频附件:预览网格 + `:412` / `:1h5m42s` 时间戳抽帧
- agent 级 rules(`agents` frontmatter glob)、`deliverAs: "aside"` 非打断消息
- Firecrawl 作为 fetch 后端;独立 CLAUDE.md 可作为项目上下文加载
- Bedrock `requestMetadata`(AWS 调用日志成本归因);Codex GPT-5.6 默认走完整 Responses 以支持并行独立工具调用

**修复**
- 编辑/写入流式期间键入消息会导致工具调用被丢弃并触发多余重新生成
- `/new` 偶尔复活旧会话;`/usage` 在大统计库上卡顿数秒
- shell 内建误报 broken-pipe;`omp commit` 自动暂存误含 macOS Unicode 规范化重复文件;原生 `git add` 空列表误暂存
- Anthropic/OpenRouter 额度耗尽自动切换兄弟账号;Anthropic prompt 缓存断点在消息尾部变化时保留可复用前缀
- Antigravity 用量统计对齐官方 5 小时/周配额桶

**Breaking**:本地会话标题小模型换为 LFM2.5 230M/350M、Falcon H1 Tiny 90M;`claudeCodeSessionId`/`openAISessionId` 统一为 `sessionId`;`MacOSPowerAssertion` → 跨平台 `PowerAssertion`;`main`/`sub` 保留为内置 subagent 名。

## v18.1.5 — 2026-09-03

[release](https://github.com/can1357/oh-my-pi/releases/tag/v18.1.5)

**新增**
- clone-first worktree(`worktree.clone`)+ `omp worktree add` + `/wt`(可带未提交变更迁移会话)
- `/login abliteration` 新 provider

**修复**
- GitHub Copilot 改回官方 Copilot CLI 身份与 OAuth 应用,恢复 client-gated 模型访问;`model_not_supported` 立即报错不再空转重试
- 预填 `<think>` 的模型(DeepSeek-R1、托管 Qwen3-Thinking)推理内容误入正文
- 自动压缩在空响应时反复重试卡死;MCP 握手超时后无法重连;大粘贴紧跟 Enter 内容未提交

**Breaking**:**移除内置 `designer` subagent 与 role**(本课程第一/六课已同步为 9 role)。外部用户级配置源(`~/.cursor`、`~/.codex`、`~/.claude` 等)改为 `enabledProviders` 显式启用。

## v18.1.4 — 2026-09-02

[release](https://github.com/can1357/oh-my-pi/releases/tag/v18.1.4)

- 目录小版本:启用 Cursor 工具 schema 投影;Gemini 每代 Flash 的按级别变体(`-low/-medium/-high`、`-tiered`)折叠为单一路由条目,不再暴露原始 id。

## v18.1.3 — 2026-09-02

[release](https://github.com/can1357/oh-my-pi/releases/tag/v18.1.3)

**修复(一批硬核会话级 bug)**
- Gemini 3 在 Antigravity/Cloud Code Assist/Vertex 上并行工具调用后永久卡 `400 INVALID_ARGUMENT`(#9638)
- DeepSeek DSML 修复器泄漏孤儿闭合标签,污染长会话历史直到工具调用停止派发(#10556)
- Anthropic thinking 在旁路请求/工具描述漂移/前缀不匹配下不再损坏会话前缀;Bedrock 兼容端点遇未签名 thinking 块不再永久拒绝
- API key 轮换尊重提供商配额重置窗口(#10325)
- 长会话内存与截断后的原始 SSE/工具输出成比例增长(#10547)
- TypeScript 7 项目(无 `tsserver.js`)代码智能失效;硬杀 subagent 在并发 fan-out 下从注册表消失(#10531);内置 grep/sed 把 BRE 当 ERE 导致 `^+` 匹配所有行(#10298)

**新增**:回退(双击 Esc、`/branch`)改为**当前会话内分支**而非 fork 子会话;`/rewind` 成为 `/branch` 别名(#10565)。新增 Claude Fable 5.1。

## v18.1.2 — 2026-09-01

[release](https://github.com/can1357/oh-my-pi/releases/tag/v18.1.2)

**新增**
- 修复会话压缩/工具结果裁剪时 Claude thinking 上下文丢失(agent-core)
- SM:EDIT:把模型的纯文本编辑负载恢复为真实编辑工具调用(`edit.recoverInlineEdits` 可关);sloppy 编辑格式改用 XML
- Bedrock thinking 控制;Anthropic 系统提示/工具/推理力度会话中途动态更新;延迟工具加载 + prompt 缓存

**修复**:Anthropic thinking 与缓存断点跨部署兼容(防 invalid-signature);Claude Code 请求指纹更新修复新模型认证;后台模型发现完成后新会话仍用旧上下文窗口上限。

## v18.1.1 — 2026-09-01

[release](https://github.com/can1357/oh-my-pi/releases/tag/v18.1.1)

单修复热修:**含数万未跟踪文件的 worktree 上跑 git status 触发原生崩溃 + 多 GB 常驻内存增长**——porcelain 状态改走 git CLI 有界捕获,git 缺失回退 gitoxide;VCS panic 以结构化 `VcsError` 呈现。

## v18.1.0 — 2026-09-01(大版本,~50 项修复)

[release](https://github.com/can1357/oh-my-pi/releases/tag/v18.1.0)

**核心变化**:provider 行为改为**按每个模型解析出的兼容性/身份/thinking/行为策略驱动,不再按模型名特判**。

**新增**
- `/usage` 重做全屏仪表盘(订阅网格 + 活动热力图);`/trace`;双击 Esc 全屏回退选择器;Agent Hub Activity 视图
- GitLab Duo、ClinePass、Devin 原生 provider 发现;分级定价与长上下文定价
- snapcompact 声明式兼容规则系统(compat-compiler,KDL)

**修复(节选)**
- OpenAI 远程压缩重放导致持久化会话无法恢复
- 编辑工具 `＋`/`－` 锚点空白漂移;纯 `＋` 的 REWRITE 误删匹配文本
- 扩展 `web_search` 被内置工具遮蔽;图片密集会话恢复崩溃;WSL 下 Windows 盘符粘贴路径
- Codex/Responses 工具结果因复合调用 id 无法配对而丢失;Z.AI 浏览器登录回调地址

## v18.0.11 — 2026-08-29

[release](https://github.com/can1357/oh-my-pi/releases/tag/v18.0.11)

**修复**
- 未识别 tokenizer 编码的模型导致启动与压缩失败(agent-core)
- MCP OAuth 嵌套路径(Keycloak realm)发现;HTTP 402/停用工作区误判为配额耗尽 → 凭证轮换
- 不可解码图片永久卡死会话;共享 headless 浏览器残留孤儿页面
- Windows 上 Python 导入 NumPy 挂起;**降低 agent 工作期间的高 idle CPU**
- Anthropic 兼容流提前结束无完成信号的自动重试;Gemini 3.x 经 OpenAI 兼容端点的工具调用续接
- 目录:Baseten GLM 被误标非推理;MiniMax-M3 输出上限回归;GLM-5.3-Flash 促销价

**新增**:composer/状态行 gallery 预览。

## v18.0.10 — 2026-08-28

[release](https://github.com/can1357/oh-my-pi/releases/tag/v18.0.10)

**新增**
- **Sharpshooter 记忆后端**(`/memory queue`、`/memory sync`)
- `/restart` 原地重启进程;F5 / Alt+R / `/retry` 原地重试失败工具调用批次
- **带未决工具调用的中断运行可续跑**(先重试工具调用再请求下一响应)
- band composer 形状(powerline 状态条,成为默认)
- `/review` 的 PR 对比改用 merge-base

**修复**:Python cell 中断/失败误报成功;编辑工具 `－` MATCH 行解析;提示历史提交即持久化,退出时 checkpoint 会话数据库防 WAL 膨胀。

## v18.0.9 — 2026-08-28

[release](https://github.com/can1357/oh-my-pi/releases/tag/v18.0.9)

**新增/Breaking**
- **后端中立 Vcs\* API**:Git 与 Jujutsu 统一(发现/refs/status/diff/暂存/提交/分支/worktree/patch/stash/cherry-pick/push/fetch/clone);SDK 移除 `git`/`jj` 包装模块(Breaking)
- Z.AI GLM-5.3-Flash 进 GLM Coding Plan 目录(1M 上下文、原生图像输入、low/high/max 思考档)
- `extendedContext` 默认关闭(GPT-5.6 1M 等长窗口留在标准定价档,Breaking)

**修复**
- Codex OAuth 配额:Chat 与 Spark 用量独立隔离,不完整用量报告不再视为无限
- 子代理关闭/MCP 断连导致进程崩溃;启动时环境 AWS 凭证误选 Bedrock 模型
- 自动续跑请求合并防重复;`omp token` 刷新本地 MCP OAuth 凭证

## v18.0.8 — 2026-08-27

[release](https://github.com/can1357/oh-my-pi/releases/tag/v18.0.8)

**新增**:Z.AI GLM Coding Plan 用量追踪(5h + 周 CREDIT_LIMIT 窗口进 `omp usage` 与状态行,含 lite/pro/max 档)。

**修复**
- Bedrock 上 OpenAI-schema 模型(gpt-5.x SKU)启用推理时报 400 `unknown_parameter: 'thinking'` → 改发 `reasoning.effort`
- 损坏会话头覆盖可恢复 transcript(#9915);**启动竞态导致新会话几乎无工具且无技能**
- snapcompact 超大压缩帧恢复时被截断成非法 base64,提供商每轮 400(#9901)
- `hub send await:true` 空等整个 IRC 超时(#9913);所有语言服务器失败时 workspace 符号搜索却报成功(#8387)
- PTY 交互读取队列限界(64×64KiB),防快速子进程 + 停滞消费者无限堆积(#4078);大 transcript 终端 resize 卡顿(只重绘可见尾部)

## v18.0.7 — 2026-08-27(~60 项修复)

[release](https://github.com/can1357/oh-my-pi/releases/tag/v18.0.7)

**新增**
- **models.dev 共享目录后台自动刷新**:"新发布的模型不用等 omp 发版就能用"
- `omp usage clients`(按客户端/机器/应用统计 token);`OMP_APP_NAME` 应用级用量归因
- `omp git` 响应性提升 + 快捷键扩展(r/s/u/space、vim motions、1-4 diff 视图、c 提交)

**修复(节选)**
- Codex 远程压缩丢失图片工具的图像
- Anthropic 订阅 OAuth 被上游拒绝(#9801);OpenAI 兼容流错误被报成空成功完成(恢复重试/回退)
- `--model <id>:<effort>` 切回 default 角色丢失 effort;`retry.fallbackChains` 告警
- 长会话超出提供商消息数上限无法恢复;协作 guest 在主机压缩后状态不一致
- LaTeX 数学定界语法沉淀为 `math-delimiters`;Paseo 终端图片乱码

---

## 附:怎么跟踪后续版本

- Release 列表:https://github.com/can1357/oh-my-pi/releases(HTML 页是 JS 渲染,脚本化抓取用 [releases.atom](https://github.com/can1357/oh-my-pi/releases.atom))
- 逐版本 changelog:`packages/coding-agent/CHANGELOG.md`
- 本地:`omp update` 升级;`omp --version` 核对
