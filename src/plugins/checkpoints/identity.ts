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

/* 探测窗事实单源:index.tsx 订阅 cliIdentityProbe 写入(noteEchoProbe),
 * 写路径(锚点落账)与读路径(useCkptScope 面板查询)经 echoProbing 同律
 * 消费 —— 探测窗内绑定值不可信,读侧不再查到旧绑定名下的账。 */
const echoProbes = new Set<string>();

export function noteEchoProbe(sessionId: string, active: boolean): void {
  if (active) echoProbes.add(sessionId);
  else echoProbes.delete(sessionId);
}

export function echoProbing(sessionId: string | null | undefined): boolean {
  return sessionId != null && echoProbes.has(sessionId);
}

/**
 * 探测窗主键回落(纯函数):内核 prompt 回声重验进行中时绑定值不可信,
 * 账本链暂用 tmd id(resolveLedgerKey 的无绑定分支语义);重绑落地后
 * ledger.backfill_identity 把暂记链整链并入新 CLI 身份,无损自愈。
 * (2026-10-21 01a15cea 串账实证:绑后 CLI 换磁盘会话,旧绑定吞掉新对话。)
 */
export function withEchoFallback(
  id: { cwd: string; key: string; tmdId: string },
  probing: boolean,
): { cwd: string; key: string; tmdId: string } {
  return probing ? { ...id, key: id.tmdId } : id;
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
