/**
 * bash 写盘命令的目标路径提取 —— 审批线 events 归因的 bash 补充信号。
 *
 * 背景(2026-09-25 实证,012210c):AI 用 `sd` / `perl -pi` 批量替换仓库文件走
 * bash 工具,edit/write 工具结果里没有这些路径 —— 一轮 28 个文件只有 13 个
 * edit 工具路径入账,15 个 bash 改写文件账本不可见却进了同一提交,审批线与
 * git 面板长期对不上的主要残源。本模块从会话 JSONL assistant 消息的 bash
 * toolCall 命令文本按「已知原地写盘命令形态」白名单提取目标路径:命令在本
 * 会话自己的事件流里 = 该会话的正面写入证据,不经 mtime 窗口推断,泄露隔离
 * 定约(2026-09-05)不破。
 *
 * 纪律:宁可漏报不可误报 —— cp/mv/构建器写盘等未建模形态继续盲;残留误报
 * 代价低(封口净零变更短路,不虚增批),漏报代价高(账本与 git 永久对不上)。
 */

import type { CliSessionEdit } from "@kernel/cli";
import { normalizeEditPath } from "@kernel/editWatch";

/** 段 token:sep = 命令分隔符;引号内字符不参与分词与分段。 */
interface Tok {
  readonly t: string;
  readonly sep: boolean;
}

/**
 * 命令文本 → 简单命令段列表。引号整段保留(剥引号,空串也算 token:
 * BSD sed -i 的空后缀实参);`2>&1` 的 & 分段无害 —— 段只剩 fd 残片,
 * 重定向扫描按规则丢弃。
 */
function lex(cmd: string): Tok[][] {
  const segs: Tok[][] = [];
  let cur: Tok[] = [];
  let str = "";
  let has = false;
  let quote: string | null = null;
  const flush = () => {
    if (has) {
      cur.push({ t: str, sep: false });
      str = "";
      has = false;
    }
  };
  const cut = () => {
    flush();
    if (cur.length > 0) segs.push(cur);
    cur = [];
  };
  for (let i = 0; i < cmd.length; i++) {
    const ch = cmd[i];
    if (quote !== null) {
      if (ch === quote) quote = null;
      else str += ch;
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      has = true;
      continue;
    }
    if (ch === "\n" || ch === ";" || ch === "|" || ch === "&") {
      cut();
      if ((ch === "&" || ch === "|") && cmd[i + 1] === ch) i++;
      continue;
    }
    if (ch === " " || ch === "\t" || ch === "\r") {
      flush();
      continue;
    }
    str += ch;
    has = true;
  }
  cut();
  return segs;
}

/** 可作路径实参的 token:旗标、命令替换、URL 实参不算。 */
function pathLike(t: string): boolean {
  return t !== "" && !t.startsWith("-") && !t.startsWith("$") && !t.includes("://");
}

