/**
 * docgen prompt 组装 —— 事实源四路拼装(工作台登记恒选 + 日志/会话摘录/Git 可选)
 * 与产物契约 prompt(五段骨架,parse.ts 的解析前提;契约改动必须两边同改)。
 * 会话摘录复用 journal sessionDigest(声明式转录适配器),自指过滤剔两类生成会话。
 */
import { getWorkspaces } from "@kernel/workspace";
import { findWorkspaceOrigin } from "@kernel/workspaceOrigins";
import { ipc } from "@kernel/ipc";
import type { GitLogEntry } from "@kernel/gitContract";
import { projectBrief } from "../prompt";
import type { Project } from "../types";
import { dailyPaths, readText } from "../journal/journalFiles";
import { buildDayDigest } from "../journal/sessionDigest";
import { dayProjectLinks } from "../journal/dayLinks";
import { collectSessionRowsBatched, rowDayKey, type DaySessionRow } from "../journal/daySessions";
import { GEN_TASK_MARK } from "../journal/promptGen";
import { ensureWorkbenchLoaded, workbenchSnapshot } from "../store";
import type { DocGenEntry } from "./types";
import type { DocGenSourceKey, DocGenTemplate } from "./templates";

/** 界面语言 → 书写语言名(prompt 语言段;跟随 i18n locale,spec 参数节)。 */
const LANGUAGE_NAME: Record<string, string> = { zh: "简体中文", en: "English", ja: "日本語" };

/** 自指标记(prompt 头携带 → 会话标题携带;定义在 types 叶子,journal 侧同源过滤)。 */
import { DOC_GEN_MARK } from "./types";
import { getSettingsState } from "@kernel/settings";

export interface DocGenSourcesMd {
  projectsMd: string;
  journalMd?: string;
  sessionsMd?: string;
  gitMd?: string;
}

const inRange = (iso: string, from: string, to: string): boolean => iso >= from && iso <= to;

/** 事实源拼装(全部失败可降级:对应段缺席,prompt 相应省略)。 */
export async function assembleDocGenSources(
  entry: DocGenEntry,
  sources: DocGenSourceKey,
  projects: readonly Project[],
): Promise<DocGenSourcesMd> {
  const scope = entry.scope;
  const scoped = scope.kind === "one" ? projects.filter((p) => p.id === scope.projectId) : projects;
  const projectsMd = (scoped.length > 0 ? scoped : projects)
    .map((p) => projectBrief(p, entry.periodTo))
    .join("\n\n") || "(工作台暂无项目)";

  const journalMd = sources.journal ? await collectJournalMd(entry) : undefined;
  const sessionsMd = sources.sessions ? await collectSessionsMd(entry) : undefined;
  const gitMd = sources.git ? await collectGitMd(entry, scoped) : undefined;
  return { projectsMd, journalMd, sessionsMd, gitMd };
}

/** 周期内每日工作日志文章拼接(journal article 目录,缺日跳过;并行读)。 */
async function collectJournalMd(entry: DocGenEntry): Promise<string | undefined> {
  const paths = await dailyPaths();
  const days: Array<{ y: number; m: number; d: number; iso: string }> = [];
  const cursor = new Date(`${entry.periodFrom}T00:00:00`);
  const end = new Date(`${entry.periodTo}T00:00:00`);
  while (cursor <= end) {
    const y = cursor.getFullYear();
    const m = cursor.getMonth() + 1;
    const d = cursor.getDate();
    days.push({ y, m, d, iso: `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}` });
    cursor.setDate(cursor.getDate() + 1);
  }
  const texts = await Promise.all(days.map((day) => readText(paths.article(day.y, day.m, day.d))));
  const parts = days.flatMap((day, i) => (texts[i] ? [`#### ${day.iso}\n\n${texts[i]!.trim()}`] : []));
  return parts.length > 0 ? parts.join("\n\n") : undefined;
}

/** 周期内会话摘录(sessionDigest 声明式转录;自指生成会话剔除;失败降级不拦生成)。 */
async function collectSessionsMd(entry: DocGenEntry): Promise<string | undefined> {
  try {
    const rows = (await collectSessionRowsBatched()).filter((r: DaySessionRow) => {
      const key = rowDayKey(r);
      if (!key || key < entry.periodFrom || key > entry.periodTo) return false;
      const title = `${r.title} ${r.disk?.title ?? ""}`;
      return !title.includes(DOC_GEN_MARK) && !title.includes(GEN_TASK_MARK);
    });
    if (rows.length === 0) return undefined;
    let groups: Array<{ name: string; ids: Set<string> }> | undefined;
    try {
      await ensureWorkbenchLoaded();
      const locals = getWorkspaces().filter((w) => !findWorkspaceOrigin(w)?.remoteExec);
      groups = dayProjectLinks(rows, workbenchSnapshot(), locals).map((l) => ({ name: l.projectName, ids: new Set(l.rows.map((r) => r.id ?? "")) }));
    } catch {
      groups = undefined; /* 降级:无分组摘录 */
    }
    const built = await buildDayDigest(rows, groups);
    return built.md || undefined;
  } catch {
    return undefined; /* 摘录构建/落盘失败不拦生成(spec:无摘录路径走事实源降级) */
  }
}

