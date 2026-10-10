/**
 * unified patch 解析与双栏配对 —— 纯逻辑,零渲染依赖。
 *
 * parsePatch:状态机分类,首个 @@ 前的文件元数据头整段丢弃;@@ 头播种
 * 行号计数(codemoss src/utils/diff.ts parseDiff 同构),add/del/ctx 行
 * 剥掉 +/-/空格 前缀(语义由行号槽与底色承担),hunk/meta 保留原文。
 * buildSplitRows:context 行左右同源;del 块与紧随的 add 块按下标配对,
 * 余量侧置 null(渲染期斜纹占位)——codemoss DiffBlock buildSplitRows 同构。
 */

type PatchRowKind = "hunk" | "add" | "del" | "ctx" | "meta";

export interface PatchRow {
  kind: PatchRowKind;
  /** 旧文件行号(1 起);add/hunk/meta 行为 null。 */
  oldLine: number | null;
  /** 新文件行号(1 起);del/hunk/meta 行为 null。 */
  newLine: number | null;
  text: string;
  /** 同一 patch 内基础 key 重复时的出现序数(2 起;行号恒 null 的 meta 行可整段重复)。 */
  rep?: number;
}

const HUNK_RE = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

/** diff 行稳定 key:种类 + 旧/新行号 + 内容(重复行尾缀 #序数,内容组合键
 *  不用数组下标 —— react-doctor no-array-index-as-key 规则)。 */
export function patchRowKey(row: PatchRow): string {
  const base = `${row.kind}:${row.oldLine ?? "-"}:${row.newLine ?? "-"}:${row.text}`;
  return row.rep && row.rep > 1 ? `${base}#${row.rep}` : base;
}

/** 同基础 key 的行标出现序数(第 2 份起),供 patchRowKey 去重。 */
function markRepeats(rows: PatchRow[]): void {
  const seen = new Map<string, number>();
  for (const row of rows) {
    const base = `${row.kind}:${row.oldLine ?? "-"}:${row.newLine ?? "-"}:${row.text}`;
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    if (n > 1) row.rep = n;
  }
}

/**
 * 单 delta patch(git2::Patch::to_buf)= 单文件段:首个 @@ 前的行全是
 * 元数据头(diff --git / index / --- / +++ / mode / rename …),整段丢弃。
 * 状态机而非逐行前缀猜测:正文里以 +/-/@@ 开头的代码行不受误伤。
 */
export function parsePatch(text: string): PatchRow[] {
  const lines = text.split("\n");
  if (lines.at(-1) === "") lines.pop(); // 尾随换行的 split 残影
  let rows: PatchRow[] = [];
  let inHunk = false;
  let oldLine = 0;
  let newLine = 0;
  for (const line of lines) {
    if (line.startsWith("@@")) {
      const m = HUNK_RE.exec(line);
      if (m) {
        inHunk = true;
        oldLine = Number(m[1]);
        newLine = Number(m[2]);
        rows.push({ kind: "hunk", oldLine: null, newLine: null, text: line });
      } else {
        /* 形如 @@ 但头格式畸形(如 combined @@@):不播种也不沿用旧计数,
           降级为 meta 呈现。本仓 patch 源是 git2 单 delta,实际不可达,防御性。 */
        rows.push({ kind: "meta", oldLine: null, newLine: null, text: line });
      }
    } else if (inHunk) {
      if (line.startsWith("+")) {
        rows.push({ kind: "add", oldLine: null, newLine: newLine++, text: line.slice(1) });
      } else if (line.startsWith("-")) {
        rows.push({ kind: "del", oldLine: oldLine++, newLine: null, text: line.slice(1) });
      } else if (line.startsWith("\\")) {
        // "\ No newline at end of file":末尾换行语义,保留
        rows.push({ kind: "meta", oldLine: null, newLine: null, text: line });
      } else {
        rows.push({ kind: "ctx", oldLine: oldLine++, newLine: newLine++, text: line.slice(1) });
      }
    }
  }
  /* 无 @@ 的合法 patch(纯 mode 变更 / 子模块指针):没有"正文"可言,
     整段按 meta 呈现,避免 tab 空白且无任何说明。 */
  if (!inHunk) {
    rows = lines.map((line) => ({ kind: "meta" as const, oldLine: null, newLine: null, text: line }));
  }
  markRepeats(rows);
  return rows;
}

/** 双栏行:header 通栏(hunk/meta);pair 左右格,空侧 null。 */
export type SplitRow =
  | { kind: "header"; row: PatchRow }
  | { kind: "pair"; left: PatchRow | null; right: PatchRow | null };

/** 双栏配对语义:双非空且同源(buildSplitRows 的 ctx 行恒同一对象)= ctx(折叠段
 *  成员);双非空异源 = 修改对(含 del×add zip 撞出的同文对——如补尾换行,文本
 *  相同但确是改动,判 ctx 会把唯一改动藏进折叠段);单侧 = 纯删/纯增。 */
export type PairKind = "ctx" | "mod" | "del" | "add";
export const pairKind = (left: PatchRow | null, right: PatchRow | null): PairKind =>
  left && right ? (left === right ? "ctx" : "mod") : left ? "del" : "add";