/** 残留元字符(glob/替换/拼接)的 token 不是可信任的单一路径,拒收宁漏。 */
const SUSPECT = /[$`*?[\]{}<>|;()\\'"!#&]/;

/** 已知原地写盘命令形态的逐段提取(sd / sed -i / perl -i / tee)。 */
function commandTargets(head: string, toks: readonly Tok[]): string[] {
  const args = toks.slice(1).map((x) => x.t);
  if (head === "sd") {
    if (args.some((a) => a === "-p" || a.startsWith("--preview"))) return [];
    const plain = args.filter(pathLike);
    return plain.length > 2 ? plain.slice(2) : []; /* 前 2 个 = 匹配式与替换式 */
  }
  if (head === "sed") {
    if (args.some((a) => a === "-e" || a === "-f" || a.startsWith("--expression") || a.startsWith("--file")))
      return [];
    const i = args.findIndex((a) => a.startsWith("-i") || a.startsWith("--in-place"));
    if (i < 0) return [];
    let rest = args.slice(i + 1);
    /* BSD sed -i 的后缀是独立实参(常为空串);GNU 附着(-i.bak)已被 -i 前缀吞入。 */
    if (rest[0] === "" || /^\.[A-Za-z]/.test(rest[0] ?? "")) rest = rest.slice(1);
    return rest.filter(pathLike).slice(1); /* 首个 = 脚本,其余 = 文件 */
  }
  if (head === "perl") {
    let inplace = false;
    const files: string[] = [];
    for (let k = 0; k < args.length; k++) {
      const a = args[k];
      if (a.startsWith("-")) {
        /* 组合旗标:-pe/-ne 的 e/f 吞脚本实参;-pi/-i[ext] 含 i 即原地写 */
        if (/^-[A-Za-z]*[ef]$/.test(a)) k++;
        if (/^-[A-Za-z]*i/.test(a)) inplace = true;
        continue;
      }
      if (inplace && pathLike(a)) files.push(a);
    }
    return files;
  }
  if (head === "tee") return args.filter(pathLike);
  return [];
}

/** `>` / `>>` 重定向目标(含 `>f` / `>>f` / `2>f` / `2>>f` 空格与粘连两形态;
 *  `&` 是分段符,`cmd &>f` 经分词即 `>f`,引号里的 "&>x" 因此不会被误判)。
 *  fd 复制(2>&1 分词后只剩孤立残片段)与 /dev/* 不算业务路径。 */
function redirectTargets(toks: readonly Tok[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i].t;
    let target: string | undefined;
    if (t === ">" || t === ">>" || /^\d>{1,2}$/.test(t)) target = toks[i + 1]?.t;
    else if (/^\d>>/.test(t)) target = t.slice(3);
    else if (/^\d>/.test(t)) target = t.slice(2);
    else if (t.startsWith(">>")) target = t.slice(2);
    else if (t.length > 1 && t.startsWith(">")) target = t.slice(1);
    if (!target || !pathLike(target) || target.startsWith("/dev/")) continue;
    out.push(target);
  }
  return out;
}

/**
 * 单条 bash 命令 → 已知写盘形态的目标路径集(去重)。归一(cwd 相对化、
 * 可信度终审)在调用侧 normalizeEditPath;此处只做命令形态白名单。
 */
export function bashWritePaths(command: string): string[] {
  const out = new Set<string>();
  for (const seg of lex(command)) {
    const head = (seg[0]?.t ?? "").replace(/^.*\//, "");
    for (const p of commandTargets(head, seg)) out.add(p);
    for (const p of redirectTargets(seg)) out.add(p);
  }
  return [...out].filter((p) => !SUSPECT.test(p) && !p.startsWith("/dev/"));
}

/**
 * assistant 消息 content 内的 shell toolCall → 写入事件。omp 实证 name=bash、
 * pi 实证 name=ctx_shell,同以 arguments.command 携带命令文本;非命中形态
 * (工具名不带 bash/shell、无 command 实参、命令无已知写盘形态)返回空。
 * 误报由封口净零变更短路自愈(见 omp edits.ts 头部纪律)。
 */
export function bashToolCallEvents(
  raw: Record<string, unknown>,
  ts: number,
  cwd: string,
): CliSessionEdit[] {
  if (!Number.isFinite(ts) || !Array.isArray(raw.content)) return [];
  const paths = new Set<string>();
  for (const block of raw.content) {
    if (typeof block !== "object" || block === null) continue;
    const b = block as Record<string, unknown>;
    if (b.type !== "toolCall") continue;
    const name = typeof b.name === "string" ? b.name : "";
    if (!/bash|shell/.test(name)) continue;
    const args = b.arguments;
    const cmd =
      typeof args === "object" &&
      args !== null &&
      typeof (args as Record<string, unknown>).command === "string"
        ? ((args as Record<string, unknown>).command as string)
        : undefined;
    if (!cmd) continue;
    for (const p of bashWritePaths(cmd)) {
      const path = normalizeEditPath(p, cwd);
      if (path) paths.add(path);
    }
  }
  return [...paths].map((path) => ({ path, ts }));
}
