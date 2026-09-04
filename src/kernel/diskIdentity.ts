/**
 * 磁盘身份挑选(纯函数,契约由 host.test.ts 守护)。
 * 主路径 = 内容证据(pickContentIdentity):读候选文件自证 id/cwd/createdAt,
 * cwd 不符剔除、创建时刻离 spawn 最近者胜 —— 零猜测,懒落盘 + 并行 spawn 不串线。
 * 兜底 = mtime 水位(pickFreshIdentity,插件未声明 readSessionFileIdentity 时):
 * fresh 判定(均取最旧的未认领项 —— listSessions mtime 倒序,findLast = 最旧,先 spawn 先认领):
 * 1. 有基线:新文件(基线外 id)优先;其次复活文件(mtime 较快照增长 = CLI 内 /resume 追加写旧文件);
 * 2. 无基线(快照失败):只认 spawn 水位线之后的落盘/增长,pre-spawn 旧文件不得抢绑。
 *
 * 从 host.ts 拆出(文件规模铁则 ≤500 行)。
 */

import type { CliDiskSession, SessionFileIdentity } from "./cli";

export function pickFreshIdentity(
  list: CliDiskSession[],
  before: ReadonlyMap<string, number> | null,
  spawnedAt: number,
  claimed: ReadonlySet<string>,
): string | null {
  if (before) {
    const fresh = list.findLast((s) => !before.has(s.id) && !claimed.has(s.id));
    if (fresh) return fresh.id;
    return (
      list.findLast(
        (s) =>
          !claimed.has(s.id) &&
          s.modifiedAt > (before.get(s.id) ?? Number.POSITIVE_INFINITY),
      )?.id ?? null
    );
  }
  return (
    list.findLast((s) => !claimed.has(s.id) && s.modifiedAt >= spawnedAt)?.id ?? null
  );
}

/** 水位线内的全部未认领候选(内容匹配的输入;新文件与复活文件同级参与)。 */
export function listFreshCandidates(
  list: CliDiskSession[],
  before: ReadonlyMap<string, number> | null,
  spawnedAt: number,
  claimed: ReadonlySet<string>,
): CliDiskSession[] {
  if (before) {
    return list.filter(
      (s) =>
        !claimed.has(s.id) &&
        (!before.has(s.id) ||
          s.modifiedAt > (before.get(s.id) ?? Number.POSITIVE_INFINITY)),
    );
  }
  return list.filter((s) => !claimed.has(s.id) && s.modifiedAt >= spawnedAt);
}

/** cwd 等值:分隔符/尾斜杠归一(插件自证格式各异,内核不做 realpath)。 */
function sameCwd(a: string, b: string): boolean {
  const norm = (p: string) => p.replace(/\\/g, "/").replace(/[\\/]+$/, "");
  return norm(a) === norm(b);
}

/**
 * 内容证据匹配结果:
 * - matched:有候选自证成功且归属明确,绑定 id;
 * - unmatched:有候选读出了身份但无一归属本会话(cwd 不符/归属兄弟会话)—— 强拒绝,
 *   调用方必须等待下一个文件,不得退回水位线猜法(否则张冠李戴防线失效);
 * - unreadable:候选为空、全部读不出身份,或证据不足以唯一仲裁(多候选均无
 *   createdAt)—— 弱缺席,调用方可退回水位线仲裁(该场景 = 文件 mtime ≈ spawn
 *   的即时落盘 CLI,水位线的 spawn 窗口配对本就准确)。
 */
type ContentIdentityResult =
  | { kind: "matched"; id: string }
  | { kind: "unmatched" }
  | { kind: "unreadable" };

/**
 * 内容证据匹配。逐候选读文件自证身份,三道守卫后按
 * |自证创建时刻 − spawn 时刻| 最近者胜:
 * 1. cwd 不符 → 剔除;
 * 2. 自证 id ≠ 候选列表 id(文件名)→ 剔除 —— 下游 readSessionStatus 按列表 id
 *    寻址、openDiskSession 按列表 id 去重,分叉即断链,宁退回水位线;
 * 3. 兄弟仲裁:同 profile+cwd 的其他 pending 会话中存在比本会话更接近该
 *    createdAt 的 spawn(平局让老会话)→ 该候选属于兄弟,本轮让位。
 *    防偷文件回归:本会话在 CLI 内 /resume 老会话时,自证 createdAt 远古,
 *    兄弟的新文件(createdAt ≈ 兄弟 spawn)按纯距离会被误判给本会话。
 * 无 createdAt 的候选仅在"唯一合格候选"时直接采信(id 级自证 ≥ 水位线精度);
 * 多候选并列且全无 createdAt → unreadable 退回水位线仲裁。
 */
export async function pickContentIdentity(
  candidates: CliDiskSession[],
  cwd: string,
  spawnedAt: number,
  read: (path: string) => Promise<SessionFileIdentity | null>,
  siblingSpawns: readonly number[] = [],
): Promise<ContentIdentityResult> {
  let anyReadable = false;
  let soleEligibleNoTs: CliDiskSession | null = null;
  let eligibleNoTsCount = 0;
  let best: { id: string; score: number } | null = null;
  for (const candidate of candidates) {
    const identity = await read(candidate.path).catch(() => null);
    if (!identity?.id) continue;
    if (identity.id !== candidate.id) continue;
    anyReadable = true;
    if (identity.cwd && !sameCwd(identity.cwd, cwd)) continue;
    if (
      identity.createdAt !== undefined &&
      !ownsByNearestSpawn(identity.createdAt, spawnedAt, siblingSpawns)
    ) {
      continue;
    }
    if (identity.createdAt === undefined) {
      eligibleNoTsCount += 1;
      soleEligibleNoTs = candidate;
      continue;
    }
    const score = Math.abs(identity.createdAt - spawnedAt);
    /* list 为 mtime 倒序,后迭代 = 更旧;平局让更旧者胜,对齐水位线"先 spawn 先认领" */
    if (!best || score <= best.score) best = { id: candidate.id, score };
  }
  if (best) return { kind: "matched", id: best.id };
  if (eligibleNoTsCount === 1 && soleEligibleNoTs) {
    return { kind: "matched", id: soleEligibleNoTs.id };
  }
  if (eligibleNoTsCount > 1) return { kind: "unreadable" };
  return anyReadable ? { kind: "unmatched" } : { kind: "unreadable" };
}

/** createdAt 归属判定:无兄弟比本会话更近(平局让老会话)即为本会话的候选。 */
function ownsByNearestSpawn(
  createdAt: number,
  spawnedAt: number,
  siblingSpawns: readonly number[],
): boolean {
  for (const sibling of siblingSpawns) {
    const mine = Math.abs(spawnedAt - createdAt);
    const theirs = Math.abs(sibling - createdAt);
    if (theirs < mine || (theirs === mine && sibling < spawnedAt)) return false;
  }
  return true;
}
