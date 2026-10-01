/**
 * 商店视图 ── ClawHub 列表/搜索/排序/分类 chips/cursor 分页/已装徽标 +
 * 可更新徽标与「更新」入口(重走安装弹窗链)。
 * 搜索 260ms 防抖;网络失败 = 错误态 + 重试,不白屏。
 */

import { useEffect, useMemo, useState } from "react";
import { MagnifyingGlass, ArrowClockwise } from "@phosphor-icons/react";
import { t } from "@kernel/i18n";
import { listClawHubSkills, searchClawHubSkills } from "./clawhub";
import {
  CLAWHUB_SORTS,
  isNewerSkillVersion,
  type ClawHubCard,
  type ClawHubSort,
} from "./clawhubNormalize";
import { refreshSkillScan } from "./skillStore";
import { StoreCard } from "./StoreCard";
import { InstallDialog } from "./InstallDialog";
import { useSkillRegistry, type InstalledSkillRecord } from "@plugins/cli-shared/skillRegistry";
const SEARCH_DEBOUNCE_MS = 260;
const PAGE_SIZE = 24;
/** 分类 chips 取已载条目的高频 topics 前 8。 */
const TOPIC_CHIP_COUNT = 8;

const SORT_LABELS: Record<ClawHubSort, string> = {
  downloads: "下载最多",
  stars: "星标最多",
  installs: "安装最多",
  updated: "最近更新",
  newest: "最新上架",
};

