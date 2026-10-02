/**
 * 会话 transcript 获取:定位 CLI 磁盘 jsonl(omp/pi/claude/codex/kimi)→ 尾部窗口 → 解析。
 * 路径发现只用已放行的 fs 只读面(fs_list_dir/fs_collect_files/fs_read_head/
 * fs_read_file/fs_read_tail);找不到/读不到一律返回 null,UI 回落现有 PTY 尾流 —— 不阻塞会话屏。
 * 形状契约:ipc.ts 的 invoke 签名(path/maxBytes/dir/suffix)+ DirEntry/FileStamp。
 * codex/kimi 的行解析复用各插件纯函数行解析器(经 @plugins,契约准入):
 * 输入 = 文件内容字符串,零 ipc/多文件依赖,契合手机树复用边界。
 */
import { parseTranscript, tailTurns, type TranscriptTurn } from "@kernel/transcript";
import { stripAnsi } from "@kernel/askDetect";
import { shellLog } from "@kernel/shellBridge";
import { invoke } from "@kernel/transport";
import { pathsEqual } from "@kernel/pathUtils";
import { getPlatformKind } from "@kernel/platform";
import type { CliTranscriptBlock } from "@kernel/cli";
import {
  parseTranscriptBlocks,
  pairToolResults,
  type TranscriptLineParser,
} from "@plugins/cli-shared/sessionTranscript";
import { codexTranscriptLine } from "@plugins/cli-codex/codexTranscript";
import { extractMeta, HEAD_BYTES } from "@plugins/cli-codex/sessionStatus";
import { kimiTranscriptLine } from "@plugins/cli-kimi/kimiTranscript";
import { parseKimiState } from "@plugins/cli-kimi/kimiSessions";
/* slug 构造复用桌面权威实现(评审 P1-1:目录名反匹配双侧恒不等,transcript 层全灭):
 * pi `--cwd--`、omp `-cwd-`、claude 全非字母数字划一,全在插件侧单一来源;
 * 根目录也由适配器给出(omp 在 ~/.omp,旧实现误查 ~/.pi)。 */
import { claudeSessionsDir } from "@plugins/cli-claude/sessions";
import { ompSessionsDir } from "@plugins/cli-omp/edits";
import { piSessionsDir } from "@plugins/cli-pi/edits";

const TAIL_BYTES = 256 * 1024;
/** 尾窗轮数上限(截断提示锚点:达限即提示更早内容去桌面看)。 */
export const MAX_TURNS = 40;
/** 候选定位上限:codex/kimi 归属校验要逐文件读头,每拍最多探测 N 个(mtime 倒序)。 */
const PROBE_LIMIT = 6;
/** 单 turn 渲染上限(与内核 transcript 同口径:正文保换行,工具摘要压单行)。 */
const TURN_MAX = 600;

/** 尾窗截断判定(纯函数,测试锚定):轮数达上限 = 有更早内容被截掉。 */
export function isTailTruncated(turns: TranscriptTurn[]): boolean {
  return turns.length >= MAX_TURNS;
}

interface FileStamp {
  path: string;
  modifiedAt: number;
}

async function collectStamps(dir: string, suffix: string): Promise<FileStamp[]> {
  try {
    return await invoke<FileStamp[]>("fs_collect_files", { dir, suffix });
  } catch {
    return [];
  }
}

/** 水位过滤(可省):只留 spawn 之后有写的文件,防新会话屏初始命中上一会话。 */
function watermarked(stamps: FileStamp[], sinceMs?: number): FileStamp[] {
  return sinceMs === undefined ? stamps : stamps.filter((s) => s.modifiedAt >= sinceMs);
}

async function newestFile(dir: string, sinceMs?: number): Promise<string | null> {
  const pool = watermarked(await collectStamps(dir, ".jsonl"), sinceMs);
  if (!pool.length) return null;
  return pool.sort((a, b) => b.modifiedAt - a.modifiedAt)[0].path;
}

/** codex:~/.codex/sessions 全局树(不按 cwd 分目录),rollout 首行 session_meta
 *  自证归属 —— mtime 倒序逐个读头校验 cwd(extractMeta 纯函数,插件单一来源)。 */
