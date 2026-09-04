/**
 * omp 会话写入事件适配器(readSessionEdits)—— 审批线 events 归因第二信号源。
 *
 * 数据源 = omp 自己的会话 JSONL(~/.omp/agent/sessions/<slug>/<iso-ts>_<uuid>.jsonl,
 * 与用户消息锚点同目录;条目形态实证自 2026-09-03 真实会话文件):
 * - edit / write 工具结果正文首行是 hashline 快照头 `[path#TAG]`(TAG = 4 位
 *   十六进制),path 即本次写入的文件;一次调用跨文件移动代码时逐文件各有一行;
 * - write 结果另带 details.resolvedPath(已解析绝对路径),正文兜底为
 *   "Successfully wrote N bytes to <path>"。
 * 事件时刻取条目自身 timestamp(omp 自记,ms 精度),不是观测时刻 —— 消费方的
 * 水位线增量与 Rust record_edit 的迟到守卫(早于锚点 = 上一轮,丢弃)都靠它。
 *
 * 并行会话正确的关键:每会话一个 JSONL,本文件只读本会话的流,别的会话写了
 * 什么在这里根本不可见 —— PTY 输出标记(editMarks)与 git 窗口推断都做不到
 * (用户报的"两会话审批线互相串批"即后两者结构性缺陷)。
 *
 * 纪律:宁可漏报不可误报。解析失败/路径不可信一律跳过;误报的路径即使混入,
 * 封口时净零变更不入批(前后像一致自动剔除),不破坏批次可信度。
 */

import type { CliSessionEdit } from "@kernel/cli";
import { normalizeEditPath } from "@kernel/editWatch";
import { ipc } from "@kernel/ipc";
import { findJsonlSessionFile } from "../cli-shared/userMessages";
import { parseEditEventsFromText, readEditsTail } from "../cli-shared/sessionEdits";


/** edit/write 之外的工具(read/grep/bash/todo…)不落业务文件,行预筛直接跳过。 */
const WRITE_TOOLS: Record<string, true> = { edit: true, write: true };

/** hashline 快照头:行首锚定 `[path#TAG]`;正文里的引用/代码不匹配。 */
const HASHLINE_HEADER = /^\[([^[\]]+)#[0-9A-Fa-f]{4}\]/;

/** write 正文兜底(details 缺失时)。 */
const WRITE_OK = /^Successfully wrote \d+ bytes to (.+)$/;

/**
 * omp 磁盘会话目录(与 index 的 listSessions/status 共用;实证 slug 规则见彼处)。
 * 放本文件避免 index ↔ edits 循环 import。
 */
export function ompSessionsDir(cwd: string): Promise<string | null> {
  return ipc.configHomeDir().then((home) => {
    if (!home) return null;
    /* 分隔符归一:Windows 的 home/cwd 都是反斜杠形态,不归一则前缀判断
       与 slug 生成全部失配 → 会话目录永远找不到。slug 规则本身不变。 */
    const homeNorm = home.replace(/\\/g, "/");
    const cwdNorm = cwd.replace(/\\/g, "/");
    /* 路径边界:/Users/foo2/x 不得误判在 home /Users/foo 之下。 */
    const inHome = cwdNorm === homeNorm || cwdNorm.startsWith(homeNorm + "/");
    const slug = inHome
      ? cwdNorm.slice(homeNorm.length).replace(/\//g, "-")
      : `-${cwdNorm.replace(/\//g, "-")}-`;
    return `${home}/.omp/agent/sessions/${slug}`;
  });
}


/** 一行已解析 JSON → 写入事件(非 edit/write 工具结果返回空)。 */
function editEventsOf(entry: Record<string, unknown>, cwd: string): CliSessionEdit[] {
  if (!("message" in entry) || typeof entry.message !== "object" || entry.message === null) {
    return [];
  }
  const raw = entry.message as Record<string, unknown>; // 已 narrowing 为 object,收窄字段在下方逐一 typeof 守卫
  if (raw.role !== "toolResult" || typeof raw.toolName !== "string") return [];
  if (!WRITE_TOOLS[raw.toolName]) return [];
  const ts = Date.parse(typeof entry.timestamp === "string" ? entry.timestamp : "");
  if (!Number.isFinite(ts)) return [];

  const raws = new Set<string>();
  const details = raw.details;
  if (
    raw.toolName === "write" &&
    typeof details === "object" &&
    details !== null &&
    "resolvedPath" in details &&
    typeof details.resolvedPath === "string"
  ) {
    raws.add(details.resolvedPath);
  }
  if (Array.isArray(raw.content)) {
    for (const block of raw.content) {
      const text =
        typeof block === "object" && block !== null && "text" in block && typeof block.text === "string"
          ? block.text
          : undefined;
      if (typeof text !== "string") continue;
      for (const line of text.split("\n")) {
        const m = HASHLINE_HEADER.exec(line);
        if (m) raws.add(m[1]);
      }
      if (raws.size === 0 && raw.toolName === "write") {
        for (const line of text.split("\n")) {
          const m = WRITE_OK.exec(line);
          if (m) raws.add(m[1]);
        }
      }
  }
}
  /* 同一写入的多种路径形态(write 的 resolvedPath 与 hashline 头)归一后去重 */
  const paths = new Set<string>();
  for (const r of raws) {
    const path = normalizeEditPath(r, cwd);
    if (path) paths.add(path);
  }
  return [...paths].map((path) => ({ path, ts }));
}

/**
 * 从 omp 会话 JSONL 文本提取写入事件(纯函数,可测)。
 * sinceTs = 水位线:只返回 ts > sinceTs 的事件;循环契约见 cli-shared/sessionEdits.ts。
 */
export function parseOmpEditEvents(text: string, sinceTs: number, cwd: string): CliSessionEdit[] {
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
 * 文件尚不存在(懒 flush:omp 首条消息才建文件)返回 [],不是失败;
 * 尾窗读取失败返回 null(调用方保水位线重试)。
 */
export async function readOmpSessionEdits(
  cwd: string,
  cliSessionId: string,
  sinceTs: number,
): Promise<CliSessionEdit[] | null> {
  const dir = await ompSessionsDir(cwd);
  if (!dir) return null;
  return readEditsTail(
    await findJsonlSessionFile(dir, cliSessionId),
    sinceTs,
    cwd,
    parseOmpEditEvents,
  );
}