/** 周期内 Git 提交(单项目绑定目录;全部项目范围不取 git)。 */
async function collectGitMd(entry: DocGenEntry, scoped: readonly Project[]): Promise<string | undefined> {
  if (entry.scope.kind !== "one") return undefined; /* 全部项目范围不取 git(弹窗已禁;此处兜底) */
  const project = scoped.find((p) => p.cwd);
  if (!project?.cwd) return undefined;
  let commits: GitLogEntry[];
  try {
    commits = await ipc.gitLog(project.cwd, 300, 0);
  } catch {
    return undefined;
  }
  const rows = commits
    .filter((c) => {
      const day = new Date(c.authorWhen);
      const iso = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}`;
      return inRange(iso, entry.periodFrom, entry.periodTo);
    })
    .map((c) => {
      const day = new Date(c.authorWhen);
      const iso = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}`;
      return `- ${c.shortSha} ${c.summary}(${iso})`;
    });
  return rows.length > 0 ? `仓库:${project.name}\n${rows.join("\n")}` : undefined;
}

const AUDIENCE_TONE: Record<string, string> = {
  管理层: "面向管理层:结论先行,每段先给判断再给依据,控制篇幅。",
  团队: "面向执行团队:动作具体到人,写清下一步怎么干。",
  对外: "面向外部读者:脱敏内部代号与人员真名,不暴露内部风险细节,措辞正式。",
};

/** 产物契约 prompt(纯函数;productPath 为结算目标,genSession 轮询认它)。 */
export function buildDocGenPrompt(opts: {
  entry: DocGenEntry;
  template: DocGenTemplate;
  productPath: string;
  sources: DocGenSourcesMd;
  additional?: string;
}): string {
  const { entry, template, productPath, sources, additional } = opts;
  const langName = LANGUAGE_NAME[entry.language ?? ""] ?? LANGUAGE_NAME[getSettingsState().settings.language] ?? LANGUAGE_NAME.zh;
  const sections: string[] = [
    `# 文档生成:${entry.title} ${DOC_GEN_MARK}`,
    "",
    `你是工作台文档助理。今天是 ${entry.periodTo}。周期:${entry.periodFrom} ~ ${entry.periodTo}(${entry.periodLabel})。`,
    entry.language ? `全文用 ${langName} 书写。` : `全文用 ${langName} 书写(跟随界面语言)。`,
    AUDIENCE_TONE[entry.audience] ?? AUDIENCE_TONE["管理层"] ?? "",
    "",
    "## 任务",
    `基于「事实源」写一份《${template.label}》,用 Write 工具把成品一次性写入文件:${productPath}`,
    "只写这一个文件,不要修改任何其它文件。",
    "",
    "## 产物契约(必须严格遵守;解析器按此结构化)",
    `1. 第一行:\`# ${entry.title}\``,
    '2. 五个二级标题,顺序固定:`## 概览`、`## 项目进展`、`## 风险与阻塞`、`## 行动项`、`## 建议`',
    '3. 风险条目行:`- 高:具体事实与影响 <!--src:出处-->`(等级只能 高/中/低;出处写「进展 2026-10-02」「日志 2026-10-03」「会话 <标题>」「提交 abc1234」;没有风险就写一行 `- 无`)',
    "4. 行动项:`- [ ] 动作(负责人:名字,截止:YYYY-MM-DD) <!--src:出处-->`(登记数据里没有的写「待定」)",
    "5. 建议:`- 建议文本`,下一行缩进两空格写 `依据:...`",
    "6. 「项目进展」段内用 `### 项目名` 三级标题按项目分块",
    "7. 只陈述事实源里有的内容;不足处写「数据不足」,禁止编造",
  ];
  if (template.skeleton) {
    sections.push("", "## 本模板要点", template.skeleton);
  }
  sections.push("", "## 事实源", "### 工作台登记(项目/任务/进展)", sources.projectsMd);
  if (sources.journalMd) sections.push("", "### 工作日志", sources.journalMd);
  if (sources.sessionsMd) sections.push("", "### 会话摘录", sources.sessionsMd);
  if (sources.gitMd) sections.push("", "### Git 提交", sources.gitMd);
  if (additional?.trim()) sections.push("", "## 附加指令", additional.trim());
  return sections.join("\n");
}
