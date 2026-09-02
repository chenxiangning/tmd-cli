/**
 * 磁盘身份挑选(纯函数,契约由 host.test.ts 守护)。
 * fresh 判定(均取最旧的未认领项 —— listSessions mtime 倒序,findLast = 最旧,先 spawn 先认领):
 * 1. 有基线:新文件(基线外 id)优先;其次复活文件(mtime 较快照增长 = CLI 内 /resume 追加写旧文件);
 * 2. 无基线(快照失败):只认 spawn 水位线之后的落盘/增长,pre-spawn 旧文件不得抢绑。
 *
 * 从 host.ts 拆出(文件规模铁则 ≤500 行)。
 */

import type { CliDiskSession } from "./cli";

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
