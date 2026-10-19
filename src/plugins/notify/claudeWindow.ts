/**
 * claude 窗口重置腿(薄 IO 编排)—— claude 官方 OAuth 无 HTTP 额度面,唯一
 * 推算通道是本地会话 JSONL 尾读(welcome/tokens.ts 同款实证配方:usage 行在
 * 文件尾,必须尾读)。纯判定在 quotaWatch.pickResetWarning,窗口推算在
 * cli-shared/quota/quotaWindow(联合消费,见该文件头注);任何失败静默跳过。
 */

import { ipc } from "@kernel/ipc";
import { t } from "@kernel/i18n";
import type { CliProfile } from "@kernel/cliProfile";
import type { SessionMeta } from "@kernel/ipc";
import { extractUsageFromHead } from "@plugins/cli-shared/sessionUsage";
import { windowResetFor } from "@plugins/cli-shared/quota/quotaWindow";
import { pickResetWarning } from "./quotaWatch";

/** 尾读字节预算(welcome/tokens.ts TAIL_BYTES 同款口径)。 */
const TAIL_BYTES = 128 * 1024;

/** 命中返回告警文案与去重键;未命中/无法推算/失败一律 null。 */
export async function claudeResetWarning(
  session: SessionMeta,
  profile: CliProfile | undefined,
  cliSessionId: string | undefined,
  minutesBefore: number,
  now: number,
  seen: Set<string>,
): Promise<{ key: string; title: string; body: string } | null> {
  try {
    if (!profile?.listSessions || !cliSessionId) return null;
    const disks = await profile.listSessions(session.cwd);
    const disk = disks.find((d) => d.id === cliSessionId);
    if (!disk) return null;
    const tail = await ipc.fsReadTail(disk.path, TAIL_BYTES);
    if (!tail) return null;
    /* 不做时间预过滤(传 0):窗口判活是 windowResetFor 的职责,这里按 5h
       截会丢真锚(闲置会话最新用量 >5h 旧时),推出更晚 resetAt 假阳性 ——
       welcome 侧同函数喂 7 天窗,口径必须一致。尾读 128KB 已限界。 */
    const lines = extractUsageFromHead(tail, 0);
    const w = windowResetFor("claude", lines, now);
    if (!w) return null;
    const key = `${profile.id}:reset:${w.resetAtMs}`;
    if (!pickResetWarning(w.resetAtMs, now, minutesBefore, key, seen)) return null;
    const mins = Math.max(1, Math.round((w.resetAtMs - now) / 60_000));
    const name = profile.name ?? profile.id;
    return {
      key,
      title: t("额度预警 · {provider}", { provider: name }),
      body: t("「{name}」额度窗口约 {mins} 分钟后重置", { name, mins }),
    };
  } catch {
    return null; /* 尾读/解析失败静默:与 welcome 聚合同口径,不阻塞主流程。 */
  }
}
