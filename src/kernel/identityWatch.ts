/**
 * DiskIdentityWatch —— 活会话 → CLI 磁盘身份绑定的探测循环(host 拆分件)。
 *
 * 职责:spawn 后持续扫盘,把 CLI 自己落盘的会话文件(omp/pi 的 jsonl uuid、
 * codex 的 rollout id)绑到活会话。绑定语义在 host(纯前端内存,随 PTY 消亡);
 * 本模块只管「怎么找、何时停」。
 *
 * 探测相位:快相位(spawn 后 15s,500ms 一格)→ 巡航相位(5s 一格,预算 10min)。
 * omp 实证懒落盘:jsonl 出生晚于 spawn 35-44s(首条消息后才冲刷),快相位必然
 * 扑空;巡航不依赖激活态,后台会话文件出生即绑。绑定成功或会话移除
 * (pending 清账)即自然终止。
 *
 * 主路径内容证据(pickContentIdentity):文件自证 id/cwd/createdAt + 兄弟仲裁,
 * 懒落盘 + 并行 spawn 不串线(实证:mtime 仲裁曾把同 cwd 两会话绑定互换)。
 * 兜底并行 spawn 仲裁(插件未声明自证时;claimed 只在绑定成功时记账):
 * - 新文件(基线外):spawn 窗口配对 —— 文件属于其落盘 mtime 之前最近 spawn 的
 *   未绑定会话。归属是我 → 立即绑;归属别人 → 本轮让位。
 * - 复活/无基线(归属不可判):BIND_DEFER_MS 窗口内老会话优先,窗口外放行。
 */

import {
  pickContentIdentity,
  pickFreshIdentity,
  listFreshCandidates,
} from "./diskIdentity";
import type { CliProfile } from "./cli";

/** 巡航节奏与预算:限时防「复活文件仲裁不可判」路径在长巡航窗口里被后台
 * 会话抢绑 —— 该兜底无内容自证(omp 懒落盘晚 spawn 35-44s,余量百倍)。 */
const CRUISE_MS = 5_000;
const CRUISE_BUDGET_MS = 10 * 60_000;

/** 并行 spawn 仲裁窗口:年轻会话等待更老未绑定会话先认领的最长时长。 */
const BIND_DEFER_MS = 10_000;

interface PendingIdentity {
  profileId: string;
  cwd: string;
  before: ReadonlyMap<string, number> | null;
  spawnedAt: number;
}

/** host 注入的会话表/绑定表访问与绑定回调(闭包随用随取,免循环持锁)。 */
interface DiskIdentityContext {
  getCliProfile: (profileId: string) => CliProfile | undefined;
  /** 会话仍存活(removeSession 已清则探测自然终止)。 */
  sessionAlive: (sessionId: string) => boolean;
  /** 已绑定(CLI 磁盘身份)→ 无需再探。 */
  isBound: (sessionId: string) => boolean;
  /** 已被其他会话绑走的磁盘身份集(mtime 兜底仲裁的排他集)。 */
  claimedIds: () => Set<string>;
  /** 绑定成功:host 写绑定表 + 刷状态 + 通知。 */
  onBound: (sessionId: string, cliSessionId: string) => void;
}

export class DiskIdentityWatch {
  private readonly pending = new Map<string, PendingIdentity>();

  constructor(private readonly ctx: DiskIdentityContext) {}

  /** spawn 时登记待绑定会话并启动探测循环。 */
  track(sessionId: string, profileId: string, cwd: string, before: ReadonlyMap<string, number> | null, spawnedAt: number): void {
    this.pending.set(sessionId, { profileId, cwd, before, spawnedAt });
    void this.detect(sessionId);
  }

  /** 会话移除:清账(探测循环见 pending 清空自然终止)。 */
  remove(sessionId: string): void {
    this.pending.delete(sessionId);
  }

  /** 仍在待绑定(状态巡航的慢相位共用一次扫描)。 */
  has(sessionId: string): boolean {
    return this.pending.has(sessionId);
  }

