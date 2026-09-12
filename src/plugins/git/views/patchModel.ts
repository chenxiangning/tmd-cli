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
}

const HUNK_RE = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

/**
 * 单 delta patch(git2::Patch::to_buf)= 单文件段:首个 @@ 前的行全是
 * 元数据头(diff --git / index / --- / +++ / mode / rename …),整段丢弃。
 * 状态机而非逐行前缀猜测:正文里以 +/-/@@ 开头的代码行不受误伤。
 */
export function parsePatch(text: string): PatchRow[] {
  const lines = text.split("\n");
  if (lines.at(-1) === "") lines.pop(); // 尾随换行的 split 残影
  const rows: PatchRow[] = [];
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
    return lines.map((line) => ({ kind: "meta" as const, oldLine: null, newLine: null, text: line }));
  }
  return rows;
}

/** 双栏行:header 通栏(hunk/meta);pair 左右格,空侧 null。 */
export type SplitRow =
  | { kind: "header"; row: PatchRow }
  | { kind: "pair"; left: PatchRow | null; right: PatchRow | null };

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
