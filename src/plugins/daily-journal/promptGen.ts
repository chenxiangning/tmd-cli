/**
 * 生成 prompt 构造(纯函数,测试面)—— 文章 md 契约的唯一权威表述:
 * 结构(h1/总览/## 分节/## 未完事项)、半角留痕、增量不重写既有节、
 * 「写完只回一行」收口。genSession 消费。
 */
import type { DaySessionRow } from "./daySessions";
import { isRowSummarized } from "./daySessions";
import { dayKey } from "./journalFiles";

const hm = (ts: number): string => {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};

/** 行标注:有水位时区分 已归纳(仅上下文)/新增(增量成节对象);无水位不标(旧账升级路径)。 */
function rowMark(r: DaySessionRow, summarizedAt: number | undefined): string {
  if (summarizedAt === undefined) return "";
  return isRowSummarized(r, summarizedAt) ? "(已归纳)" : "(新增)";
}

export function buildGenPrompt(y: number, m: number, d: number, rows: DaySessionRow[], hasExisting: boolean, articlePath: string, summarizedAt?: number): string {
  const key = dayKey(y, m, d);
  const list = rows
    .map((r) => `- ${hm(r.startedAt)} 起 [${r.profileId}] ${r.title}${r.wsName ? `(${r.wsName})` : ""}${rowMark(r, summarizedAt)}`)
    .join("\n");
  const markRule = summarizedAt !== undefined ? "清单中标注(新增)的是尚未并入的会话,(已归纳)的仅作上下文、不得为其新增节;" : "";
  const incremental = hasExisting
    ? `文件里已有当日文章:先读它,逐字保留全部既有节(标题与正文都不得改写);${markRule}把新增会话整理成新节按时间顺序并入,新节标题末尾用半角括号标注并入时刻,如「## 新节标题(15:32 并入)」;「未完事项」可合并更新。`
    : `文件尚不存在:全新生成当日唯一一篇汇总文章。`;
  return `# 每日工作日志生成任务:${key}

把下面这一天(${rows.length} 个 AI 编程会话)整理成一篇当日工作汇总文章,直接写入文件:
${articlePath}

要求:
- UTF-8 Markdown;只写这一个文件,不要创建或修改其他任何文件。
- 结构严格遵守:
  # <自拟标题:概括当日主线>
  <总览段:今天做了什么、主线是什么,2-4 句>
  ## <分节标题>(每条主线一节,正文交代做了什么、结论与产出)
  ## 未完事项
  - <遗留事项>(没有则写「- 无」)
- 所有括号/冒号一律半角(尤其并入留痕章)。
- ${incremental}
- 可以用只读命令查看会话原始内容辅助成文;但工具调用失败/不可用时不得中止或追问,
  立即降级:仅凭上面清单成文。无论过程如何,最后必须把文章写入上述文件并回复那一行。

当日会话清单:
${list || "(无——按空日处理,写一篇说明性短文即可)"}

完成后只回复一行:已写入 <文件路径>`;
}