function StoreToolbar(props: {
  query: string;
  onQuery: (q: string) => void;
  sort: ClawHubSort;
  onSort: (s: ClawHubSort) => void;
  topics: readonly string[];
  topic: string;
  onTopic: (tp: string) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-(--tmd-border) px-3 py-2">
      <MagnifyingGlass size={13} className="shrink-0 text-(--tmd-fg-faint)" aria-hidden="true" />
      <input
        value={props.query}
        onChange={(e) => props.onQuery(e.target.value)}
        placeholder={t("搜索 ClawHub 技能…")}
        className="w-56 rounded border border-(--tmd-border) bg-(--tmd-bg-input) px-2 py-1 text-xs outline-none focus:border-(--tmd-accent)"
        data-store-search
      />
      <select
        value={props.sort}
        onChange={(e) => props.onSort(e.target.value as ClawHubSort)}
        aria-label={t("排序方式")}
        className="rounded border border-(--tmd-border) bg-(--tmd-bg-input) px-1.5 py-1 text-xs outline-none"
      >
        {CLAWHUB_SORTS.map((s) => (
          <option key={s} value={s}>
            {t(SORT_LABELS[s])}
          </option>
        ))}
      </select>
      {props.topics.length > 0 && (
        <div className="flex flex-wrap items-center gap-1">
          {props.topics.map((tp) => (
            <button
              key={tp}
              type="button"
              onClick={() => props.onTopic(tp)}
              className={`rounded px-1.5 py-px text-[10px] ${
                props.topic === tp
                  ? "bg-(--tmd-accent-soft) text-(--tmd-fg)"
                  : "bg-(--tmd-bg-sunken) text-(--tmd-fg-muted) hover:text-(--tmd-fg)"
              }`}
            >
              {tp}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function StoreListArea(props: {
  error: string | null;
  loading: boolean;
  emptyHint: string;
  visible: readonly ClawHubCard[];
  isInstalled: (card: ClawHubCard) => boolean;
  updateAvailable: (card: ClawHubCard) => boolean;
  onInstall: (card: ClawHubCard) => void;
  onUpdate: (card: ClawHubCard) => void;
  showMore: boolean;
  loadingMore: boolean;
  loadMoreError?: string | null;
  onRetry: () => void;
  onLoadMore: () => void;
}) {
  if (props.error) {
    return (
      <div className="min-h-0 flex-1 overflow-auto px-3 py-2" data-skill-store>
        <div className="flex flex-col items-center gap-2 py-8">
          <div className="text-xs text-(--tmd-err)" data-store-error>
            {t("商店加载失败")}:{props.error}
          </div>
          <button
            type="button"
            onClick={props.onRetry}
            className="flex items-center gap-1 rounded border border-(--tmd-border) px-2.5 py-1 text-xs hover:bg-(--tmd-bg-hover)"
          >
            <ArrowClockwise size={12} aria-hidden="true" />
            {t("重试")}
          </button>
        </div>
      </div>
    );
  }
  return (
    <div className="min-h-0 flex-1 overflow-auto px-3 py-2" data-skill-store>
      {props.loading ? (
        <div className="py-8 text-center text-xs text-(--tmd-fg-faint)">{t("加载中…")}</div>
      ) : props.visible.length === 0 ? (
        <div className="py-8 text-center text-xs text-(--tmd-fg-faint)">{props.emptyHint}</div>
      ) : (
        <>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(250px,1fr))] gap-2">
            {props.visible.map((card) => (
              <StoreCard
                key={`${card.ownerHandle}/${card.slug}`}
                card={card}
                installed={props.isInstalled(card)}
                updateAvailable={props.updateAvailable(card)}
                onInstall={props.onInstall}
                onUpdate={props.onUpdate}
              />
            ))}
          </div>
          {props.showMore && (
            <div className="flex flex-col items-center gap-1 py-3">
              {props.loadMoreError && (
                <div className="text-[11px] text-(--tmd-err)">{t("翻页失败")}:{props.loadMoreError}</div>
              )}
              <button
                type="button"
                onClick={props.onLoadMore}
                disabled={props.loadingMore}
                className="rounded border border-(--tmd-border) px-3 py-1 text-xs hover:bg-(--tmd-bg-hover) disabled:opacity-50"
              >
                {props.loadingMore ? t("加载中…") : t("加载更多")}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

export function StoreView() {
  const [sort, setSort] = useState<ClawHubSort>("downloads");
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [reloadNonce, setReloadNonce] = useState(0);
  const [topic, setTopic] = useState("");
  const [items, setItems] = useState<readonly ClawHubCard[]>([]);
  const [cursor, setCursor] = useState("");
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [installing, setInstalling] = useState<ClawHubCard | null>(null);
  /* 已装记录快照(v2:安装记录为依据;记录名 = 安装 slug)。 */
  const { records } = useSkillRegistry();
  const recordByName = useMemo(() => {
    const m = new Map<string, InstalledSkillRecord>();
    for (const r of records) m.set(r.name.toLowerCase(), r);
    return m;
  }, [records]);
  /* 卡 → 记录键:slug 精确优先,displayName 小写兜底仅当 slug 缺失。 */
  const recordKey = (card: ClawHubCard): string =>
    (card.slug || card.displayName).toLowerCase();

  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(query.trim()), SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [query]);

  /* 排序/搜索词/重试 nonce 变更 = 重置分页重拉;搜索词回落列表模式。 */
  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    void (async () => {
      try {
        const result = debounced
          ? {
              items: await searchClawHubSkills({ query: debounced, limit: PAGE_SIZE }),
              nextCursor: "",
            }
          : await listClawHubSkills({ sort, limit: PAGE_SIZE });
        if (!alive) return;
        setItems(result.items);
        setCursor(result.nextCursor);
      } catch (e) {
        if (alive) {
          setItems([]);
          setCursor("");
          setError(e instanceof Error ? e.message : String(e));
        }
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [sort, debounced, reloadNonce]);

  /* 翻页失败只记局部提示,不清列表(error 主态仅首屏拉取使用)。 */
  const [loadMoreError, setLoadMoreError] = useState<string | null>(null);
  const loadMore = async (): Promise<void> => {
    if (!cursor || loadingMore) return;
    setLoadingMore(true);
    setLoadMoreError(null);
    try {
      const result = await listClawHubSkills({ sort, limit: PAGE_SIZE, cursor });
      setItems((prev) => [...prev, ...result.items]);
      setCursor(result.nextCursor);
    } catch (e) {
      setLoadMoreError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoadingMore(false);
    }
  };

  const topics = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of items) {
      for (const tp of item.topics) counts.set(tp, (counts.get(tp) ?? 0) + 1);
    }
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, TOPIC_CHIP_COUNT)
      .map(([tp]) => tp);
  }, [items]);

  const visible = topic ? items.filter((i) => i.topics.includes(topic)) : items;
  const isInstalled = (card: ClawHubCard): boolean => recordByName.has(recordKey(card));
  /* 更新闭环比对:记录有版本且 ClawHub latestVersion 更新才显;缺版本如实不显。 */
  const updateAvailable = (card: ClawHubCard): boolean => {
    const rec = recordByName.get(recordKey(card));
    return !!rec?.version && isNewerSkillVersion(card.latestVersion, rec.version);
  };

  return (
    <div className="relative flex h-full min-h-0 flex-col">
      <StoreToolbar
        query={query}
        onQuery={setQuery}
        sort={sort}
        onSort={setSort}
        topics={topics}
        topic={topic}
        onTopic={(tp) => setTopic(topic === tp ? "" : tp)}
      />
      <StoreListArea
        error={error}
        loading={loading}
        emptyHint={debounced ? t("无匹配技能") : t("商店暂无内容")}
        visible={visible}
        isInstalled={isInstalled}
        updateAvailable={updateAvailable}
        onInstall={setInstalling}
        onUpdate={setInstalling}
        showMore={cursor !== "" && topic === ""}
        loadingMore={loadingMore}
        loadMoreError={loadMoreError}
        onRetry={() => setReloadNonce((n) => n + 1)}
        onLoadMore={() => void loadMore()}
      />
      {installing && (
        <InstallDialog
          card={installing}
          onClose={() => setInstalling(null)}
          onInstalled={() => void refreshSkillScan()}
        />
      )}
    </div>
  );
}