async function resolveCodexPath(cwd: string, sinceMs?: number): Promise<string | null> {
  const home = await invoke<string>("config_home_dir").catch(() => "");
  if (!home) return null;
  const ci = getPlatformKind() !== "linux"; /* APFS/NTFS 大小写不敏感,同桌面判定 */
  const pool = watermarked(
    await collectStamps(`${home}/.codex/sessions`, ".jsonl"),
    sinceMs,
  ).slice(0, PROBE_LIMIT);
  for (const f of pool) {
    const head = await invoke<string>("fs_read_head", { path: f.path, maxBytes: HEAD_BYTES })
      .catch(() => "");
    const meta = head ? extractMeta(head) : null;
    if (meta && pathsEqual(meta.cwd, cwd, ci)) return f.path;
  }
  return null;
}

/** kimi wire.jsonl 路径(布局权威:cli-kimi/kimiSessions.ts;手机树单一来源)。 */
export function kimiWirePathOf(sessionDir: string): string {
  return `${sessionDir.replace(/[\\/]+$/, "")}/agents/main/wire.jsonl`;
}

/** kimi:~/.kimi-code/sessions/<桶>/<session_id>/agents/main/wire.jsonl,cwd 在
 *  同目录 state.json 里(纯函数 parseKimiState);老 home(~/.kimi ≤0.34 md5 桶)
 *  不在手机契约,回落实况。水位按 wire 自身 mtime(它就是被读的文件,权威)。 */
async function resolveKimiPath(cwd: string, sinceMs?: number): Promise<string | null> {
  const home = await invoke<string>("config_home_dir").catch(() => "");
  if (!home) return null;
  const wires = watermarked(
    (await collectStamps(`${home}/.kimi-code/sessions`, ".jsonl")).filter((f) =>
      /[\\/][^\\/]+[\\/]session_[^\\/]+[\\/]agents[\\/]main[\\/]wire\.jsonl$/.test(f.path),
    ),
    sinceMs,
  ).slice(0, PROBE_LIMIT);
  const sameDir = (a: string, b: string) =>
    a.replace(/[\\/]+$/, "") === b.replace(/[\\/]+$/, ""); /* kimiSessions sameDir 同律 */
  for (const w of wires) {
    const state = await invoke<string>("fs_read_file", {
      path: `${w.path.slice(0, -"agents/main/wire.jsonl".length)}state.json`,
    }).catch(() => "");
    const s = state ? parseKimiState(state) : null;
    if (s?.cwd && sameDir(s.cwd, cwd)) return w.path;
  }
  return null;
}

/** 定位会话 jsonl:插件适配器给出 cwd 对应目录(codex/kimi 全局树按内容归属)。
 *  sinceMs(spawn 水位,可省):只收该时刻之后有写的文件。 */
export async function resolveTranscriptPath(
  profileId: string,
  cwd: string,
  sinceMs?: number,
): Promise<string | null> {
  const p = profileId.toLowerCase();
  if (p === "codex") return resolveCodexPath(cwd, sinceMs);
  if (p === "kimi") return resolveKimiPath(cwd, sinceMs);
  const dir =
    p === "claude" || p === "cl"
      ? await claudeSessionsDir(cwd)
      : p === "pi"
        ? await piSessionsDir(cwd)
        : p === "omp"
          ? await ompSessionsDir(cwd)
          : null; /* qoder/grok/opencode:磁盘布局未进手机 transcript 契约,回落实况 */
  if (!dir) return null;
  return newestFile(dir, sinceMs);
}

/** 行型自证分发:文件头几行里第一个可识别的 type 字段决定解析器 ——
 *  codex(session_meta/response_item)/kimi(turn.prompt/append_loop_event/TurnBegin)
 *  走插件行解析器,其余(omp/pi/claude/qoder)回落内核通用解析。选型依据是
 *  格式自带的 type 标识,非内容猜测;两家解析器输入输出皆纯函数。 */
