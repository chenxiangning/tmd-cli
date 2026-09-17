/**
 * 会话看板 —— 退出即归档(生命周期收口)。
 *
 * 生命周期定义(2026-09-17 用户定稿):
 * - 新建 → 待运行;轮次起止 ⇄ 运行中/待运行;
 * - 待运行会话关闭(进程退出)→ 再入已归档;
 * - 尾巴未读的退出 → 结束-未查看(注意力信号保留,点开查看后归档);
 * - 查看 → 结束-已查看(瞬态)→ 已归档;
 * - 已归档打开 → 待运行(归档标记跨打开/关闭持久, ↩ 恢复才显式解除)。
 *
 * 订阅 kernel.sessions.exited:emit 早于 removeRoom 完成(checkpoints 同依
 * 此序),此刻活表与身份账本仍可查。
 */
import { host } from "@kernel/host";
import { archiveSession, sessionArchiveKey } from "@kernel/sessionArchive";

/** 依赖面(结构化注入,测试可替换)。 */
interface ExitArchiverIo {
  getSessions(): { id: string; profileId: string; workspaceId?: string; engine?: string }[];
  getCliSessionId(sessionId: string): string | undefined;
  isUnread(sessionId: string): boolean;
}

/** 干净退出的会话写归档标记(幂等,重复归档仅刷新时间戳)。跳过:
 *  无归属工作区(裸 spawn 不猜归属)、无稳定磁盘身份(sessionArchive 契约)、
 *  尾巴未读(结束-未查看道保留注意力)。 */
export function archiveExitedSession(sessionId: string, io: ExitArchiverIo = host): void {
  const meta = io.getSessions().find((m) => m.id === sessionId);
  if (!meta?.workspaceId) return;
  const cliId = io.getCliSessionId(sessionId);
  if (!cliId) return;
  if (io.isUnread(sessionId)) return;
  archiveSession(sessionArchiveKey(meta.workspaceId, meta.engine ?? meta.profileId, cliId));
}
