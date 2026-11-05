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

/* dev StrictMode 收养保护(评审 P2 修复):cleanup 对收养流不立即 kill ——
 * 延迟一拍,双跑第二遍挂载经同一 adoptStreamId 接管时取消;真关 tab 无
 * 接管,定时器到点 kill 照常落(生产构建 StrictMode 不双跑,行为不变)。 */
const pendingAdoptKills = new Map<string, ReturnType<typeof setTimeout>>();

/** 收养启动时取消同流的待决 kill(第二遍挂载接管)。 */
export function cancelAdoptKill(streamId: string): void {
  const timer = pendingAdoptKills.get(streamId);
  if (timer != null) {
    clearTimeout(timer);
    pendingAdoptKills.delete(streamId);
  }
}

/** unmount 时调度收养流 kill(可被下一遍挂载取消)。 */
export function scheduleAdoptKill(streamId: string, kill: () => void): void {
  cancelAdoptKill(streamId);
  const timer = setTimeout(() => {
    pendingAdoptKills.delete(streamId);
    kill();
  }, 0);
  pendingAdoptKills.set(streamId, timer);
}

/** boot 收养入口:activate 期调用一次(幂等:tab 表空时才可能有活流)。
 *  label 尾部的 # 判别段(resume 会话,见 structuredSessionTabs)带回 tab id —
 *  每流各回各 tab,多 RPC 会话并行 reload 后不相吞。 */
export function adoptOrphanStreams(): void {
  void ipc
    .procStreamList()
    .then((streams) => {
      for (const s of streams) {
        const target = structuredSessionTarget(s.label ?? undefined);
        if (target) {
          const label = s.label ?? "";
          const hash = label.lastIndexOf("#");
          openStructuredSessionTab(target.profileId, target.cwd, {
            adoptStreamId: s.id,
            ...(hash > 0 ? { resumeSessionId: label.slice(hash + 1) } : {}),
          });
        } else {
          void ipc.procStreamKill(s.id).catch(() => undefined);
        }
      }
    })
    .catch(() => undefined); /* 枚举失败 = 无可收养,静默 */
}

/** adopt/resume 后置种子:磁盘转录补历史(引擎不重发历史帧)。候选 id 序即
 *  优先序:握手 sid 在前;引擎换壳 sid 变化时回落请求 resumeSessionId ——
 *  用户点的就是那盘历史,不因 sid 对不上而空幕布(读不到静默,续跑不受影响)。 */
export function adoptDiskSeed(
  session: PiRpcSession,
  payload: StructuredSessionPayload,
  ...ids: Array<string | undefined>
): void {
  const profile = host.getCliProfile(payload.profileId);
  const wanted = new Set(ids.filter((id): id is string => !!id));
  if (!profile?.listSessions || !profile.readSessionTranscript || wanted.size === 0) return;
  void profile
    .listSessions(payload.cwd)
    .then((sessions) => sessions.find((s) => wanted.has(s.id)))
    .then((hit) => (hit ? profile.readSessionTranscript?.(hit) : null))
    .then((transcript) => {
      if (transcript?.blocks.length) {
        /* 剪尾语义见 reducer.seed:resume 已结算历史全量;活流收养与
         * resumeUnsettled(busy 中关闭,引擎将重放在途轮)剪尾防重复。 */
        session.adoptSeed(transcript.blocks, !payload.adoptStreamId && !payload.resumeUnsettled);
      }
    })
    .catch(() => undefined);
}
