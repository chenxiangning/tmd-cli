# 功能与任务聚类(业务聚合)闭环调研

- 日期:2026-10-19
- 状态:调研完成,管线推荐待确认
- 归组:`docs/research/daily-work-footprint/`(同主题第二篇,依 AGENTS.md §0.5 归组;首篇 [00-survey.md](00-survey.md))
- 结论:**「功能与任务」卡不是用户手填,主生成源 = LLM 管线,用户只做修正**。推荐两步走:第一版在现有每日日报生成会话的 prompt 里顺手产出结构化 features(零新增调用,跑两天验格式稳定率);不达标再拆独立轻量无头调用。纯规则聚类(标题分词/embedding)只配做 LLM 不可用时的降级,不做主管线。防漂移与幻觉控制各有一条廉价铁律:卡措辞一经生成即冻结、每卡强制引用会话身份且代码校验。

## 1. 问题定义

原型(docs/design/daily-work-footprint.html)里「功能与任务(按当日会话与日报聚类)」是手工假数据。真实链路要回答:5-20 场会话怎么变成 2-5 张「账号密码登录」级别的功能卡;谁生成、何时生成、怎么防编造、第二天新会话并进来怎么不把昨天的卡改坏。

本地已有资产(生成会话跑在真实 CLI agent 上,输入含当日全部会话摘录),意味着 LLM 管线的基建是现成的——问题收敛为「在哪次调用里产、产什么格式、怎么校验」。

## 2. 本地代码事实(生成链全读实证)

