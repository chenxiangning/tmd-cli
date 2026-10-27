/**
 * 规则提取 —— 规则文件(markdown)→ 规则条目数组(移植 tmd-lint rules.rs /
 * semantic.rs 口径)。
 *
 * 按行提取:bullet 列表项 / 有序项 / 表格行 / 含「」引号的普通行算规则,
 * 普通段落不算;``` 围栏内不识别;最近一个 `# 标题` 记章节;表格(表头 +
 * `|---|` 分隔 + 连续数据行)整块合成一条。信号词三通道:「…」引用短语 /
 * 反引号串 / ascii 连续串;path_refs 从信号词里按形态筛。
 */

import type { RuleItem, RuleKind } from "./lintTypes";

const STOPWORDS = new Set([
  "the", "and", "for", "with", "that", "this", "from", "into", "http", "https",
  "www", "com", "org", "not", "are", "you", "your", "all", "any", "can", "use",
  "using", "see", "one", "two",
]);

/* 语义分类词面(移植 semantic.rs;命中即归通道,决定证据测量走法) */
const COMMAND_RE = /(pnpm |npx |npm run|cargo |make |go test|跑一遍|必须跑|先跑|重跑|执行|运行|构建|编译前|交付前跑|check:|test|lint|build)/;
const PROHIBITION_RE = /(禁止|不得|不允许|严禁|不能|不许|不要|别 |must not|never)/;
const PATH_HINT_RE = /(目录|落盘|存放|写入|归档|去处|沉淀进)/;

function isAsciiRunChar(ch: string): boolean {
  return /[A-Za-z0-9\-_.:@/]/.test(ch);
}

/** 扩展名枚举(`.ts/.tsx/.rs` 这类类型列举不作路径引用)。 */
function isExtEnum(t: string): boolean {
  const segs = t.split("/");
  if (!segs[0].startsWith(".")) return false;
  return segs.every((s) => /^\.[A-Za-z0-9]{1,6}$/.test(s));
}