function detectLineParser(text: string): TranscriptLineParser | null {
  for (const line of text.split("\n").slice(0, 12)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) continue;
    let ev: Record<string, unknown>;
    try {
      ev = JSON.parse(trimmed) as Record<string, unknown>;
    } catch {
      continue; /* 写一半的活会话行 */
    }
    const msg = ev.message as Record<string, unknown> | undefined;
    const type =
      typeof ev.type === "string"
        ? ev.type
        : msg && typeof msg.type === "string"
          ? `msg:${msg.type as string}`
          : "";
    if (type === "session_meta" || type === "response_item") return codexTranscriptLine;
    if (
      type === "turn.prompt" ||
      type === "context.append_loop_event" ||
      type === "msg:TurnBegin"
    ) {
      return kimiTranscriptLine;
    }
  }
  return null;
}

function clipTool(s: string): string {
  const one = stripAnsi(s).replace(/\s+/g, " ").trim();
  return one.length > TURN_MAX ? `${one.slice(0, TURN_MAX)}…` : one;
}

function clipText(s: string): string {
  const one = stripAnsi(s).trim();
  return one.length > TURN_MAX ? `${one.slice(0, TURN_MAX)}…` : one;
}

/** 插件转录块 → 手机 turns:reasoning/system 丢弃(与内核 parser「thinking
 *  不上图」同口径);tool 块先配对(结果并调用),摘要取 shell 命令优先、
 *  无命令用结果文本(与内核 parser 参数摘要优先同律)。 */
function blocksToTurns(blocks: CliTranscriptBlock[]): TranscriptTurn[] {
  const out: TranscriptTurn[] = [];
  for (const b of pairToolResults(blocks)) {
    if (b.role === "user" || b.role === "assistant") {
      const text = clipText(b.text);
      if (text) out.push({ role: b.role, text });
    } else if (b.role === "tool") {
      const brief = clipTool(
        (b.tool?.preview?.kind === "shell" ? b.tool.preview?.output : undefined) ??
          b.tool?.detail ??
          "",
      );
      out.push({ role: "tool", tool: b.tool?.title ?? "tool", text: brief });
    }
  }
  return out;
}

function parseTurnsFromText(text: string): TranscriptTurn[] {
  const lineOf = detectLineParser(text);
  return lineOf ? blocksToTurns(parseTranscriptBlocks(text, lineOf)) : parseTranscript(text);
}

/** 按会话文件路径拉 transcript(home 历史行;路径来自磁盘扫描,免再定位)。
 *  null = 读取失败(错误态);[] = 可读但无可解析行(空态)—— 两态分离,
 *  由调用方分别渲染「读取失败可重试」与「没有可解析的对话记录」。 */
export async function loadTranscriptAt(path: string): Promise<TranscriptTurn[] | null> {
  try {
    const tail = await invoke<string>("fs_read_tail", { path, maxBytes: TAIL_BYTES });
    if (!tail) return [];
    const turns = parseTurnsFromText(tail);
    if (!turns.length) shellLog(`transcript: 解析 0 行(${path})`);
    return tailTurns(turns, MAX_TURNS);
  } catch (e) {
    shellLog(`transcript: 读取失败 ${String((e as Error)?.message ?? e).slice(0, 120)}`);
    return null;
  }
}

/** 增量拍(spec 2026-09-25-mobile-session-render):尺寸闸尾读 + 整窗重解析,
 *  语义与 loadTranscriptAt 一致。lastSize=null 强制读(首拍);unchanged → null
 *  (调用方免 setState);变化但解析 0 行(尾部半行/未识别行)→ null 保旧态,
 *  size 不同步,待半行写全后下一拍自然补上。 */
export async function pollTranscript(
  path: string,
  lastSize: number | null,
): Promise<{ turns: TranscriptTurn[]; size: number } | null> {
  try {
    const r = await invoke<{ changed: boolean; size: number; text: string }>(
      "fs_read_tail_changed",
      { path, maxBytes: TAIL_BYTES, lastSize },
    );
    if (!r.changed) return null;
    const all = parseTurnsFromText(r.text);
    return all.length ? { turns: tailTurns(all, MAX_TURNS), size: r.size } : null;
  } catch {
    return null;
  }
}
