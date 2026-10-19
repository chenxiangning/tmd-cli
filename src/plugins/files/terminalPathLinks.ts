/**
 * 终端文件路径可点击 —— 幕布裸路径点击 → 打开文件 tab 并跳行(marks 回链同款通道,
 * 复用其 ABS_PATH_RE 判定思路)。cwd 天花板:相对路径按「点击时激活会话」spawn cwd 拼,
 * PTY 内 cd 不追踪(OSC 7 shell 集成因多平台差异被否,feasibility §1)。绝对路径仅认
 * 工作区 root 内;root 外/不存在静默(与 marks 一致);col 忽略只跳行。
 */
import { ipc } from "@kernel/ipc";
import { host } from "@kernel/host";
import { openFileAtLine } from "@kernel/fileTabs";
import type { TerminalLinkHit, TerminalLinkProvider } from "@kernel/terminalLinks";
import { getActiveWorkspace } from "@kernel/workspace";

/**
 * 候选路径正则:绝对(POSIX / ~/ 盘符 / UNC)与相对(至少含一处分隔符,防裸词误命中);
 * 尾部可带 :line 或 :line:col;空格续段自身须再含分隔符,防把散文吃进路径。
 * ponytail: 引号包裹的空格路径与「a.ts and dir/b.ts」合链等边角不做精确边界,
 * 升级路径 = 引号感知扫描(成本超 S 项预算)。
 */
const PATH_RE =
  /(?<![\w:.~-])(?:\/|~[/\\]|\.{1,2}[/\\]|[A-Za-z]:[/\\]|\\\\|[\w~-]+[/\\])[^\s"'<>|*?:]*(?: [^/\\]*[/\\][^\s"'<>|*?:]*)*(?::\d{1,6}(?::\d{1,6})?)?/g;

const ABS_RE = /^(?:\/|[A-Za-z]:[\\/]|\\\\)/;
/** URL 段先整段挖掉再扫路径:防 https://host/a.ts 的 host/a.ts 尾巴误成链。 */
const URL_RE = /[a-z][a-z0-9+.-]*:\/\/[^\s"'<>]*/gi;

/** 命中文本 → {路径, 行};col 忽略(reveal 契约只有 line),无行号默认 1。 */
export function parsePathHit(text: string): { path: string; line: number } | null {
  const m = /^(.*?)(?::(\d{1,6}))?(?::\d{1,6})?$/.exec(text);
  return m && m[1] ? { path: m[1], line: m[2] ? Number(m[2]) : 1 } : null;
}

/** cwd 拼相对路径并消除 . / .. 段(分隔符归一 /)。 */
function joinCwd(cwd: string, rel: string): string {
  const out: string[] = [];
  for (const seg of `${cwd}/${rel}`.replace(/\\/g, "/").split("/")) {
    if (seg === "..") out.pop();
    else if (seg !== "." && seg !== "") out.push(seg);
  }
  const joined = out.join("/");
  // Windows 盘符段(C:)不加前导 /,否则 /C:/repo 形态 inRoot 恒 false
  return /^[A-Za-z]:/.test(joined) ? joined : `/${joined}`;
}

/** win 平台路径大小写不敏感(盘符/目录大小写与注册 root 不一致时保命中);
 *  返回值仍用原大小写形式,真实盘面按原样读。 */
const CASE_FOLD = /^win/i.test(globalThis.navigator?.platform ?? "")
  ? (s: string) => s.toLowerCase()
  : (s: string) => s;

/** root 前缀守卫:返回 root 内归一绝对路径,区外返回 null(静默)。 */
function inRoot(abs: string, root: string): string | null {
  const an = abs.replace(/\\/g, "/");
  const r = CASE_FOLD(root.replace(/\\/g, "/").replace(/\/+$/, ""));
  const a = CASE_FOLD(an);
  return a === r || a.startsWith(`${r}/`) ? an : null;
}

/** 路径 → root 内绝对路径(~/ 经 configHomeDir 展开;相对按激活会话 spawn cwd 拼)。 */
export async function resolvePath(path: string, root: string): Promise<string | null> {
  if (path.startsWith("~/")) return inRoot(joinCwd(await ipc.configHomeDir(), path.slice(2)), root);
  /* 绝对路径同样过 joinCwd 归一:`/repo/../../etc/x` 裸前缀比较会以 /repo/
     通过 inRoot,读到区外文件违背「仅认工作区 root 内」契约 */
  if (ABS_RE.test(path)) return inRoot(joinCwd("", path), root);
  const id = host.getActiveSessionId();
  const cwd = (id && host.getSessions().find((s) => s.id === id)?.cwd) || root;
  return inRoot(joinCwd(cwd, path), root);
}

/** open 的异步真身:区外/不存在静默;存在则开 tab 并跳行。导出供测试直调。 */
export async function openPathHit(path: string, line: number, root: string): Promise<void> {
  const abs = await resolvePath(path, root);
  if (!abs) return;
  await ipc.fsReadTail(abs, 1).then(
    () => openFileAtLine(abs, line),
    () => {},
  );
}

/** 尾部剥标点与配对闭合符:`(见 /repo/a.ts)` 括号包裹是 AI 输出高频形态,
 *  连闭符进链必致 fsReadTail 静默死链;配对符仅在闭多于开时剥(路径本身
 *  合法尾括号保留)。 */
function stripTrailingPunct(s: string): string {
  let end = s.length;
  for (;;) {
    const ch = s[end - 1];
    if (end === 0 || !/[.,;)\]}]/.test(ch)) return s.slice(0, end);
    const pair = ch === ")" ? "(" : ch === "]" ? "[" : ch === "}" ? "{" : null;
    if (pair) {
      let open = 0;
      let close = 0;
      for (const c of s.slice(0, end)) {
        if (c === pair) open++;
        else if (c === ch) close++;
      }
      if (close <= open) return s.slice(0, end);
    }
    end--;
  }
}

export const filePathLinkProvider: TerminalLinkProvider = {
  id: "files.pathlink",
  find(lineText) {
    if (!lineText) return [];
    const out: TerminalLinkHit[] = [];
    /* URL 段挖掉后逐段扫描,命中下标按原行换算 */
    let segStart = 0;
    const segs: { text: string; offset: number }[] = [];
    for (const u of lineText.matchAll(URL_RE)) {
      segs.push({ text: lineText.slice(segStart, u.index), offset: segStart });
      segStart = u.index + u[0].length;
    }
    segs.push({ text: lineText.slice(segStart), offset: segStart });
    for (const seg of segs) {
      PATH_RE.lastIndex = 0;
      for (let m = PATH_RE.exec(seg.text); m; m = PATH_RE.exec(seg.text)) {
        const path = stripTrailingPunct(m[0]);
        if (!path || path.includes("://")) continue;
        /* 空格路径须含分隔符(sendTransform.ts 同款防误吃) */
        if (path.includes(" ") && !/[\\/]/.test(path)) continue;
        out.push({ start: seg.offset + m.index, end: seg.offset + m.index + path.length });
      }
    }
    return out;
  },
  open(hit, lineText) {
    const root = getActiveWorkspace()?.root;
    if (!root) return;
    const parsed = parsePathHit(lineText.slice(hit.start, hit.end));
    if (parsed) void openPathHit(parsed.path, parsed.line, root);
  },
};
