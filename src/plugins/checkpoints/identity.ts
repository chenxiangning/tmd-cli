/**
 * checkpoints 会话身份解析 —— 记账与查询共用的账本主键仲裁。
 *
 * 账本按身份字符串隔离,身份只准到内核绑定映射(host.cliSessionIds)。
 * 实证缺陷(2026-09-03 账本 dump):并行 spawn/磁盘身份扫描竞态会把**新会话**
 * 绑到**老会话**的 cli 磁盘身份上 —— 两个活会话共用一条账,新会话直接看到
 * 老会话的审批线(用户报的"new 新会话还能看到审批线")。
 *
 * 防御规则(账本层兜底,不依赖内核绑定修复的进度):
 * 同一 cli 身份被多个活会话持有时,**先创建的会话保留**(同毫秒按 id 字典序
 * 定全序),后到者回退自己的 tmd id 起新链 —— 绑定修好后,anchor 的身份
 * 回填(ledger.backfill_identity)会自动把回退链并入真实身份,无损自愈。
 */

import { host } from "@kernel/host";

interface SessionLike {
  id: string;
  createdAt?: number;
}

/**
 * 纯仲裁:本会话的账本主键。
 * - 无绑定 → tmd id(首条 prompt 常见,链先记 tmd 名下)
 * - cli 身份无争持 → cli id(稳定身份,重启/resume 可找回)
 * - cli 身份被多个活会话持有 → 仅先创建者保留,后到者回退 tmd id
 */
export function resolveLedgerKey(
  me: SessionLike,
  cli: string | undefined,
  peers: SessionLike[],
  cliOf: (id: string) => string | undefined,
): string {
  if (!cli) return me.id;
  const rivals = peers.filter((p) => p.id !== me.id && cliOf(p.id) === cli);
  if (rivals.length === 0) return cli;
  const prio = (s: SessionLike) => s.createdAt ?? Number.MAX_SAFE_INTEGER;
  const iWin = rivals.every(
    (p) => prio(me) < prio(p) || (prio(me) === prio(p) && me.id < p.id),
  );
  return iWin ? cli : me.id;
}

/** 记账/查询统一入口:解析活跃会话的 (cwd, 账本主键, tmd id)。会话不存在 → null。 */
export function checkpointIdentity(
  tmdId: string,
): { cwd: string; key: string; tmdId: string } | null {
  const session = host.getSessions().find((s) => s.id === tmdId);
  if (!session) return null;
  const key = resolveLedgerKey(
    session,
    host.getCliSessionId(tmdId),
    host.getSessions(),
    (id) => host.getCliSessionId(id),
  );
  return { cwd: session.cwd, key, tmdId };
}
