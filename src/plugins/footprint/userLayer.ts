/**
 * footprint 修正层 v2 差量语义(2026-10-20 改造:修「手动卡吞掉 AI 归纳卡」)。
 * .user.json 从 v1 整量快照升级为对 AI 原档的差量:
 *   overrides = 按 AI 原标题覆盖(重命名后旧题仍作键,AI 再生成不丢关联);
 *   hidden    = 显式隐藏的 AI 卡原标题(tombstone,不再靠「快照缺席」推断);
 *   added     = 用户手动新增的卡。
 * 读侧 mergeLayer 以 AI 顺序为基底原位套用;写侧 diffLayer 从生效卡集重算差分,
 * 天然无 stale 状态(重命名回原标题自动还原为 override,旧 tombstone 不残留)。
 * v1 旧档由 migrateV1 按标题对账迁移(内容同=省略,题不匹配=added,AI 缺席=hidden)。
 */
import type { FeatureCard } from "./types";

/** 修正层 v2 档(写 ~/.tmd-cli/footprint/features/YYYY-MM-DD.user.json)。 */
export interface UserCardsFile {
  version: 2;
  /** AI 卡原标题 → 用户改后整卡(未改动的 AI 卡不列)。 */
  overrides: Record<string, FeatureCard>;
  /** 显式隐藏的 AI 卡原标题。 */
  hidden: string[];
  /** 用户手动新增的卡。 */
  added: FeatureCard[];
}

/** 卡级来源(徽标逐卡区分:AI 原卡 / 用户改后 / 手动新增)。 */
export type CardProvenance = "ai" | "override" | "added";

export interface MergedCard {
  card: FeatureCard;
  provenance: CardProvenance;
}

export function emptyUserLayer(): UserCardsFile {
  return { version: 2, overrides: {}, hidden: [], added: [] };
}

/** 差量层是否等价于「无任何修正」(纯新增空层)。 */
export function isEmptyLayer(layer: UserCardsFile): boolean {
  return Object.keys(layer.overrides).length === 0 && layer.hidden.length === 0 && layer.added.length === 0;
}

/** 卡内容等价判等(差分判据;sessions 顺序敏感,quote 归一 null)。 */
export function sameCard(a: FeatureCard, b: FeatureCard): boolean {
  return (
    a.title === b.title &&
    a.summary === b.summary &&
    a.sessions.length === b.sessions.length &&
    a.sessions.every((s, i) => s === b.sessions[i]) &&
    JSON.stringify(a.quote ?? null) === JSON.stringify(b.quote ?? null)
  );
}

/** v2 层并入 AI 原档:AI 顺序为准,override 原位替换,hidden 剔除,added 追加。 */
export function mergeLayer(ai: FeatureCard[] | null, layer: UserCardsFile): MergedCard[] {
  const out: MergedCard[] = [];
  for (const c of ai ?? []) {
    if (layer.hidden.includes(c.title)) continue;
    const ov = layer.overrides[c.title];
    out.push(ov ? { card: ov, provenance: "override" } : { card: c, provenance: "ai" });
  }
  for (const c of layer.added) out.push({ card: c, provenance: "added" });
  return out;
}

/** v1 整量快照迁移:题命中 AI=override(内容同则省略),题不匹配=added。
 *  不推断 hidden——v1 快照建立时 AI 卡可能尚不存在,缺席≠用户隐藏;
 *  按快照补 hidden 会把后到的 AI 卡整体吞掉(2026-10-20 真机事故),只丢不猜。 */
export function migrateV1(snapshot: FeatureCard[], ai: FeatureCard[] | null): UserCardsFile {
  const layer = emptyUserLayer();
  const aiByTitle = new Map((ai ?? []).map((c) => [c.title, c]));
  for (const c of snapshot) {
    const base = aiByTitle.get(c.title);
    if (base) {
      if (!sameCard(base, c)) layer.overrides[c.title] = c;
    } else {
      layer.added.push(c);
    }
  }
  return layer;
}

/** 生效卡集 → 差量层:以 AI 原档为基底全量对账(每次重算,无 stale tombstone)。 */
export function diffLayer(ai: FeatureCard[] | null, next: FeatureCard[]): UserCardsFile {
  const layer = emptyUserLayer();
  const aiByTitle = new Map((ai ?? []).map((c) => [c.title, c]));
  const nextTitles = new Set(next.map((c) => c.title));
  for (const c of next) {
    const base = aiByTitle.get(c.title);
    if (base) {
      if (!sameCard(base, c)) layer.overrides[c.title] = c;
    } else {
      layer.added.push(c);
    }
  }
  for (const c of ai ?? []) {
    if (!nextTitles.has(c.title)) layer.hidden.push(c.title);
  }
  return layer;
}
