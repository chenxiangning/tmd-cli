/**
 * 时间线数据层(spec 2026-10-05-mobile-session-timeline)—— 组件文件只出组件
 * (react-doctor only-export-components,先例 shared.ts):
 * 定位 jsonl(resolveTranscriptPath 按会话身份精确绑定)→ fsReadTailChanged
 * 2MB 尾窗 → parseUserMessages(parser 按 profileId 分发,全部 cli-shared/cli-kimi
 * 已导出件,行型知识零复制;IO 经 ipc→桥→Rust FS_READ 白名单,零新命令面)。
 */
import type { CliUserMessage } from "@kernel/cli";
import type { TranscriptTurn } from "@kernel/transcript";
import { ipc } from "@kernel/ipc";
import {
  claudeUserMessageLine,
  codexUserMessageLine,
  ompPiUserMessageLine,
  parseUserMessages,
  type UserMessageLineParser,
} from "@plugins/cli-shared/userMessages";
import { kimiUserMessageLine } from "@plugins/cli-kimi/kimiSessions";
import { resolveTranscriptPath } from "./sessionFile";

/** 时间线读窗(真机实测定 512KB,2026-10-05):外网中继单 invoke 15s 强断,且响应帧
 * 走 JSON 封包转义 + 中继 b64(×1.33)膨胀,2MB 原文 ≈ 4MB+ 撞手机壳 4MiB 收帧上限
 * → invoke 超时「读取失败」;512KB 封包后 ~1MB,4G 稳过。用户消息密度低,512KB
 * 容数千条 ≈ 全程覆盖;超窗截断注记(桌面 messageAnchors 32MB 全量口径不进手机契约)。 */
const TIMELINE_BYTES = 512 * 1024;

/** 行型 parser 分发(支持面与 resolveTranscriptPath 同构;qoder/grok 未进手机
 * transcript 契约 → 不在表 = 不支持,诚实降级不猜测)。 */
const PARSERS: Record<string, UserMessageLineParser> = {
  omp: ompPiUserMessageLine,
  pi: ompPiUserMessageLine,
  claude: claudeUserMessageLine,
  cl: claudeUserMessageLine,
  codex: codexUserMessageLine,
  kimi: kimiUserMessageLine,
};

/** 引擎是否支持时间线(PlusPanel 第五格置灰判据)。 */
export function timelineSupported(profileId: string | undefined): boolean {
  return !!profileId && profileId.toLowerCase() in PARSERS;
}

/** 拉时间线:null = 尚未找到会话文件(jsonl 懒落盘,可重试);reject = 读取失败。 */
export async function loadTimeline(
  profileId: string,
  cwd: string,
  cliSessionId: string,
): Promise<{ messages: CliUserMessage[]; truncated: boolean } | null> {
  const parser = PARSERS[profileId.toLowerCase()];
  /* 入口已置灰,理论不可达;防御性返回 null(不猜文件)。 */
  if (!parser) return null;
  const path = await resolveTranscriptPath(profileId, cwd, undefined, cliSessionId);
  if (!path) return null;
  const tail = await ipc.fsReadTailChanged(path, TIMELINE_BYTES, null);
  return { messages: parseUserMessages(tail.text, parser), truncated: tail.size > TIMELINE_BYTES };
}

/** 尾窗可达判定:条目文本与当前 turns 内某 user turn 全等才可点跳转。
 * (kernel parser 与锚点 parser 的文本口径偶有差 = 置灰降级,不错跳。) */
export function reachableTexts(turns: TranscriptTurn[] | null): Set<string> {
  const set = new Set<string>();
  if (!turns) return set;
  for (const turn of turns) if (turn.role === "user") set.add(turn.text);
  return set;
}
