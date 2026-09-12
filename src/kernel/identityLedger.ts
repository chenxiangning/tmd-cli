/**
 * CLI 磁盘身份账本 —— 自 hostWatches 拆出(文件规模铁则)。
 * 活会话 → CLI 磁盘身份绑定(omp/pi 的 jsonl uuid、codex 的 rollout id)。
 * 纯前端内存,随 PTY 消亡 —— 这是活会话的身份属性,不是持久化映射。
 * 用途:UI 按身份去重(同一会话在活区/磁盘区只出现一次)。
 */

import { noteLogBinding } from "./diskReplay";
import type { SessionMeta } from "./ipc";

export class IdentityLedger {
  private readonly map = new Map<string, string>();

  constructor(
    private readonly findSession: (sessionId: string) => SessionMeta | undefined,
  ) {}

  /** 活会话绑定的 CLI 磁盘身份;未绑定(探测前)为 undefined。 */
  get(sessionId: string): string | undefined {
    return this.map.get(sessionId);
  }

  has(sessionId: string): boolean {
    return this.map.has(sessionId);
  }

  /** 已被持有的全部磁盘身份(身份守望 claimed 过滤用快照)。 */
  claimedIds(): Set<string> {
    return new Set(this.map.values());
  }

  remove(sessionId: string): void {
    this.map.delete(sessionId);
  }

  /**
   * 绑定表唯一写入口:一个 CLI 磁盘身份只准一个活会话持有。身份守望的
   * claimed 过滤是快照式(await 期间会过期),此处是绑定落表的同步终审
   * (实证:四会话共绑一老会话,ptys 各自 resume 了同一磁盘会话)。抢绑失败
   * = 新会话保持未绑定(fail-closed):账本按 tmd id 隔离,UI 不去重不并账。
   */
  bind(sessionId: string, cliSessionId: string): boolean {
    const rival = [...this.map.entries()].some(
      ([id, cid]) => id !== sessionId && cid === cliSessionId,
    );
    if (rival) return false;
    this.map.set(sessionId, cliSessionId);
    /* 磁盘先行回放:绑定成功即覆写「CLI 会话 → 当前代日志」指针(冷开寻址上一代)。
       收口在唯一写入口,显式恢复(openDiskSession)与探测绑定(identityWatch)两路共用 */
    const meta = this.findSession(sessionId);
    if (meta) noteLogBinding(meta.profileId, meta.cwd, cliSessionId, sessionId);
    return true;
  }
}
