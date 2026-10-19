/**
 * 生成 prompt 构造(纯函数,测试面)—— 文章 md 契约的唯一权威表述:
 * 结构(h1/总览/## 分节[问题/过程/关键片段/踩坑与规避]/## 未完事项)、半角留痕、
 * 增量不重写既有节、摘录文件为事实来源、会话引用四段标记(sessionRef 同契约)、
 * 「写完只回一行」收口;文章契约段后附功能卡契约段(footprint features JSON
 * 直写,spec L3 管线 A)。genSession 消费。
 */
import type { DaySessionRow } from "./daySessions";
import { isRowSummarized } from "./daySessions";
import { dayKey } from "./journalFiles";
import { hmOf } from "./timeUtil";

/** 生成任务标记:prompt 首行固定开头;摘录/清单层据此剔除插件自己 spawn 的生成会话(自指防混入)。 */
export const GEN_TASK_MARK = "每日工作日志生成任务";

/** 摘录交接:文件路径 + 实际收录小节的会话 id 集(行级 (有摘录) 标注的真值来源)。 */
export interface DigestHandoff {
  path: string;
  coveredIds: string[];
}

/** 工作台派生的项目分组(prompt 注入面;titles = 组内会话标题,按组内时序)。 */
export interface ProjectPromptGroup {
  name: string;
  titles: readonly string[];
}

/** 行标注:水位区分 已归纳(仅上下文)/新增(增量成节对象);摘录标注按实际收录逐行判定。 */
function rowMark(r: DaySessionRow, summarizedAt: number | undefined, digest: DigestHandoff | undefined): string {
  const digestMark = !digest ? "" : digest.coveredIds.includes(r.id ?? "") ? "(有摘录)" : "(无摘录)";
  if (summarizedAt === undefined) return digestMark;
  return `${digestMark}${isRowSummarized(r, summarizedAt) ? "(已归纳)" : "(新增)"}`;
}

