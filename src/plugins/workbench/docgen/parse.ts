/**
 * docgen 结构化解析 —— 严格五段 markdown → 条目(风险/行动项/建议 + 溯源)。
 * 契约见 prompt.ts 骨架段;任一必需段缺失 → 整体回落 null(UI 走 MarkdownBody)。
 * 纯函数,零 IO;diff 键 = 字母骨架(数字全剔,activityWatch 同款)。
 */

export interface ParsedRisk {
  level: "高" | "中" | "低";
  text: string;
  src?: string;
}

export interface ParsedAction {
  text: string;
  owner?: string;
  due?: string;
  src?: string;
  /** `[x]` 已完成初态(阅读器勾选框初值)。 */
  checked: boolean;
}

export interface ParsedSuggestion {
  text: string;
  basis?: string;
}

export interface ParsedProjectBlock {
  name: string;
  lines: string[];
}

export interface DocGenParsed {
  overview: string[];
  projects: ParsedProjectBlock[];
  risks: ParsedRisk[];
  actions: ParsedAction[];
  suggestions: ParsedSuggestion[];
}

/** 五段标题(解析按包含匹配,兼容「各项目进展」变体;顺序即骨架顺序)。 */
const SECTION_MATCHERS: ReadonlyArray<{ key: "overview" | "projects" | "risks" | "actions" | "suggestions"; re: RegExp }> = [
  { key: "overview", re: /概览/ },
  { key: "projects", re: /项目进展/ },
  { key: "risks", re: /风险/ },
  { key: "actions", re: /行动项/ },
  { key: "suggestions", re: /建议/ },
];

const SRC_RE = /<!--src:(.+?)-->/;
const EMPTY_MARK_RE = /^[-*]\s*(无|暂无|none)\s*$/i;

function stripSrc(text: string): { text: string; src?: string } {
  const m = SRC_RE.exec(text);
  if (!m) return { text: text.trim() };
  return { text: text.replace(SRC_RE, "").trim(), src: m[1].trim() };
}

function parseRiskLine(raw: string): ParsedRisk | null {
  const m = /^[-*]\s*(高|中|低)\s*[:：]\s*(.+)$/.exec(raw);
  if (!m) return null;
  const { text, src } = stripSrc(m[2]);
  if (!text) return null;
  return { level: m[1] as ParsedRisk["level"], text, src };
}

function parseActionLine(raw: string): ParsedAction | null {
  const m = /^[-*]\s*\[( |x|X)\]\s+(.+)$/.exec(raw);
  if (!m) return null;
  const checked = m[1].toLowerCase() === "x";
  let body = m[2];
  const { text, src } = stripSrc(body);
  body = text;
  let owner: string | undefined;
  let due: string | undefined;
  const paren = /[（(]([^）)]*)[)）]/.exec(body);
  if (paren) {
    const inner = paren[1];
    const ownerM = /负责人\s*[:：]\s*([^,，;；)]+)/.exec(inner);
    const dueM = /截止\s*[:：]\s*([^,，;；)]+)/.exec(inner);
    owner = ownerM?.[1]?.trim() || undefined;
    due = dueM?.[1]?.trim() || undefined;
    body = body.replace(paren[0], "").trim();
  }
  if (!body) return null;
  return { text: body, owner, due, src, checked };
}

function parseSuggestionLines(lines: string[]): ParsedSuggestion[] {
  const out: ParsedSuggestion[] = [];
  for (const raw of lines) {
    if (EMPTY_MARK_RE.test(raw.trim())) continue;
    const item = /^[-*]\s+(.+)$/.exec(raw.trim());
    if (item) {
      const { text } = stripSrc(item[1]);
      if (text) out.push({ text });
      continue;
    }
    const basisM = /^\s*(?:依据|理由)\s*[:：]\s*(.+)$/.exec(raw);
    if (basisM && out.length > 0 && !out[out.length - 1].basis) {
      out[out.length - 1].basis = basisM[1].trim();
    }
  }
  return out;
}

/** 严格五段解析;段缺或风险/行动双双为空视为不可解析(回落原文渲染)。 */
export function parseDocGenMarkdown(md: string): DocGenParsed | null {
  const buckets: Record<string, string[]> = { overview: [], projects: [], risks: [], actions: [], suggestions: [] };
  let current: string | null = null;
  for (const line of md.split(/\r?\n/)) {
    if (line.startsWith("## ")) {
      const head = line.slice(3).trim();
      current = SECTION_MATCHERS.find((s) => s.re.test(head))?.key ?? null;
      continue;
    }
    if (line.startsWith("# ")) continue; /* 一级标题(文档题)不入段 */
    if (current) buckets[current].push(line);
  }
  if (SECTION_MATCHERS.some((s) => !buckets[s.key].some((l) => l.trim() !== ""))) return null;
  const risks = buckets.risks.map((l) => l).filter((l) => l.trim() !== "" && !EMPTY_MARK_RE.test(l.trim()))
    .map(parseRiskLine).filter((r): r is ParsedRisk => r !== null);
  const actions = buckets.actions.map((l) => l).filter((l) => l.trim() !== "" && !EMPTY_MARK_RE.test(l.trim()))
    .map(parseActionLine).filter((a): a is ParsedAction => a !== null);
  if (risks.length === 0 && actions.length === 0) return null;
  const projects: ParsedProjectBlock[] = [];
  for (const line of buckets.projects) {
    const head = /^###\s+(.+)$/.exec(line.trim());
    if (head) projects.push({ name: head[1].trim(), lines: [] });
    else if (line.trim() !== "" && projects.length > 0) projects[projects.length - 1].lines.push(line.trim());
  }
  return {
    overview: buckets.overview.map((l) => l.trim()).filter((l) => l !== ""),
    projects,
    risks,
    actions,
    suggestions: parseSuggestionLines(buckets.suggestions),
  };
}

/** diff 键:字母骨架(数字全剔——进度百分比/日期变动不算条目变更)。 */
export function diffTextKey(text: string): string {
  return text.replace(/[^\p{L}]/gu, "");
}

export interface DocDiffItem {
  sign: "add" | "del" | "mod";
  text: string;
}

/** 条目级对比(相邻两版):风险/行动/建议合并成键控清单。 */
export function diffParsed(prev: DocGenParsed, cur: DocGenParsed): DocDiffItem[] {
  const flat = (p: DocGenParsed): Map<string, string> => {
    const map = new Map<string, string>();
    for (const r of p.risks) map.set(diffTextKey(r.text), r.text);
    for (const a of p.actions) map.set(diffTextKey(a.text), a.text);
    for (const s of p.suggestions) map.set(diffTextKey(s.text), s.text);
    return map;
  };
  const before = flat(prev);
  const after = flat(cur);
  const items: DocDiffItem[] = [];
  for (const [key, text] of after) {
    const old = before.get(key);
    if (old === undefined) items.push({ sign: "add", text });
    else if (old !== text) items.push({ sign: "mod", text });
  }
  for (const [key, text] of before) {
    if (!after.has(key)) items.push({ sign: "del", text });
  }
  return items;
}
