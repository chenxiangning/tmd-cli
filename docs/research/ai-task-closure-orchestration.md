# AI 任务闭环机制调研:交代任务到规划拆解到全流程闭环是怎么实现的

> 2026-11-06。回答三个问题:①「交代一个任务,AI 规划拆解并做到闭环」是什么机制实现的;②是不是 skill 编排;③tmd-cli 能不能具备、怎么具备。三路 web 调研(单 agent 脚手架 / 编排器项目 / skills 理论)+ 本地现状盘点。与 2026-09-26《客户端能力盘点》(docs/research/client-capability-gap-analysis.md)互补:那篇讲痛点对照,这篇讲闭环的机制层。

## 一、结论(先行)

1. **闭环的引擎是 agent loop,不是 skill。** Anthropic 一手定义:"agents are typically just LLMs using tools based on environmental feedback in a loop"。LLM 在循环里调工具、读环境反馈、直到停止条件;规划拆解是模型的 reasoning/planning 能力,宿主代码负责循环、闸门与停止条件。([Building effective agents](https://www.anthropic.com/engineering/building-effective-agents))
2. **skill 是知识包,不是流程控制器。** Agent Skills 的本质 = SKILL.md + 渐进式披露:启动时只注入 ~100 tokens 元数据,模型判断相关后才读全文、跑捆绑脚本;官方定位是"新员工 onboarding 材料",编排者始终是模型自己("give Claude detailed instructions and let it orchestrate the work using its tools")。最接近「skill 剧本」的 goose recipes 也只是给 lead/worker 喂 SOP,驱动仍是 agent loop。
3. **「模型声明,环境裁决」是所有开源实现的第一共性。** codex update_plan、claude TodoWrite、opencode todowrite 全部是自报状态、零校验;真正裁决完成与否的是命令/测试/CI 的执行结果。闭环可靠性来自:权限闸门硬隔离规划与执行 + 工具接口内建即时反馈(SWE-agent ACI)+ 子代理隔离上下文 + 上下文压缩续命。
4. **编排器的接口形态清一色是「spawn CLI 子进程 + 任务文件/API」,没有一家靠改 prompt 文件。** vibe-kanban(28.5k star)、claude-squad、crystal 都是 spawn claude/codex 等子进程;task-master 是任务文件系统;反向通道用 MCP server 暴露任务 API 给 agent 主动拉任务/报状态。
5. **tmd-cli 能具备,且底座大半现成。** 它本身坐在编排器这个位置上(PTY/RPC 宿主 10 家引擎),workbench 任务台账、会话生命周期状态机、审批线、checkpoints、通知/远程三件套都在;缺的是任务单↔会话绑定、状态回填映射与验证回路。一期不需要自研拆解器——拆解交给引擎侧既有 plan 能力,tmd 只做任务单、派发、回填、闸门。

## 二、机制解剖:一个任务闭环系统的最小构件

Building effective agents 的基础区分:**workflows = 预定义代码路径编排 LLM(可预测);agents = LLM 动态指挥自己的流程与工具使用(灵活)**。「交代→拆解→闭环」若拆解方式动态不可预测,对应 orchestrator-workers 模式;若固定流水线,对应 prompt chaining;两者都是宿主代码层面的模式,与 skill 无关。

| 构件 | 职责(一句话) | 出处锚点 |
| --- | --- | --- |
| LLM(规划/决策核心) | 理解任务、planning、决定下一步 | Building effective agents |
| 工具集 + ACI 文档 | 让模型可执行动作;接口设计质量决定 agent 质量(工具优化时间 > prompt) | 同上 Appendix 2;SWE-agent ACI |
| Agent loop(宿主代码) | while 循环:模型调用 → 工具执行 → 结果回灌,直到终止 | "LLMs using tools in a loop" |
| 环境反馈(ground truth) | 每步从环境取真实结果评估进度,防漂移 | Building effective agents |
| 停止条件 | 完成判据或最大迭代数,保持控制 | 同上 |
| 编排模式(可选) | 需要可预测性时:prompt chaining / routing / parallelization / orchestrator-workers / evaluator-optimizer | 同上 |
| 知识注入层(skill/memory) | 向循环内模型按需注入程序性知识,**不控制流程** | Agent Skills docs |
| 工具连接层(MCP) | 标准化接入外部工具与数据,**不控制流程**;skills 教 agent 用 MCP 工具的复杂工作流 | engineering blog |
| 护栏/权限 | guardrails、沙箱、人工 checkpoint | 同上;OpenAI agents docs |

OpenAI 侧同构:"Agents are systems that independently accomplish tasks on your behalf... operating within clearly defined guardrails"(model + tools + environment + guardrails);Orchestrating Agents cookbook 的抽象是 routines + handoffs,仍是代码层编排。

### skill 的真实角色(回答「是不是 skill 编排」)

- 一个 skill = 含 SKILL.md 的目录(frontmatter 必填 name/description)。三级加载:L1 元数据 ~100 tokens 进 system prompt → L2 模型按需读全文(<5k tokens)→ L3 读捆绑文件/跑脚本(脚本确定性执行但不进上下文)。([Anthropic engineering](https://www.anthropic.com/engineering/equipping-agents-for-the-real-world-with-agent-skills))
- 触发只有两种:模型按 description 自动匹配,或用户显式 `/skill-name`。没有任何"skill 驱动任务拆解/编排"的官方机制。
- skills 与 MCP 分工(官方原文):"Skills can complement MCP servers by teaching agents more complex workflows that involve external tools"——MCP 是工具连接层,skills 是程序性知识层,都非流程控制器。
- anthropics/skills 仓库只含 skill 内容本体(document-skills: pdf/xlsx/docx/pptx 等),零运行时代码——仓库结构本身就是"skill 是内容包不是引擎"的证据。([anthropics/skills](https://github.com/anthropics/skills))

## 三、单 agent 侧:开源编码 agent 的闭环脚手架

| 项目 | 规划/清单 | 规划与执行隔离 | 子代理 | 自验/反馈 | 闭环锚点 |
| --- | --- | --- | --- | --- | --- |
| [openai/codex](https://github.com/openai/codex)(Rust) | update_plan 纯状态汇报(`codex-rs/core/src/tools/handlers/plan.rs`,pending/in_progress/completed 渲染,零执行零校验) | approval mode 四档 + sandbox 三档(read-only/workspace-write/full-access) | 无(单循环) | 沙箱命令真实返回值回环;失败回模型重试 | 沙箱执行反馈 + 审批闸门;官方博客 [Unrolling the Codex agent loop](https://openai.com/index/unrolling-the-codex-agent-loop/) |
| [sst/opencode](https://github.com/sst/opencode) | todowrite 工具 | Build(全工具)/ Plan(默认拒 edit/write,仅放行 `.opencode/plans/` 计划文件)双 agent,permission 矩阵硬隔离 | General(并行子任务)/ Explore(只读) | permission 表 + 工具反馈 | 「想」与「做」的权限硬隔离 |
| claude-code(闭源,[docs 公开](https://code.claude.com/docs/)) | TodoWrite 纯跟踪 | plan mode:`/plan` 只读规划态,EnterPlanMode/ExitPlanMode 是正式工具,方案经用户批准再执行 | Task 子代理(独立上下文,plan mode 主动调研用) | hooks 在 PreToolUse/PostToolUse/Stop 等生命周期点跑确定性命令(lint/test),可阻断 | 用户批准闸门 + hooks 确定性校验 |
| [block/goose](https://github.com/block/goose) | recipes 声明式任务剧本(指令/工具/子任务版本化) | lead-worker:lead 强模型规划,worker 便宜模型执行 | subagents 自主启用 | 工具反馈 | 剧本外置 + 模型分工 |
| [SWE-agent](https://github.com/SWE-agent/SWE-agent) | 无清单工具 | 研究驱动 | 无 | **ACI 是经典范本:编辑后必须 lint 回显错误**,工具面向 LM 优化动作空间、限制输出长度 | 接口内建即时反馈——每次动作自带校验信号 |
| [All-Hands-AI/OpenHands](https://github.com/All-Hands-AI/OpenHands)(现 software-agent-sdk) | 事件流即执行历史([events](https://docs.openhands.dev/sdk/arch/events):Pydantic schema + append-only 日志 + 观察者) | reasoning-action loop 显式编排([agent](https://docs.openhands.dev/sdk/arch/agent)) | delegation 事件类型 | 事件流 + 沙箱执行 | **condenser 上下文压缩**([condenser](https://docs.openhands.dev/sdk/arch/condenser))保证长循环不爆 token |

### 共性规律(五条)

1. **任务清单是声明式不是校验式**:update_plan/TodoWrite/todowrite 只记录模型自报状态,没有任何实现核对「完成」是否为真;真实校验永远来自命令/测试的执行结果。
2. **规划与执行靠权限闸门硬隔离,不信任模型自律**:codex approval+sandbox、opencode Plan agent 的 edit:deny、claude plan mode,全都在强制「先读后写/先批后做」。
3. **子代理承载并行与上下文隔离**:共同动机是把搜索/大输出/子任务隔离到独立上下文,防主循环被污染。
4. **反馈回路内建于接口**:SWE-agent 证明闭环质量取决于工具给模型的即时反馈,而非事后清单。
5. **长循环靠上下文管理续命**:OpenHands condenser、opencode compaction agent 把事件历史压成摘要,让「执行→自验→重试」跑很多轮不爆上下文。

## 四、编排器侧:拆解分配验证合并的开源实现

| 项目 | 任务拆解 | 任务单/状态机 | agent 分配 | 验证/完成判定 | 合并 | 状态 |
| --- | --- | --- | --- | --- | --- | --- |
| [eyaltoledano/claude-task-master](https://github.com/eyaltoledano/claude-task-master) | `parse-prd` AI 把 PRD 解析成 tasks.json 依赖图;`analyze-complexity` 打 1-10 分推荐 subtask 数;`expand --all` 按复杂度展开 | status ∈ {pending, in-progress, done, review, deferred, cancelled} + dependencies/priority/details/**testStrategy** | **无自动分配**:任务文件系统,`next` 命令选下一个,单 agent 串行 | testStrategy 只是执行时的 prompt 素材;状态人/AI 手工 set;无自动验证执行器 | 无合并层 | ⚠️ 已放缓(2026-04 后无 commit) |
| [BloopAI/vibe-kanban](https://github.com/BloopAI/vibe-kanban)(28.5k star) | **人工**:kanban 建 issue(优先级/sub-issues/tags);另开 MCP server 让外部 agent 经 API 读写任务(反向通道) | task 层(板列)× **attempt 层**:一次 attempt = 独立 workspace(branch + agent 进程),可同任务多 attempt 换 agent 对比 | 人拖卡选 agent(claude code/codex/opencode 等 10+)在 workspace 里 spawn | agent 停后人看 diff review,inline comment 直接回灌 agent 续跑;内置 preview browser | 一键 PR(AI 生成描述)→ GitHub merge;workspace 即 worktree | ⚠️ 官方宣布 sunsetting,转社区维护 |
| [stravu/crystal](https://github.com/stravu/crystal) | 无自动拆解;session template 批量建 N 会话并行试探 | session: initializing/running/waiting/stopped/error,SQLite 持久化 | 每会话一实例,经 claude-code SDK(非裸 PTY)+ **每会话独立 worktree** | 无自动验证;人看 diff,per-project run scripts 手动跑测试 | `Squash and rebase to main` 压平重放 | ⚠️ 已停更,继任 Nimbalyst |
| [smtg-ai/claude-squad](https://github.com/smtg-ai/claude-squad) | 零(人开 session) | running ↔ paused(checkout 即 commit+暂停) | tmux 每 agent 独立会话 + worktree 独立分支;`-p` 指定 claude/codex/gemini/aider;`-y` 自动按 yes | 纯人工看 preview/diff tab | commit & push,人自开 PR | 万级 star,最常被 fork |
| [langchain-ai/langgraph](https://github.com/langchain-ai/langgraph) | orchestrator LLM **动态**生成子任务列表(data-dependent)fan-out | 图即状态机:共享 StateGraph state + 条件边 + `Command(goto)`;checkpoint 可恢复 | worker = 图节点;Send API 做 map-reduce | reviewer/supervisor 节点 + 循环边由人写;无内建测试闸门 | worker 输出写回共享 state,synthesizer 汇总;不管 git | 2026 orchestrator-worker 事实代表作(autogen 转 actor 模型后热度反超) |
| [OrchestratorInc/agent-orchestrator](https://github.com/ComposioHQ/agent-orchestrator)(Composio,2.7k+) | **orchestrator 自己是 agent**:plans tasks → spawns agents → 自主处理 | 全自主 | 25-35+ harness(claude code/codex 等) | **自主跑 CI 修复、merge conflict、code review** | 到 merged PR 闭环 | 2026-02 起,非常活跃;当前闭环度最高标杆 |
| [omnara-ai/omnara](https://github.com/omnara-ai/omnara)(~3.3k) | 不做拆解;控制平面定位 | 并行 agent 监督,多端接管/批准 | Claude Code + Codex 并行;Python SDK/MCP 接入自定义 agent | 运行中人工接管/批准 | 经 git 常规流 | YC 系,self-hostable |

### 编排层共性架构

1. **任务单 schema 三档**:纯文件(tasks.json)、DB 任务单 + attempt 子对象(vibe-kanban 的 task×attempt 分层是该层最有价值的抽象)、代码内 state(LangGraph)。
2. **状态机普遍两级**:任务级六态词表几乎通用(pending/in-progress/review/done/deferred/cancelled)+ 执行级(initializing/running/waiting_input/stopped/error)。**waiting 态(等批准/输入)是所有桌面编排器的核心状态**,通知系统都挂在状态迁移上。
3. **接口形态**:主流 = spawn CLI 子进程(tmux/node-pty/托管进程);反向通道 = MCP server 暴露任务 API 给 agent;**没有一家用「只改 prompt 文件」做接口**。
4. **物理隔离 = git worktree(一任务一分支)**,除 LangGraph 外全部如此;冲突隔离与「不合意即弃」都靠它。
5. **闭环程度光谱**:task-master(无合并层)→ claude-squad/crystal(人看 diff + 工具化 squash-rebase)→ vibe-kanban(diff review + 反馈回灌 + 一键 PR)→ agent-orchestrator(orchestrator agent 自主 CI/冲突/review 到 merged PR)。趋势:review/merge 从人工操作向 orchestrator agent 自主化收敛。

### 竞品寿命警示

task-master 放缓、vibe-kanban sunsetting、crystal 停更——纯编排层项目寿命普遍短(上游 SDK/CLI 变动快、生态位被 agent 原生功能挤压),且都缺 tmd-cli 已有的本地优先/多引擎同窗/生命周期/审批/远程三件套。这既是机会(编排层需求真实存在且没人站稳)也是警示(要贴着自家底座做薄编排,不做重编排产品)。

## 五、tmd-cli 现状映射:底座大半现成

| 闭环构件 | 开源参照 | tmd-cli 现有 |
| --- | --- | --- |
| 宿主/接口形态 | vibe-kanban spawn CLI、claude-squad tmux | **PTY 幕布 + RPC 会话双形态宿主 10 家引擎**;omp RPC 有 turn_start/session_settled 结构化轮界事件(`ssTurnLive`/`ssSession.ts`) |
| 任务单 | tasks.json / kanban attempt | **workbench 台账已在**(`~/.tmd-cli/workbench/index.json`:projects[]→tasks[]/updates[]/status/cwd/docs),但现在是人工登记口径,未与会话绑定 |
| 执行状态回填 | crystal session 状态机、vibe-kanban attempt | **activityWatch 生命周期状态机**(awaitingTurn/activeTurns 四态,docs/architecture/08)+ RPC session_settled 结算事件——「会话在干活/等输入/落定」已有判定 |
| waiting 态 + 通知 | vibe-kanban 状态迁移挂通知 | **审批线已收口**:askWatch 双通道 + 审批收件箱 + 未读 + 手机推送通道(2026-09-26 P0-1 后系统通知也已落地) |
| 规划/拆解 | task-master parse-prd、langgraph orchestrator | 无。但**拆解本身是引擎侧模型能力**(claude plan mode/codex update_plan/omp 原生规划)——客户端不必重做拆解器,派发的 prompt 里要求引擎先出计划即可 |
| 验证回路 | SWE-agent ACI、claude hooks、agent-orchestrator CI | 部分:**evidence.ts 已认 RPC write/edit 完成帧做 checkpoints 存证**;test gating(封批前自动跑测试)在 09-26 P1 已列为远期 |
| 物理隔离 | worktree 一任务一分支 | git 面板 + checkpoints 在;**worktree 编排未做**(09-26 P1-2 已列) |
| 结果查看/合并 | diff review + squash-rebase | checkpoints/footprint 存证 + git 面板;无「任务级 diff 汇总视图」 |
| 多 agent 并行 | crystal/claude-squad 多会话 | **多会话同窗本来就是主形态**;广播(同输入喂多引擎)已有;attempt 式多尝试无绑定 |
| skill/知识注入 | agentskills 公约 | skill-hub 已落地(`~/.agents/skills` 公约 + composer 跨引擎 skill 关联)——可为「派发 prompt」提供任务类 SOP,**但闭环引擎不靠它** |

核心缺口只有三个:**①任务↔会话绑定关系(哪个会话在跑哪个任务、attempt 归属);②状态回填映射(生命周期事件 → 任务态迁移 → 台账写入);③验证回路(完成判据:至少人工 gate 收口,进阶 test gating)。**

## 六、能不能具备:能。落地路径(建议,不拍板)

**一期「编排最小闭环」(全部现有件,新增绑定层):**
1. workbench 任务加「派发」:选中任务 → 生成会话 prompt(模板含:任务目标 + 要求引擎先出计划再动工 + 完成判据)→ 在任务 cwd 开 RPC 会话(omp 优先,有结构化轮界事件);
2. 任务↔会话绑定字段(taskId ↔ sessionId,attempt 可多条 = 多会话并行试同一任务);
3. 状态回填:session_settled/turnLive/activityWatch 事件 → 任务态迁移(in-progress/等待输入/落定待验收),台账 updates 自动追加轮次摘要(适配器读转录尾部);
4. 完成收口 = 人工 gate:验收视图(任务维度聚合:会话落定态 + checkpoints diff + 存证帧)→ 人点「完成」写回 done。
   期间 skill 的正确用法:给「派发 prompt 模板」配任务类 SOP(如「tmd-cli 修 bug 必跑 check:gate」),走 skill-hub 既有通道——知识注入,不是引擎。

**二期「反向通道 + 并行」:**
5. tmd-cli 开 MCP server(或消费引擎侧 MCP)把 workbench 任务 API 暴露给引擎内 agent:agent 主动拉下一任务、报状态——vibe-kanban 已验证的反向通道形态;与「内核不理解 CLI 私有格式」铁律不冲突(API 面在插件侧);
6. attempt 并行 worktree 化(接 09-26 P1-2):一任务多尝试各占 worktree,不合意即弃。

**三期「自主验证回路」(谨慎,远期):**
7. test gating:任务落定前自动跑项目测试命令,红 = 自动回炉(反馈文本进会话);
8. orchestrator agent 化(对标 agent-orchestrator):自主 CI 修复/解冲突/review。风险如实:编排层竞品寿命普遍短;tmd 的护城河打法是薄编排贴底座(生命周期/审批/远程/checkpoints 都是别家没有的),不做重编排产品,不越「幕布内不二次渲染」铁律。

## 七、附:来源

理论:[Building effective agents](https://www.anthropic.com/engineering/building-effective-agents) · [Agent Skills engineering blog](https://www.anthropic.com/engineering/equipping-agents-for-the-real-world-with-agent-skills) · [platform.claude.com skills docs](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/overview) · [code.claude.com skills](https://code.claude.com/docs/en/skills) · [sub-agents](https://code.claude.com/docs/en/sub-agents) · [anthropics/skills](https://github.com/anthropics/skills) · [OpenAI agents cookbook](https://developers.openai.com/cookbook/topic/agents) · [Orchestrating agents](https://github.com/openai/openai-cookbook/blob/main/examples/Orchestrating_agents.ipynb)

单 agent 脚手架:[openai/codex](https://github.com/openai/codex)(plan.rs/protocol/plan_tool.rs) · [Unrolling the Codex agent loop](https://openai.com/index/unrolling-the-codex-agent-loop/) · [sst/opencode agents docs](https://opencode.ai/docs/agents) · [block/goose](https://github.com/block/goose)(recipes/lead-worker/subagents) · [SWE-agent ACI](https://github.com/SWE-agent/SWE-agent/blob/main/docs/background/aci.md) · [OpenHands events](https://docs.openhands.dev/sdk/arch/events) / [agent](https://docs.openhands.dev/sdk/arch/agent) / [condenser](https://docs.openhands.dev/sdk/arch/condenser)

编排器:[claude-task-master task-structure](https://github.com/eyaltoledano/claude-task-master/blob/main/docs/task-structure.md) · [vibe-kanban](https://github.com/BloopAI/vibe-kanban) · [crystal](https://github.com/stravu/crystal)([停更声明](https://stravu.com/blog/crystal-supercharge-your-development-with-multi-session-claude-code-management/)) · [claude-squad](https://github.com/smtg-ai/claude-squad) · [langgraph](https://github.com/langchain-ai/langgraph) · [agent-patterns-catalog orchestrator-workers](https://www.agentpatternscatalog.org/patterns/orchestrator-workers/) · [OrchestratorInc/agent-orchestrator](https://github.com/ComposioHQ/agent-orchestrator) · [omnara](https://github.com/omnara-ai/omnara)

本地:`docs/research/client-capability-gap-analysis.md`(2026-09-26 痛点对照)· `docs/research/skill-mcp-integration-architecture.md`(skill-hub 委托 CLI 模式)· `docs/architecture/08-session-lifecycle.md` · `~/.tmd-cli/workbench/index.json`
