/**
 * pi 会话写入事件适配器(readSessionEdits)—— 审批线 events 归因第二信号源。
 *
 * 数据源 = pi 自己的会话 JSONL(~/.pi/agent/sessions/<slug>/<iso-ts>_<uuid>.jsonl,
 * 与 omp 同为 pi 族布局;条目形态实证自 2026-09-02 真实会话文件):
 * - edit 工具结果:"Successfully replaced N block(s) in <abs path>."(句点收尾);
 * - write 工具结果:"Successfully wrote N bytes to <abs path>"。
 * 与 omp 分叉:pi 上游 edit 是 str_replace 语义,结果正文不带 hashline 快照头,
 * 路径只能从结果正文提取 —— 两 CLI 契约各自演进,不暗中复用 omp 解析。
 *
 * 并行会话正确的关键与 omp 相同:每会话一个 JSONL,本会话的流里看不到别的
 * 会话写了什么;git 窗口推断(mtime「最近提示者赢」)在重叠轮次下做不到。
 */

import type { CliSessionEdit } from "@kernel/cli";
import { normalizeEditPath } from "@kernel/editWatch";
import { piAgentDir } from "./quota";
import { findJsonlSessionFile } from "../cli-shared/userMessages";
import { parseEditEventsFromText, readEditsTail } from "../cli-shared/sessionEdits";


/** edit/write 之外的工具(ctx_shell/ctx_read/web_search…)不落业务文件,行预筛跳过。 */
const WRITE_TOOLS: Record<string, true> = { edit: true, write: true };

/** edit 结果:Successfully replaced N block(s) in <abs path>. */
const EDIT_OK = /^Successfully replaced \d+ block\(s\) in (.+)\.$/;

/** write 结果:Successfully wrote N bytes to <abs path>(无句点收尾)。 */
const WRITE_OK = /^Successfully wrote \d+ bytes to (.+)$/;

/**
 * pi 磁盘会话目录(slug 规则与 omp 不同:两侧各包 "--",实证注释随实现)。
 * 单一来源放本文件,index.tsx 复用,避免双向循环 import。
 */
export async function piSessionsDir(cwd: string): Promise<string | null> {
  const agentDir = await piAgentDir().catch(() => null);
  if (!agentDir) return null;
  /* 分隔符归一:Windows cwd 是反斜杠形态,不归一则 slug 永不失配。
     slug 规则本身不变:去前导斜杠 → 分隔符转 "-"。 */
  const cwdNorm = cwd.replace(/\\/g, "/");
  const slug = `--${cwdNorm.replace(/^\/+/, "").replace(/\//g, "-")}--`;
  return `${agentDir}/sessions/${slug}`;
}

/** 一行已解析 JSON → 写入事件(非 edit/write 工具结果返回空)。 */
function editEventsOf(entry: Record<string, unknown>, cwd: string): CliSessionEdit[] {
  if (!("message" in entry) || typeof entry.message !== "object" || entry.message === null) {
    return [];
  }
  const raw = entry.message as Record<string, unknown>; // 已 narrowing 为 object,字段在下方逐一守卫
  if (raw.role !== "toolResult" || typeof raw.toolName !== "string") return [];
  if (!WRITE_TOOLS[raw.toolName]) return [];
  const ts = Date.parse(typeof entry.timestamp === "string" ? entry.timestamp : "");
  if (!Number.isFinite(ts)) return [];

  const paths = new Set<string>();
  if (Array.isArray(raw.content)) {
    for (const block of raw.content) {
      const text =
        typeof block === "object" && block !== null && "text" in block && typeof block.text === "string"
          ? block.text
          : undefined;
      if (typeof text !== "string") continue;
      for (const line of text.split("\n")) {
        const m = raw.toolName === "edit" ? EDIT_OK.exec(line) : WRITE_OK.exec(line);
        if (!m) continue;
        const path = normalizeEditPath(m[1], cwd);
        if (path) paths.add(path);
      }
    }
  }
  return [...paths].map((path) => ({ path, ts }));
}

/**
 * 从 pi 会话 JSONL 文本提取写入事件(纯函数,可测)。
 * sinceTs = 水位线:只返回 ts > sinceTs 的事件;循环契约见 cli-shared/sessionEdits.ts。
 */
export function parsePiEditEvents(text: string, sinceTs: number, cwd: string): CliSessionEdit[] {
  return parseEditEventsFromText(
    text,
    sinceTs,
    cwd,
    (line) => line.startsWith('{"type":"message"'),
    editEventsOf,
  );
}

/**
 * readSessionEdits 实现:定位本会话 JSONL → 尾窗读 → 解析增量事件。
 * 文件尚不存在返回 [];尾窗读取失败返回 null(调用方保水位线重试)。
 */
export async function readPiSessionEdits(
  cwd: string,
  cliSessionId: string,
  sinceTs: number,
): Promise<CliSessionEdit[] | null> {
  const dir = await piSessionsDir(cwd);
  if (!dir) return null;
  return readEditsTail(
    await findJsonlSessionFile(dir, cliSessionId),
    sinceTs,
    cwd,
    parsePiEditEvents,
  );
}
