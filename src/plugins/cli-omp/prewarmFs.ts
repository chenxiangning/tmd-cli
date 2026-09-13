/**
 * omp 预热接管的磁盘辅助(自 prewarm.ts 拆出,文件规模铁则):
 * 预热目标 cwd 发现 + 出生空会话文件清理。纯 ipc.fs 原语编排,不含状态机。
 */

import { ipc } from "@kernel/ipc";
import { ompSessionsDir } from "./edits";

/** 预热目标活动窗:最近 7 天无 omp 会话活动则不预热(不用不占内存)。 */
export const RECENT_ACTIVITY_MS = 7 * 24 * 3_600_000;

/**
 * 预热目标 cwd:全局最近一次 omp 会话活动所在目录(桶内最新 jsonl 头部自证
 * cwd,不依赖桶名编码规则)。无近期活动返回 null(不预热)。
 */
export async function pickPrewarmCwd(): Promise<string | null> {
  try {
    const home = await ipc.configHomeDir();
    if (!home) return null;
    const files = await ipc.fsCollectFiles(`${home}/.omp/agent/sessions`, ".jsonl");
    const latest = files[0];
    if (!latest || latest.modifiedAt < Date.now() - RECENT_ACTIVITY_MS) return null;
    const head = await ipc.fsReadHead(latest.path, 8192);
    for (const line of head.split("\n")) {
      if (!line.includes('"cwd"')) continue;
      try {
        const entry = JSON.parse(line) as { cwd?: unknown };
        if (typeof entry.cwd === "string" && entry.cwd.length > 0) return entry.cwd;
      } catch {
        /* 非完整行继续找 */
      }
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * 出生空会话文件锁定清理(spawn 后短窗调用):桶 diff 出新增 jsonl,
 * 仅当「恰好一个新增且头部无用户消息」才删 —— 锁定为我们自己的出生文件,
 * 消灭按时间窗宽删的误删面(用户在预热期间手动新开 omp 的真实空会话
 * 落在同一桶时,新增数 > 1 → 全部不碰)。多个/零个新增 → 放弃(残留一个
 * 空会话文件仅列表噪音,identityWatch 误绑窗口由 10 分钟缩到秒级)。
 */
export async function lockAndRemoveBirthFile(
  cwd: string,
  bornFiles: Set<string>,
): Promise<void> {
  try {
    const bucket = await ompSessionsDir(cwd);
    if (!bucket) return;
    const now = await ipc.fsCollectFiles(bucket, ".jsonl");
    const fresh = now.filter((f) => !bornFiles.has(f.name));
    if (fresh.length !== 1) return;
    const head = await ipc.fsReadHead(fresh[0].path, 4096);
    if (!head.includes('"role":"user"')) {
      void ipc.fsRemovePath(fresh[0].path).catch(() => undefined);
    }
  } catch {
    /* 尽力而为:残留一个空会话文件仅列表噪音 */
  }
}
