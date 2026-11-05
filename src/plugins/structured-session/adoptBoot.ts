/**
 * boot 收养(RPC 会话体系对齐批次 3)—— webview reload 后前端失忆,但
 * proc_stream 子进程经 detach 泵改造(proc_stream.rs:emit 失联不再杀树)
 * 存活于 Rust registry。本模块在插件 activate 期:
 *   1. 枚举活流(ipc.procStreamList);label 反解 structured:{profile}:{cwd}
 *      → openStructuredSessionTab(adoptStreamId) 重建 tab/行,内容挂载时
 *      订阅既有流 + get_state 握手(不新 spawn)。
 *   2. 无 structured label 的流 = 无人认领 → kill(等价旧 boot kill_all 语义,
 *      只清孤儿不清会话)。
 * 磁盘种子(adoptDiskSeed):引擎不重发历史帧,adopt 后幕布历史经
 * readSessionTranscript(cwd 定位磁盘会话)补齐;读不到静默空幕布。
 */

import { host } from "@kernel/host";
import { ipc } from "@kernel/ipc";
import { openStructuredSessionTab, structuredSessionTarget, type StructuredSessionPayload } from "@kernel/structuredSessionTabs";
import type { PiRpcSession } from "../cli-shared/piRpc";

/** boot 收养入口:activate 期调用一次(幂等:tab 表空时才可能有活流)。 */
export function adoptOrphanStreams(): void {
  void ipc
    .procStreamList()
    .then((streams) => {
      for (const s of streams) {
        const target = structuredSessionTarget(s.label ?? undefined);
        if (target) {
          openStructuredSessionTab(target.profileId, target.cwd, { adoptStreamId: s.id });
        } else {
          void ipc.procStreamKill(s.id).catch(() => undefined);
        }
      }
    })
    .catch(() => undefined); /* 枚举失败 = 无可收养,静默 */
}

/** adopt 后置种子:cwd 所在工作区磁盘会话里按 sessionId 定位,读转录喂 reducer。 */
export function adoptDiskSeed(
  session: PiRpcSession,
  payload: StructuredSessionPayload,
  sessionId: string,
): void {
  const profile = host.getCliProfile(payload.profileId);
  if (!profile?.listSessions || !profile.readSessionTranscript) return;
  void profile
    .listSessions(payload.cwd)
    .then((sessions) => sessions.find((s) => s.id === sessionId))
    .then((hit) => (hit ? profile.readSessionTranscript?.(hit) : null))
    .then((transcript) => {
      if (transcript?.blocks.length) session.adoptSeed(transcript.blocks);
    })
    .catch(() => undefined);
}