| 部件 | 事实 | 对功能卡的含义 |
|---|---|---|
| promptGen.buildGenPrompt | 文章 md 契约固化(h1/总览/##分节/未完事项);**项目分组已注入 prompt**;增量指令=「既有节逐字保留,新会话成新节,节尾 `(HH:MM 并入)` 留痕」 | 分节≈功能主线的雏形;项目分组=报告所称「规则先分桶」的等价物已具备 |
| sessionDigest | 生成会话的事实来源=当日摘录 md(逐会话用户原话/结论/关键动作,压缩上限 DAY_CHAR_CAP=100K) | 用户原话在输入里——「原话锚点」零成本可得 |
| articleParse.parseArticle | 宽松解析契约:缺件均可渲染,解析失败返回 null 按「文章不存在」处理 | 附加产出解析失败可静默降级,不伤主文章 |
| sessionRef | 正文 `[会话|HH:MM|profileId|标题]` 四段标记,**渲染层枚举校验,与清单不一致(LLM 编造)降级纯文本,宁缺勿错** | 「引用校验防幻觉」的完整先例,功能卡照抄此模式 |
| taskQueue + genSettle | 串行任务队列;无头单发(oneshotArgs,答完即退);成败唯一判据=articleChanged(文章相对基线真的变化);失败重试/补跑由 journalSchedule 承接 | 新管线若走独立调用,队列/结算/重试全套可复用 |
| journalStore.addBead / DayMeta | 一次生成/增量/干涉=一颗珠子,日账本落盘 | features 生成的可观测性(珠子)有现成挂点 |

关键对照:本地「增量并入 + 留痕 + 引用校验」三件套与外部最佳实践(Chain-of-Key 冻结更新、evidence 回链、枚举校验)一一对应——架构方向已被两边互证。

## 3. 业界做法(调研要点,全文出处见 §6)

- **没有直接成品**。Agentic 平台(Codex app/Jules/Devin)的 activity 视图停在元数据层:一任务一卡、卡间无语义归并;用量工具(ccusage/claudelytics/agentlytics)纯 token 维度。本地 CLI 会话流比云端碎,聚合是真空点,与首篇调研结论一致。
- **最接近的参照系 = AgentsView**:Generated Insights 对「日期范围+项目+agent」的会话集合,把 transcript 派生内容发给**本机 agent CLI 无头跑一次 prompt** 生成范围报告(与 journal 生成会话同构);Recall 从会话提取结构化条目,每条带指回 transcript 的 evidence 链接,自动条目标 `unreviewed_auto` 须人工审批——「提取→可校验引用→信任分级」是成熟范式。
- **AI changelog 生成器全是混合范式**:规则先分桶(conventional commit 前缀/PR label),LLM 只做措辞归纳与合并去重——不指望 LLM 自己聚类。会话标题没有前缀信号,但项目分组注入已是等价物。
- **LLM 结构化产出**:schema 约束优于自由文本后解析,但无头 CLI agent 拿不到 provider 级 structured output → prompt 内嵌 schema + 输出清洗 + 解析失败重试一次;5-20 条会话 <10K token,**一次给全优于 map-reduce**(全局归并避免「登录」vs「鉴权」别名分裂);无头路径 schema 要简单(一层对象数组)。
- **增量防漂移**:Chain-of-Key(EMNLP 2024)——摘要表示成结构化键值,新信息「按键更新/增补」而非整篇重写,显著减冗余与失真。工程化=features 持久 JSON + 卡稳定 id + 旧卡措辞冻结 + 增量指令限定「归入现有卡(附理由)或新建卡」。
- **规则法不可行性**:短文本主题建模是公认难点,5-20 个标题点跑密度聚类几乎必然大片噪声或粒度切错;「同一功能跨会话改名」(登录失败锁定 vs 账号锁定策略)是 embedding 弱项、LLM 强项;「聚成 2-5 张卡」这类业务约束在 prompt 里一句话、在聚类框架里表达别扭。

## 4. 管线对比与推荐

| 管线 | 做法 | 成本 | 质量/风险 | 适用 |
|---|---|---|---|---|
| A. 日报生成顺手产出 | buildGenPrompt 契约追加:文章之外(或文中固定段)同场产出 features JSON(标题/一句话/会话引用/原话锚点) | **零新增调用** | 附加任务易被「写日报」主目标敷衍:格式漂移、引用不全;解析失败静默降级不伤主文章 | 第一版先试,跑两天看格式稳定率 |
| B. 独立轻量无头调用 | 复用 taskQueue/结算机,单独一次调用:输入=当日会话清单+摘录原话选段,输出=features JSON;代码校验引用后落盘 | 多一次轻量调用(<10K token) | 单一目标 prompt,粒度可控(「2-5 张卡」写进指令);失败面=无头可用性+解析重试一次 | A 不达标时升级为主管线 |
| C. 规则降级 | LLM 不可用时:按项目分组(已有信号)+ 标题原样列卡 | 近零 | 不装作聚了类,诚实罗列 | 兜底 |
| D. 用户修正 | 功能卡重命名/合并/拆分/删除 | — | 定位=**修正层,不是主生成源**;修正结果落盘优先于生成结果 | 常驻 |

推荐:**A 先试 → B 兜底升级 → C 降级 → D 常驻**。两步走的依据:A 零成本验证「无头 agent 附带 JSON 产出」的格式稳定率(无公开数据,必须实测);AgentsView 参照系证明 B 的形态成熟可拆。

## 5. 落地产物形态(供 spec 消化)

- 存储:`~/.tmd-cli/daily/features/YYYY-MM.json`(月文件,`{ "DD": FeatureCard[] }`),卡字段 `{ id, title, desc, sessionRefs[](HH:MM|profileId|标题 归一键), quotes[](用户原话摘录), frozen:true }`;与 article/digest 同目录族,插件私有路径。
- 校验:落盘前按当日会话清单枚举校验 sessionRefs(照抄 sessionRef「宁缺勿错」:引用不存在的会话→丢该引用;整卡零有效引用→丢卡);desc 优先取原话锚点。
- 冻结与增量:已落盘卡措辞只读;增量会话触发时 prompt 只带「现有卡摘要+新会话」,指令限定归卡/建卡;新增留痕沿用 `(HH:MM 并入)` 语义。
- 与 rollup 账的关系:功能卡是语义层,rollup(首篇 §3.2)是量化层,互不依赖;功能卡可挂 rollup 聚合出的 ± 数(卡上「8 文件 +212 −48」),账本清理不影响卡。
- 旧日子:无 features 文件的日子,功能分区显示为空态 + 「该日无功能归纳」提示,可用 D 让用户手补。

## 6. 落点裁决建议:新插件还是工作日志增强

建议:**独立 `src/plugins/footprint/` 插件(中央 tab),不塞进工作日志**。

| 维度 | 工作日志(journal) | 工作足迹(footprint) |
|---|---|---|
| 生命周期 | 生成域:调度/队列/结算/文章写作 | 检索域:只读回溯/反查/区间汇总 |
| 月历语义 | 格=生成状态五态(g/t/p/f/n) | 格=±热力四档,点击=进当日 |
| 数据方向 | 写(article/digest/features) | 读(全量消费前三者+rollup+git) |

理由:两者共享数据面(daySessions 扫描缓存、dayLinks 派生、article/digest/features 文件)但使命相反;塞进 journal 会让月历格双语义冲突、检索工具条(搜索框/区间模式)与生成工具条混装,且 journal 子域已 60+ 文件。数据共享的跨插件机制(daySessions/dayLinks 纯函数层是 export 复用还是下沉共享层)留 spec 裁决——先例是 cli-shared「跨插件契约进共享层,单插件语义不进 kernel」。原型的月历交互语言刻意与工作日志月视图同源,视觉连续性不受插件分家影响。

## 7. 来源

- AgentsView Generated Insights / Recall(最接近成品参照):https://agentsview.io/insights · https://www.agentsview.io/docs/recall/
- ai-changelog-generator(规则分桶+LLM 归纳范式):https://github.com/AndreaBonn/ai-changelog-generator
- Chain-of-Key 增量摘要防漂移(EMNLP 2024 Findings):https://arxiv.org/html/2407.15021v1
- Text Clustering as Classification with LLMs:https://arxiv.org/html/2410.00927v3
- BERTopic 短文本泛化实验:https://arxiv.org/abs/2212.08459v1
- NAACL 2022 句向量聚类优于神经主题模型:https://aclanthology.org/2022.naacl-main.285.pdf
- Think Inside the JSON(schema 约束成本):https://arxiv.org/html/2502.14905v1
- Devin Session Insights(元数据层现状):https://docs.devin.ai/product-guides/session-insights
- Jules(任务卡无语义归并):https://jules.google/
