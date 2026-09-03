/**
 * EditWatch —— PTY 输出中「AI 写入文件」标记检测(审批线 events 归因的主信号)。
 *
 * 与 AskWatch 同款主链路观察者(host.appendOutput 内联调用),但:
 * - 标记按 CLI profile 声明(editMarks: RegExp[],捕获组 1 = 路径)—— 各 CLI
 *   的工具行格式完全不同,内核不理解任何一家格式;未声明 = 该 CLI 不启用
 *   events 归因,审批线回退 git 窗口推断(旧行为)。
 * - 按行匹配(标记完整出现在一行内),行缓冲跨分片拼接;ANSI 剥离复用
 *   askWatch 的 stripAnsi。
 * - 路径归一:剥引号/空白与 "./" 前缀;绝对路径限会话 cwd 之内相对化;
 *   `~`、父级逃逸、空串一律丢弃(标记文本不可信,Rust 侧 record_edit 再守一道)。
 * - 轮内去重:同轮同路径只报一次;用户写入(writeSession,幕布击键含)即开新轮清集。
 *
 * 误报纪律:宁可漏报不可误报 —— 手改文件绝不能因检测噪声混入 AI 批次
 * (作者设计点:节点 = AI 的变更)。标记选词只认工具行字面量,助手正文
 * 概率极低;漏报的文件退化为 git 可见的普通 dirty,不进批次、不破坏磁盘。
 */

import { stripAnsi } from "./askWatch";

/** 行缓冲上限:防超长单行(TUI 罕见)撑爆内存;尾部足够装下任何标记行。 */
const LINE_BUFFER_MAX = 8 * 1024;

/** 每会话状态:未完结行的缓冲 + 本轮已上报路径(去重集)。 */
interface EditTail {
  lineBuf: string;
  reported: Set<string>;
}

/** 按通用分隔符切出完整行,残余留在缓冲。 */
function splitLines(buf: string): { lines: string[]; rest: string } {
  const lines: string[] = [];
  let rest = buf;
  for (;;) {
    const i = rest.search(/\r\n|\n|\r/);
    if (i === -1) break;
    lines.push(rest.slice(0, i));
    rest = rest.slice(i + (rest[i] === "\r" && rest[i + 1] === "\n" ? 2 : 1));
  }
  return { lines, rest };
}

/**
 * 标记捕获的路径文本 → 仓库相对路径;不可信(逃逸/家目录/空)返回 null。
 * 导出供测试。
 */
export function normalizeEditPath(raw: string, cwd: string): string | null {
  let p = raw.trim().replace(/^["'`]|["'`]$/g, "").trim();
  if (!p || p === "." || p === "..") return null;
  if (p.startsWith("~/")) return null; // CLI 展开的 home 路径不在工作区内
  if (p.startsWith("./") || p.startsWith(".\\")) p = p.slice(2);
  if (p.startsWith("/")) {
    // 绝对路径:仅当落在会话 cwd 内才相对化(含 cwd 为软链前缀等简单情形)
    const prefix = cwd.endsWith("/") ? cwd : cwd + "/";
    if (!p.startsWith(prefix)) return null;
    p = p.slice(prefix.length);
  }
  if (!p || p.startsWith("/") || p.startsWith("~")) return null;
  // 父级逃逸(含 Windows 盘符残留)拒绝
  if (p.split("/").some((seg) => seg === ".." || seg === "")) return null;
  if (/^[a-zA-Z]:/.test(p)) return null;
  return p;
}

export class EditWatch {
  private readonly tails = new Map<string, EditTail>();

  private tail(sessionId: string): EditTail {
    let t = this.tails.get(sessionId);
    if (!t) {
      t = { lineBuf: "", reported: new Set() };
      this.tails.set(sessionId, t);
    }
    return t;
  }

  /**
   * 喂一段 PTY 输出,返回本轮新增命中的路径(仓库相对、已去重)。
   * marks 为空数组/null = 该会话未声明检测,直接短路。
   */
  onOutput(sessionId: string, text: string, cwd: string, marks: readonly RegExp[] | null): string[] {
    if (!marks || marks.length === 0 || !cwd) return [];
    const t = this.tail(sessionId);
    // 组装待匹配行:缓冲 + 新文本(剥 ANSI 后按行切)
    const combined = t.lineBuf + stripAnsi(text);
    const { lines, rest } = splitLines(combined);
    t.lineBuf = rest.length > LINE_BUFFER_MAX ? "" : rest;
    const fresh: string[] = [];
    for (const line of lines) {
      for (const re of marks) {
        const m = re.exec(line);
        if (!m) continue;
        const p = normalizeEditPath(m[1] ?? "", cwd);
        if (!p) continue;
        if (!t.reported.has(p)) {
          t.reported.add(p);
          fresh.push(p);
        }
        break; // 一行至多取一个标记命中(避免同行多正则重复)
      }
    }
    return fresh;
  }

  /** 用户写入 = 新一轮:清去重集(prompt 打锚在先,事件从此重新计入)。 */
  onUserWrite(sessionId: string): void {
    this.tails.get(sessionId)?.reported.clear();
  }

  onSessionRemoved(sessionId: string): void {
    this.tails.delete(sessionId);
  }
}