export function buildGenPrompt(
  y: number,
  m: number,
  d: number,
  rows: DaySessionRow[],
  hasExisting: boolean,
  articlePath: string,
  summarizedAt?: number,
  digest?: DigestHandoff,
  projectGroups?: readonly ProjectPromptGroup[],
  /** footprint 功能卡文件路径(缺省 = 契约段整体省略,行为与旧版一致)。 */
  featuresPath?: string,
): string {
  const key = dayKey(y, m, d);
  const legend = digest ? "当日会话清单(标题后的 (有摘录)=摘录文件中有对应小节,(无摘录)=仅有标题):" : "当日会话清单:";
  const list = rows
    .map((r) => {
      const mark = rowMark(r, summarizedAt, digest);
      /* ws 后缀以 · 隔开:标题边界干净(引用标记四段的「标题」= ] 后到 ·/行尾),
       * 紧贴会让 LLM 把 (ws) 并进标题 → 渲染层枚举校验系统性 miss。 */
      return `- ${hmOf(r.startedAt)} 起 [${r.profileId}] ${r.title}${mark}${r.wsName ? ` · ${r.wsName}` : ""}`;
    })
    .join("\n");
  const markRule = summarizedAt !== undefined ? "清单中标注(新增)的是尚未并入的会话,(已归纳)的仅作上下文、不得为其新增节;" : "";
  const incremental = hasExisting
    ? `文件里已有当日文章:先读它,逐字保留全部既有节(标题与正文都不得改写);${markRule}把新增会话整理成新节按时间顺序并入,新节标题末尾用半角括号标注并入时刻,如「## 新节标题(15:32 并入)」;「未完事项」可合并更新。`
    : `文件尚不存在:全新生成当日唯一一篇汇总文章。`;
  const source = digest
    ? `内容来源:先完整读入会话内容摘录(${hasExisting ? "只含标注(新增)的会话;已归纳会话以既有文章为准" : "每个会话的用户原话、助手结论、关键动作与报错都在里面"}):
${digest.path}
文章的事实与细节必须取自摘录;摘录没覆盖的会话只按清单标题概述,禁止编造。`
    : "内容来源:本次无摘录文件,凭清单标题概述主线即可;细节查不到就不展开。";
  const degrade = digest
    ? "摘录文件读取失败才降级:仅凭清单写简版(每主线两三句 + 未完事项),仍须写入上述文件。"
    : "工具调用失败/不可用时不得中止或追问,立即降级:仅凭清单成文。";
  const groups = projectGroups?.length
    ? `\n当日项目分组(工作台派生,供分节参考;未挂项目的会话照常独立成节):\n${projectGroups
        .map((g) => `- ${g.name}(${g.titles.length} 会话):${g.titles.join(" / ")}`)
        .join("\n")}`
    : "";
  const groupRule = projectGroups?.length
    ? hasExisting
      ? "- 新节分节优先按项目组织(既有节逐字保留,不重排进项目壳);\n"
      : "- 分节优先按项目组织(项目分组即主线);跨项目或无项目主线可独立成节;\n"
    : "";
  const fileScope = featuresPath
    ? "文章为 UTF-8 Markdown;只写文中给定的两个文件(文章与功能卡),不要创建或修改其他任何文件;"
    : "UTF-8 Markdown;只写这一个文件,不要创建或修改其他任何文件;";
  /* 功能卡契约段(spec L3 管线 A):与文章同任务同会话直写第二个文件,零新增调度。
   * 铁律:sessions/quote.sid 只能引用摘录小节标题 · 之后的真实会话 id(摘录头已带
   * id,见 sessionDigest.renderSessionDigest),禁止编造;增量日旧卡 title 冻结,
   * 只允许归并新会话或新建卡,不改写措辞;单日 1-8 张,宁缺勿滥。features 文件
   * 缺失不判任务失败(结算只看文章,读侧宽容自校验),故不设专属重试/降级条款。 */
  const features = featuresPath
    ? `
功能卡(第二个直写文件,与文章同次生成):另把当日功能卡 JSON 直接写入文件:
${featuresPath}
schema 严格遵守(version 固定为 1):
{"version":1,"cards":[{"title":"功能名(≤12字)","summary":"一句话(≤40字)","sessions":["必须取自当日摘录中出现的会话 id"],"quote":{"sid":"会话id","text":"用户原话(≤60字)","time":"HH:MM"}}]}
- 每张卡对应一条当日功能主线(可参考项目分组),单日 1-8 张,宁缺勿滥;当日确无实质工作(空日说明文)才允许不写此文件。
- quote 每卡至多一条,选最有代表性的用户原话,time 用 24 小时制 HH:MM。
- sessions 与 quote.sid 只能引用摘录小节标题里 · 之后的会话 id(即当日摘录真实覆盖的会话),禁止编造;查无此 id 的卡会被读侧校验降级。${hasExisting ? "\n- 功能卡文件已存在(增量并入):先读它;旧卡 title 一经生成即冻结,只允许向语义相符的既有卡追加 sessions(不改旧卡 title/summary 等任何措辞),或为全新主线新建卡。" : ""}`
    : "";
  return `# 每日工作日志生成任务:${key}

把今天(${rows.length} 个 AI 编程会话)整理成一篇当日工作汇总文章,直接写入文件:
${articlePath}

${source}

要求:
- ${fileScope}禁止扫描目录或逐个探测原始会话文件(事实只来自摘录与清单);全程不得向用户提问,工具失败不中止。
- 结构严格遵守:
  # <自拟标题:概括当日主线>
  <总览段:当天干了什么、主线与产出,3-6 句>
  ## <分节标题>(每条主线一节;节内正文依次覆盖以下四点:)
    - 解决了什么问题:具体到文件/接口/命令级事实,不写「优化了体验」一类空话;
    - 解决过程:按时间或因果链交代关键步骤(怎么定位、试了什么、怎么收敛),注明时段或会话;
    - 关键片段:至少 1 处用 > 引用摘录原文(用户原话/报错信息/关键结论短句),原样摘出、可截断、禁止改写(无摘录可引时此点可省略);
    - 踩坑与规避:列出该主线踩的坑,每条坑后紧跟「下次避免:…」批注;确无坑写「踩坑与规避:无」。
  ## 未完事项
  - <遗留事项>(没有则写「- 无」)
- 正文(总览/分节均可)提到某个具体会话时,行内原样插入标记 [会话|HH:MM|profileId|标题]:
  四段取当日清单行原文;标题 = 清单行 [引擎] 之后的部分,剔除行尾 (有摘录)/(无摘录)/(已归纳)/(新增) 标注与 · 工作区后缀,逐字一致;
  渲染层只认与清单完全一致的标记,查无此会话的标记会降级纯文本,不要自创格式或虚构会话。
- ${groupRule}${incremental}
- ${degrade}
- 无论过程如何,最后必须把文章写入上述文件并回复那一行。
${features}

${legend}
${list || "(无——按空日处理,写一篇说明性短文即可)"}
${groups}
完成后只回复一行:已写入 <文件路径>`;
}
