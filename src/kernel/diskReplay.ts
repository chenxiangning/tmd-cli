/**
 * 单槽磁盘尾预取 —— 磁盘会话先行回放的取数件(spec 2026-09-09-disk-first-session-open)。
 *
 * 点击磁盘行时发起预取(不 await,IPC 失败静默回落 null),openDiskSession 的
 * spawn 与之并发;挂载后按 cliSessionId 标签消费,解指针读「上一代」日志尾。
 * happens-before:预取先于 spawn 派发,此刻指针仍指上一代;绑定时刻的
 * link_log 覆写(指向新代)发生在 spawn 完成之后,永不见到本次预取。
 *
 * 单槽语义(评审 F2/F3):槽只被下一次预取覆盖,消费不删 —— StrictMode 双挂载
 * 二次消费仍命中;去重聚焦路径(无挂载)残留的槽随下次预取自然淘汰。标签不匹配
 * (含重载后身份表为空)= 不消费,优雅回落现状路径。
 *
 * 红线:磁盘尾巴只准进 xterm 回放与 restoreTail,严禁进 appendOutput ——
 * 历史字节会误开轮次、误置未读、误升级 Ask 等待、误触 EditWatch。
 */

import { ipc, type HistoryPage } from "./ipc";

/** 回放尾窗口:覆盖「最终帧 + 一屏滚回」;更早历史走既有磁盘翻页管线。 */
export const REPLAY_TAIL_BYTES = 512 * 1024;

let slot: { cliSessionId: string; promise: Promise<HistoryPage | null> } | null = null;

/** 点击路径调用:发起预取,不 await;失败静默(消费时按无尾巴回落)。 */
export function prefetchDiskTail(profileId: string, cwd: string, cliSessionId: string): void {
  try {
    slot = {
      cliSessionId,
      promise: ipc
        .sessionDiskTail(profileId, cwd, cliSessionId, REPLAY_TAIL_BYTES)
        .catch(() => null),
    };
  } catch {
    slot = null; /* ipc 替身缺命令等同步异常:按未预取处理,挂载侧优雅回落 */
  }
}

/** 身份绑定时刻回写「CLI 会话 → 当前代日志」指针。尽力而为:任何异常
 *  (含 ipc 替身缺命令)静默吞掉,只影响下一代冷开回放的寻址,不影响绑定本身。 */
export function noteLogBinding(
  profileId: string,
  cwd: string,
  cliSessionId: string,
  logId: string,
): void {
  try {
    void ipc.sessionLinkLog(profileId, cwd, cliSessionId, logId).catch(() => undefined);
  } catch {
    /* 尽力而为 */
  }
}

/** 挂载路径调用:按 cliSessionId(host.getCliSessionId 解析)取预取尾巴;未预取/错配 → null。 */
export function consumeDiskTail(
  cliSessionId: string | undefined,
): Promise<HistoryPage | null> | null {
  if (!slot || !cliSessionId || slot.cliSessionId !== cliSessionId) return null;
  return slot.promise;
}

/** 测试专用:清槽。 */
export function resetDiskReplayForTest(): void {
  slot = null;
}
