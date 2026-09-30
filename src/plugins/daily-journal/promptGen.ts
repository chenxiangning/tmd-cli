/**
 * 生成 prompt 构造(纯函数,测试面)—— 文章 md 契约的唯一权威表述:
 * 结构(h1/总览/## 分节[问题/过程/关键片段/踩坑与规避]/## 未完事项)、半角留痕、
 * 增量不重写既有节、摘录文件为事实来源、「写完只回一行」收口。genSession 消费。
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
): string {
  const key = dayKey(y, m, d);
  const legend = digest ? "当日会话清单(标题后的 (有摘录)=摘录文件中有对应小节,(无摘录)=仅有标题):" : "当日会话清单:";
  const list = rows
    .map((r) => {
      const mark = rowMark(r, summarizedAt, digest);
      return `- ${hmOf(r.startedAt)} 起 [${r.profileId}] ${r.title}${r.wsName ? `(${r.wsName})` : ""}${mark}`;
    })
    .join("\n");
  const markRule = summarizedAt !== undefined ? "清单中标注(新增)的是尚未并入的会话,(已归纳)的仅作上下文、不得为其新增节;" : "";
  const incremental = hasExisting
    ? `文件里已有当日文章:先读它,逐字保留全部既有节(标题与正文都不得改写);${markRule}把新增会话整理成新节按时间顺序并入,新节标题末尾用半角括号标注并入时刻,如「## 新节标题(15:32 并入)」;「未完事项」可合并更新。`
    : `文件尚不存在:全新生成当日唯一一篇汇总文章。`;
  const source = digest
    ? `内容来源:先完整读入会话内容摘录(每个会话的用户原话、助手结论、关键动作与报错都在里面):
${digest.path}
文章的事实与细节必须取自摘录;摘录没覆盖的会话只按清单标题概述,禁止编造。`
    : "内容来源:本次无摘录文件,凭清单标题概述主线即可;细节查不到就不展开。";
  const degrade = digest
    ? "摘录文件读取失败才降级:仅凭清单写简版(每主线两三句 + 未完事项),仍须写入上述文件。"
    : "工具调用失败/不可用时不得中止或追问,立即降级:仅凭清单成文。";
  return `# 每日工作日志生成任务:${key}

把今天(${rows.length} 个 AI 编程会话)整理成一篇当日工作汇总文章,直接写入文件:
${articlePath}

${source}

要求:
- UTF-8 Markdown;只写这一个文件,不要创建或修改其他任何文件;禁止扫描目录或逐个探测原始会话文件(事实只来自摘录与清单);全程不得向用户提问,工具失败不中止。
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
- 所有括号/冒号一律半角(尤其并入留痕章)。
- ${incremental}
- ${degrade}
- 无论过程如何,最后必须把文章写入上述文件并回复那一行。

${legend}
${list || "(无——按空日处理,写一篇说明性短文即可)"}

完成后只回复一行:已写入 <文件路径>`;
}
