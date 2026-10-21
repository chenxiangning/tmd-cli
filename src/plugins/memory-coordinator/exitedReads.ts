/**
 * 退出沉淀共享读(memory-coordinator 内部,0.4.2 批三收敛):
 * wikiHook 与 phase2/autoDistill 同在 kernel.sessions.exited 上各读一次
 * readSessionUserMessages(full)—— 同会话同刻双读同一 jsonl。此处按
 * (profileId|cwd|cliSessionId) 做在飞/短 TTL 记忆,两边同吃一次磁盘读。
 * 只去重读,不碰两侧各自的幂等集/门控/写路径(语义零变化)。
 */
import type { CliUserMessage } from "@kernel/cli";

/** 短 TTL:两个钩子由同一事件 emit 同步触发,毫秒级相邻;30s 窗口纯兜底。 */
const TTL_MS = 30_000;
const CACHE_CAP = 16;

const inflight = new Map<string, Promise<CliUserMessage[] | null>>();

/** 同会话退出尾段共享读;read 供方由调用方闭包(判定门控后传入)。 */
export function readUserMessagesOnce(
  key: string,
  read: () => Promise<CliUserMessage[] | null>,
): Promise<CliUserMessage[] | null> {
  const hit = inflight.get(key);
  if (hit) return hit;
  const p = read()
    .catch(() => null)
    .finally(() => {
      setTimeout(() => inflight.delete(key), TTL_MS);
    });
  inflight.set(key, p);
  if (inflight.size > CACHE_CAP) {
    for (const k of inflight.keys()) {
      inflight.delete(k);
      if (inflight.size <= CACHE_CAP) break;
    }
  }
  return p;
}

/** 共享读键(两钩子同构图键)。 */
export function exitedReadKey(profileId: string, cwd: string, cliSessionId: string): string {
  return `${profileId}|${cwd}|${cliSessionId}`;
}

/** 仅供测试:清空在飞表。 */
export function resetExitedReads(): void {
  inflight.clear();
}
