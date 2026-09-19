/**
 * kimi 会话判空 —— 会话卫生清扫(isDiskSessionEmpty 钩子)的 kimi 实现。
 * 自 kimiSessions.ts 拆出(文件规模铁则)。
 *
 * path = 会话目录,新老布局同构:新布局 wire 在 agents/main/wire.jsonl,
 * 老 home(≤0.34)目录直挂 wire.jsonl。双候选位顺序探测;任一可读且无用户
 * 消息标记 = 空;两处都读不到 = 判不了(false 不删,共享 helper 契约)。
 */

import { isJsonlSessionEmpty } from "../cli-shared/sessionEmpty";

export async function isKimiSessionEmpty(path: string): Promise<boolean> {
  return (
    (await isJsonlSessionEmpty(`${path}/agents/main/wire.jsonl`)) ||
    (await isJsonlSessionEmpty(`${path}/wire.jsonl`))
  );
}