/** unified 行序 → 双栏配对:ctx 同源;del 块 × add 块按下标 zip,余量留空。 */
export function buildSplitRows(rows: PatchRow[]): SplitRow[] {
  const out: SplitRow[] = [];
  let cursor = 0;
  while (cursor < rows.length) {
    const row = rows[cursor];
    if (row.kind === "hunk" || row.kind === "meta") {
      out.push({ kind: "header", row });
      cursor += 1;
      continue;
    }
    if (row.kind === "ctx") {
      out.push({ kind: "pair", left: row, right: row });
      cursor += 1;
      continue;
    }
    const dels: PatchRow[] = [];
    const adds: PatchRow[] = [];
    const metas: PatchRow[] = [];
    /* "\ No newline" meta 行会夹在 del 块与 add 块中间(无尾换行文件的标准
       输出):收集块时吸收另存、配对后按原序补发,防同一处改动被拆成两行
       各带斜纹空侧。 */
    while (rows[cursor]?.kind === "del" || rows[cursor]?.kind === "meta") {
      (rows[cursor].kind === "del" ? dels : metas).push(rows[cursor++]);
    }
    while (rows[cursor]?.kind === "add" || rows[cursor]?.kind === "meta") {
      (rows[cursor].kind === "add" ? adds : metas).push(rows[cursor++]);
    }
    const n = Math.max(dels.length, adds.length);
    for (let i = 0; i < n; i++) {
      out.push({ kind: "pair", left: dels[i] ?? null, right: adds[i] ?? null });
    }
    for (const m of metas) out.push({ kind: "header", row: m });
  }
  return out;
}

/* ── 全文态未改动段折叠(N4):连续 ctx 段整体隐去,展开入口在头部工具条
   (2026-10-10 起,就地展开胶囊废弃);规划在此(纯逻辑),渲染层只做过滤。 ── */

/** 折叠段:连续 ctx pair ≥ 折叠下限;行号区间取双侧行号。 */
export interface FoldRun {
  oldFrom: number;
  oldTo: number;
  newFrom: number;
  newTo: number;
}

const FOLD_MIN = 3;

/** 扫连续 ctx pair 段,≥ 折叠下限记为一段。 */
export function planFolds(rows: SplitRow[]): FoldRun[] {
  const runs: FoldRun[] = [];
  let i = 0;
  while (i < rows.length) {
    const row = rows[i]!;
    if (row.kind !== "pair" || pairKind(row.left, row.right) !== "ctx") {
      i += 1;
      continue;
    }
    let j = i + 1;
    while (j < rows.length) {
      const r = rows[j]!;
      if (r.kind !== "pair" || pairKind(r.left, r.right) !== "ctx") break;
      j += 1;
    }
    if (j - i >= FOLD_MIN) {
      const first = rows[i] as Extract<SplitRow, { kind: "pair" }>;
      const last = rows[j - 1] as Extract<SplitRow, { kind: "pair" }>;
      runs.push({
        oldFrom: first.left!.oldLine!,
        oldTo: last.left!.oldLine!,
        newFrom: first.right!.newLine!,
        newTo: last.right!.newLine!,
      });
    }
    i = j;
  }
  return runs;
}

/* ── 单栏折叠焦点:与双栏同下限,规划对象是 PatchRow 的连续 ctx 段
   (hunk/meta/add/del 皆断段)。 ── */

/** 扫连续 ctx 行段,≥ 折叠下限记为一段。 */
export function planUnifiedFolds(rows: PatchRow[]): FoldRun[] {
  const runs: FoldRun[] = [];
  let i = 0;
  while (i < rows.length) {
    if (rows[i]!.kind !== "ctx") {
      i += 1;
      continue;
    }
    let j = i + 1;
    while (j < rows.length && rows[j]!.kind === "ctx") j += 1;
    if (j - i >= FOLD_MIN) {
      runs.push({
        oldFrom: rows[i]!.oldLine!,
        oldTo: rows[j - 1]!.oldLine!,
        newFrom: rows[i]!.newLine!,
        newTo: rows[j - 1]!.newLine!,
      });
    }
    i = j;
  }
  return runs;
}

/** ctx 行是否落入任一折叠段(改动行单侧号,永不隐去)。 */
export function rowInFoldRun(row: PatchRow, runs: FoldRun[]): boolean {
  if (row.kind !== "ctx" || row.oldLine === null) return false;
  return runs.some((r) => row.oldLine! >= r.oldFrom && row.oldLine! <= r.oldTo);
}

/** 折叠过滤:段内 ctx 行隐去;未启用(runs = null)原数组直返。 */
export function visiblePatchRows(rows: PatchRow[], runs: FoldRun[] | null): PatchRow[] {
  if (!runs || runs.length === 0) return rows;
  return rows.filter((row) => !rowInFoldRun(row, runs));
}

/** 双栏同款过滤:只隐 ctx pair(双侧皆 ctx,左号即段号)。 */
export function visibleSplitRows(rows: SplitRow[], runs: FoldRun[] | null): SplitRow[] {
  if (!runs || runs.length === 0) return rows;
  return rows.filter(
    (row) => row.kind !== "pair" || pairKind(row.left, row.right) !== "ctx" || !rowInFoldRun(row.left!, runs),
  );
}

/** 头部折叠开关可见性判定用:按 patch 文本 + 模式规划段数(与渲染层各自规划,纯函数开销可忽略)。 */
export function countFoldRuns(text: string, split: boolean): number {
  const rows = parsePatch(text);
  return split ? planFolds(buildSplitRows(rows)).length : planUnifiedFolds(rows).length;
}
