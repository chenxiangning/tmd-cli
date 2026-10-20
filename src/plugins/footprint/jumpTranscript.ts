/**
 * ⌘K 命中 → 转录跳转:功能卡「用户原话」(card.quote.text)是逐字转录文本,
 * 可作 needle 幕布定位;时序桥在 kernel(openThenJumpToText:活会话直跳,
 * 已关会话 resume 后跳,checkpoints「看对话」同款消费)。
 * 卡标题/一句话是归纳文本不逐字、digest 摘录行无会话引用 —— 都不跳(宁缺勿错)。
 */
import { openThenJumpToText, type JumpTextOutcome } from "@kernel/anchorJump";
import { getWorkspaces } from "@kernel/workspace";
import type { FpHit } from "./dataSource";
import { readFeatureCards } from "./query";
import { getMonth } from "./rollup";

/** 命中是否可跳转录:有卡定位(featureId)才解析得到会话引用。 */
export function fpHitJumpable(hit: FpHit): boolean {
  return (hit.kind === "card" || hit.kind === "quote") && hit.featureId !== undefined;
}

/** 命中 → 转录:day 功能卡原话 sid → rollup 日会话(engine/cwd)→ kernel 时序桥;
 *  引用链任一环缺失 = miss,不猜。 */
export async function jumpHitTranscript(hit: FpHit): Promise<JumpTextOutcome> {
  const cardIdx = hit.featureId;
  if ((hit.kind !== "card" && hit.kind !== "quote") || cardIdx === undefined) return "miss";
  const cards = await readFeatureCards(hit.day);
  const quote = cards?.file.cards[cardIdx]?.quote;
  if (!quote) return "miss";
  const entry = (await getMonth(hit.day.slice(0, 7))).days[hit.day.slice(8)]?.sessions[quote.sid];
  if (!entry) return "miss";
  return openThenJumpToText(
    {
      profileId: entry.engine,
      cwd: entry.cwd,
      /* cwd → 工作区 id(已关会话恢复的归属口径,checkpoints 同款) */
      workspaceId: getWorkspaces().find((w) => entry.cwd === w.root || entry.cwd.startsWith(`${w.root}/`))?.id,
      cliSessionId: quote.sid,
    },
    quote.text,
  );
}