  /** 单次身份扫描:快相位与巡航相位共用。绑定成功即终 —— pending 删除,
   *  两个相位自然停止。 */
  async tryBind(sessionId: string): Promise<void> {
    const pending = this.pending.get(sessionId);
    if (!pending || this.ctx.isBound(sessionId)) return;
    const profile = this.ctx.getCliProfile(pending.profileId);
    if (!profile?.listSessions) return;
    const list = await profile.listSessions(pending.cwd).catch(() => []);
    /* await 期间会话可能已被移除:死会话绑上 CLI 身份会永久占位,
       令同 cwd 后续新会话再也绑不上该磁盘身份 */
    if (!this.ctx.sessionAlive(sessionId)) return;
    const claimed = this.ctx.claimedIds();
    /* unmatched = 文件读出了身份但不属于我(cwd 不符/归属兄弟)→ 强拒绝,等下一个文件;
       unreadable = 读不出身份或证据不足以唯一仲裁 → 才允许退回水位线仲裁。 */
    if (profile.readSessionFileIdentity) {
      const siblingSpawns = [...this.pending]
        .filter(([id, p]) => id !== sessionId && p.profileId === pending.profileId && p.cwd === pending.cwd)
        .map(([, p]) => p.spawnedAt);
      const matched = await pickContentIdentity(
        listFreshCandidates(list, pending.before, pending.spawnedAt, claimed),
        pending.cwd,
        pending.spawnedAt,
        (path) => profile.readSessionFileIdentity!(path),
        siblingSpawns,
      );
      if (matched.kind === "matched") {
        this.bind(sessionId, matched.id);
        return;
      }
      if (matched.kind === "unmatched") return;
    }
    const fresh = pickFreshIdentity(list, pending.before, pending.spawnedAt, claimed);
    if (!fresh) return;

    const entry = list.find((s) => s.id === fresh);
    let ownerIsMe = false;
    if (entry && pending.before && !pending.before.has(fresh)) {
      let ownerId: string | null = null;
      let ownerSpawn = Number.NEGATIVE_INFINITY;
      for (const [id, p] of this.pending) {
        if (p.profileId !== pending.profileId || p.cwd !== pending.cwd) continue;
        if (p.spawnedAt <= entry.modifiedAt && p.spawnedAt >= ownerSpawn) {
          ownerSpawn = p.spawnedAt;
          ownerId = id;
        }
      }
      if (ownerId !== null && ownerId !== sessionId) return; // 属于别的 spawn,让位
      ownerIsMe = ownerId === sessionId;
    }
    if (!ownerIsMe) {
      /* 归属不可判:老会话优先(窗口内) */
      for (const [id, p] of this.pending) {
        if (id === sessionId || p.profileId !== pending.profileId || p.cwd !== pending.cwd) {
          continue;
        }
        if (p.spawnedAt < pending.spawnedAt && Date.now() - p.spawnedAt < BIND_DEFER_MS) {
          return;
        }
      }
    }

    this.bind(sessionId, fresh);
  }

  private bind(sessionId: string, cliSessionId: string): void {
    /* 绑定瞬间的同步再校验:claimed 快照在 listSessions/pickContentIdentity
     * 的 await 期间会过期 —— 并行 spawn 的兄弟会话可能已把同一磁盘身份绑走
     * (实证:四会话共绑一老会话)。探测循环是单线程事件循环,此检查与
     * onBound 写入之间无交错,排他性由此闭环;败者留在 pending 继续巡航,
     * 自己的会话文件晚出生时仍可绑定(fail-closed,不猜)。 */
    if (this.ctx.claimedIds().has(cliSessionId)) return;
    this.pending.delete(sessionId);
    this.ctx.onBound(sessionId, cliSessionId);
  }

  private async detect(sessionId: string): Promise<void> {
    for (let i = 0; i < 30; i++) {
      const { promise, resolve } = Promise.withResolvers<void>();
      setTimeout(resolve, 500);
      await promise;
      if (!this.pending.has(sessionId)) return; // 已绑定或会话已死
      await this.tryBind(sessionId);
    }
    while (
      this.pending.has(sessionId) &&
      Date.now() - this.pending.get(sessionId)!.spawnedAt < CRUISE_BUDGET_MS
    ) {
      const { promise, resolve } = Promise.withResolvers<void>();
      setTimeout(resolve, CRUISE_MS);
      await promise;
      if (!this.pending.has(sessionId)) return; // 已绑定或会话已死
      await this.tryBind(sessionId);
    }
  }
}