/** 信号词三通道(结果小写去重;移植 rules.rs make_item_ranged)。 */
export function signalTokens(line: string): string[] {
  const out = new Set<string>();
  for (const m of line.matchAll(/「([^」]*)」/g)) {
    const inner = m[1].replace(/\s+/g, "").replace(/[。,;:、!?'"]+/g, "");
    if (inner.length >= 2 && inner.length <= 30) out.add(inner.toLowerCase());
  }
  const parts = line.split("`");
  for (let i = 1; i < parts.length; i += 2) {
    const seg = parts[i].trim();
    if (seg.length >= 3 && seg.length <= 60 && !seg.includes(" ")) out.add(seg.toLowerCase());
  }
  let buf = "";
  const flush = () => {
    let t = buf;
    buf = "";
    if (t.includes("/")) t = t.replace(/[.:\-/_]+$/u, "");
    else t = t.replace(/^[.:\-/_]+|[.:\-/_]+$/gu, "");
    if (t.length >= 3 && !STOPWORDS.has(t.toLowerCase())) out.add(t.toLowerCase());
  };
  for (const ch of line) {
    if (isAsciiRunChar(ch)) buf += ch;
    else flush();
  }
  flush();
  return [...out].filter((t) => t.length >= (t.match(/[\u4e00-\u9fff]/) ? 2 : 3));
}

/** 信号词 → 路径引用(形态门槛:含 /、非绝对、非 URL、非 @、长度 ≥5)。 */
export function pathRefsOf(tokens: string[]): string[] {
  return tokens.filter(
    (t) =>
      t.includes("/") &&
      !t.startsWith("/") &&
      !t.includes("://") &&
      !t.startsWith("@") &&
      !t.includes("<") &&
      !t.includes(">") &&
      t.length >= 5 &&
      /[a-z0-9]/.test(t) &&
      !isExtEnum(t),
  );
}

/** 命令抽取:第一条 pnpm/npx/npm run/cargo 开头的命令串(移植 extract_command)。 */
export function extractCommand(text: string): string {
  for (const prefix of ["pnpm ", "npx ", "npm run ", "cargo "]) {
    const i = text.indexOf(prefix);
    if (i < 0) continue;
    let end = i + prefix.length;
    while (end < text.length && /[A-Za-z0-9 ._:\-/@]/.test(text[end]!)) end += 1;
    const cmd = text.slice(i, end).trim();
    if (cmd.length >= prefix.length + 2) return cmd;
  }
  return "";
}

function classifyKind(text: string, isTable: boolean, refs: string[]): RuleKind {
  if (COMMAND_RE.test(text)) return "command";
  if (isTable || (refs.length > 0 && PATH_HINT_RE.test(text))) return "path";
  if (PROHIBITION_RE.test(text)) return "prohibition";
  if (refs.length > 0) return "path";
  if (/(风格|命名|格式|措辞|emoji|样式|style|naming|format)/i.test(text)) return "style";
  if (/(流程|顺序|步骤|先|后|流程|process|workflow|步骤)/.test(text)) return "process";
  if (/(见|参考|文档|链接|docs|see|ref)/i.test(text)) return "reference";
  return "other";
}

/** CJK 每字 ~1 token,ascii 词 ~1.3(移植 est_tokens;可省 token 估算用)。 */
function estTokensOf(text: string): number {
  const cjk = (text.match(/[\u4e00-\u9fff]/g) ?? []).length;
  const asciiWords = text.replace(/[\u4e00-\u9fff]/g, " ").split(/\s+/).filter(Boolean).length;
  return Math.round(cjk + asciiWords * 1.3);
}

function isRuleLine(t: string): boolean {
  if (t.length < 8 || t.startsWith("#") || t.startsWith("```")) return false;
  const isList = t.startsWith("-") || t.startsWith("*") || /^[0-9][.)]/.test(t);
  const isTable = t.startsWith("|") && !t.includes("---");
  const quoted = t.includes("「") && t.includes("」");
  return isList || isTable || quoted;
}

function stripBullet(t: string): string {
  return t.replace(/^(\s*)([-*]|\d+[.)])\s+/, "$1");
}

/**
 * 规则文件全文 → 条目数组(idx 由调用方按目标内顺序回填;此处按文件内顺序)。
 */
export function extractRules(text: string, file: string): RuleItem[] {
  const lines = text.split("\n");
  const items: RuleItem[] = [];
  let inFence = false;
  let section = "";
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]!;
    const t = raw.trim();
    if (t.startsWith("```")) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    if (t.startsWith("#")) {
      section = t.replace(/^#+\s*/, "").trim() || section;
      continue;
    }
    /* 表格整块:表头行(| 行,非分隔)+ 下一行是 |---| 分隔 → 连续 | 行合一条 */
    const nextSep = lines[i + 1]?.trim() ?? "";
    if (t.startsWith("|") && !t.includes("---") && /^\|[\s:|-]+\|$/.test(nextSep)) {
      let end = i;
      while (end < lines.length && lines[end]!.trim().startsWith("|")) end += 1;
      const block = lines.slice(i, end).map((l) => l.trim()).join("\n");
      const tokens = signalTokens(block);
      const refs = pathRefsOf(tokens);
      items.push({
        idx: items.length + 1, file, line: i + 1, lineEnd: end, text: block,
        section: section || "(无章节)", kind: classifyKind(block, true, refs),
        tokens, pathRefs: refs, estTokens: estTokensOf(block),
      });
      i = end - 1;
      continue;
    }
    if (!isRuleLine(t)) continue;
    const body = stripBullet(t);
    const tokens = signalTokens(body);
    const refs = pathRefsOf(tokens);
    items.push({
      idx: items.length + 1, file, line: i + 1, lineEnd: i + 1, text: body,
      section: section || "(无章节)", kind: classifyKind(body, false, refs),
      tokens, pathRefs: refs, estTokens: estTokensOf(body),
    });
  }
  return items;
}
