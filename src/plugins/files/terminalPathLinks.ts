/**
 * 终端文件路径可点击 —— 幕布裸路径点击 → 打开文件 tab 并跳行(marks 回链同款通道,
 * 复用其 ABS_PATH_RE 判定思路)。cwd 天花板:相对路径按「点击时激活会话」spawn cwd 拼,
 * PTY 内 cd 不追踪(OSC 7 shell 集成因多平台差异被否,feasibility §1)。路径不再限制
 * 工作区 root 内 —— 本机任意路径(~ 展开 / 绝对 / cwd 相对)存在即开 tab;
 * 不存在静默;col 忽略只跳行。
 */
import { ipc } from "@kernel/ipc";
import { host } from "@kernel/host";
import { openFileAtLine } from "@kernel/fileTabs";
import type { TerminalLinkHit, TerminalLinkProvider } from "@kernel/terminalLinks";
import { getActiveWorkspace } from "@kernel/workspace";

/**
 * 候选路径正则:绝对(POSIX / ~/ 盘符 / UNC)与相对(至少含一处分隔符,防裸词误命中);
 * 尾部可带 :line 或 :line:col;空格续段自身须再含分隔符,防把散文吃进路径;
 * 多文件同行(「a/x.ts b/y.ts」「a/x.ts, b/y.ts」、diff 头「a/x.ts +++ b/x.ts」)按头段完整尾
 * (扩展名/:line)切割成各自独立链,不再合并成一条死链。
 * ponytail: 引号包裹的空格路径不做精确边界,升级路径 = 引号感知扫描(成本超预算)。
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
  // Windows 盘符段(C:)不加前导 /
  return /^[A-Za-z]:/.test(joined) ? joined : `/${joined}`;
}

/** 路径 → 本机绝对路径(~/ 经 configHomeDir 展开;相对按激活会话 spawn cwd 拼;
 *  .. 消除)。不校验存在性,不限制工作区。 */
export async function resolvePath(path: string, root: string): Promise<string> {
  if (path.startsWith("~/")) return joinCwd(await ipc.configHomeDir(), path.slice(2));
  if (ABS_RE.test(path)) return joinCwd("", path);
  const id = host.getActiveSessionId();
  const cwd = (id && host.getSessions().find((s) => s.id === id)?.cwd) || root;
  return joinCwd(cwd, path);
}

/** open 的异步真身:存在则开 tab 并跳行;不存在/展开失败静默。导出供测试直调。 */
export async function openPathHit(path: string, line: number, root: string): Promise<void> {
  try {
    const abs = await resolvePath(path, root);
    await ipc.fsReadTail(abs, 1).then(
      () => openFileAtLine(abs, line),
      () => {},
    );
  } catch {
    /* configHomeDir 等展开失败:与不存在同律静默 */
  }
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

/** 头段完整尾判定:带扩展名或 :line(/:col)尾 —— 多文件分割的判据。 */
const COMPLETE_TAIL = /\.[A-Za-z0-9]{1,8}$|:\d{1,6}(?::\d{1,6})?$/;

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
        let raw = m[0];
        /* 多文件合链切割:空格续段/逗号边界把「a/x.ts b/y.ts」「a/x.ts, b/y.ts」吞成
           一条命中(点击整段解析成死链)。头段自身已是完整路径(带分隔符 + 扩展名/:line
           尾)时只收头段,扫描指针退回头段末,后续文件独立成链;路径中部逗号(头段无
           完整尾)不误切,真空格路径(/My Dir/f.ts)头段无扩展名尾,不受影响。 */
        const sp = raw.indexOf(" ");
        const cm = raw.indexOf(",");
        const b = sp < 0 ? cm : cm < 0 ? sp : Math.min(sp, cm);
        if (b > 0) {
          const head = raw.slice(0, b);
          if (/[\\/]/.test(head) && COMPLETE_TAIL.test(head)) {
            raw = head;
            PATH_RE.lastIndex = m.index + b;
          }
        }
        const path = stripTrailingPunct(raw);
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
