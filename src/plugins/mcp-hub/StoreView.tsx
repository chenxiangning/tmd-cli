/**
 * 商店视图 —— 三源(official/Smithery/Glama)浏览搜索 + 安装入口。
 * 网络全走 registrySources(quotaFetch);会话内存缓存(module 级 Map,
 * 源+查询词为键,手动刷新清空;不做落盘缓存);单源失败 = 空态 + 错误
 * 提示,不白屏。分页:游标追加加载(cursor/nextCursor)。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowsClockwise, MagnifyingGlass, DownloadSimple } from "@phosphor-icons/react";
import { t } from "@kernel/i18n";
import { Spinner } from "@kernel/Spinner";
import { REGISTRY_SOURCES, searchRegistrySource, type RegistryResult, type RegistrySourceName } from "./registrySources";
import type { RegistryCard } from "./registryNormalize";
import type { McpEngineState } from "./hubStore";
import { StoreCard } from "./StoreCard";
import { InstallDraftModal } from "./InstallDraftModal";

/** 会话内存缓存:源+查询词 → 首屏结果(翻页数据不入缓存,重开重拉)。 */
const cache = new Map<string, RegistryResult>();

export function StoreView({
  engines,
  defaultEngine,
}: {
  engines: McpEngineState[];
  defaultEngine: McpEngineState | null;
}) {
  const [source, setSource] = useState<RegistrySourceName>("official");
  const [query, setQuery] = useState("");
  const [submitted, setSubmitted] = useState("");
  const [items, setItems] = useState<RegistryCard[]>([]);
  const [nextCursor, setNextCursor] = useState<string | undefined>();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [installing, setInstalling] = useState<RegistryCard | null>(null);

  /* run 保持 items 无依赖:翻页用函数式 setItems 追加(防「加载更多」把
     首屏替换成下一页);缓存只在首屏(!cursor)写入(防翻页结果污染缓存)。
     竞态守卫 = 序号自增、旧响应晚到即弃(skill-hub 的 effect 内 alive 旗标
     改形:run 被 effect/refresh/loadMore 三方共用,旗标须随请求走)。 */
  const seqRef = useRef(0);
  const run = useCallback(async (src: RegistrySourceName, q: string, cursor?: string) => {
    const seq = ++seqRef.current;
    const stale = () => seq !== seqRef.current;
    setLoading(true);
    setError(null);
    try {
      const key = `${src}|${q}`;
      if (!cursor && cache.has(key)) {
        const hit = cache.get(key)!;
        setItems(hit.items);
        setNextCursor(hit.nextCursor);
        return;
      }
      const result = await searchRegistrySource({ source: src, query: q, cursor });
      if (stale()) return; // 旧响应晚到:新源/新词已接管列表
      if (!cursor) cache.set(key, result);
      setItems((prev) => (cursor ? [...prev, ...result.items] : result.items));
      setNextCursor(result.nextCursor);
    } catch (e) {
      if (stale()) return;
      setError(e instanceof Error ? e.message : String(e));
      if (!cursor) setItems([]);
      setNextCursor(undefined);
    } finally {
      /* 函数式更新:无条件调用(契约要求重置在 finally);陈旧请求回原值,
         不动新请求刚置的 loading 态。 */
      setLoading((busy) => (seqRef.current === seq ? false : busy));
    }
  }, []);

  useEffect(() => {
    void run(source, submitted);
  }, [source, submitted, run]);

  const refresh = () => {
    cache.clear();
    void run(source, submitted);
  };

  return (
    <div className="px-4 py-3">
      <div className="mb-3 flex items-center gap-2">
        {REGISTRY_SOURCES.map((s) => (
          <button
            key={s.id}
            type="button"
            aria-pressed={source === s.id}
            className={`mcphub-seg-btn ${source === s.id ? "is-on" : ""}`}
            onClick={() => setSource(s.id)}
          >
            {s.label}
          </button>
        ))}
        <div className="relative ml-auto min-w-0 flex-1">
          <MagnifyingGlass size="0.75rem" className="pointer-events-none absolute top-1.5 left-2.5 text-(--tmd-fg-faint)" aria-hidden />
          <form
            onSubmit={(e) => {
              e.preventDefault();
              setSubmitted(query.trim());
            }}
          >
            <input
              className="mcphub-input pl-7"
              value={query}
              aria-label={t("搜索 MCP 服务器")}
              placeholder={t("搜索后回车")}
              onChange={(e) => setQuery(e.target.value)}
            />
          </form>
        </div>
        <button type="button" className="mcphub-ghost-btn flex-none" title={t("清缓存重拉")} onClick={refresh}>
          <ArrowsClockwise size="0.75rem" aria-hidden />
          {t("刷新")}
        </button>
      </div>

      {error && (
        /* 可重试取数失败 = 持久条 + 重试钮(R6 错误契约;重试 = 清缓存重拉同路) */
        <div
          className="mb-2 flex items-start justify-between gap-2 rounded-(--tmd-radius-sm) border border-(--tmd-border) bg-(--tmd-diff-removed)/10 px-3 py-2 text-meta leading-relaxed text-(--tmd-diff-removed)"
          role="alert"
          data-store-error
        >
          <span className="min-w-0 break-all">
            {source === "glama"
              ? t("Glama 源请求失败(匿名访问已被限制,需 API key)")
              : t("该源不可达或暂不可用")}{" "}
            · {error}
          </span>
          <button
            type="button"
            onClick={refresh}
            disabled={loading}
            className="flex-none rounded border border-(--tmd-border) px-2 py-0.5 text-meta text-(--tmd-fg-muted) hover:border-(--tmd-accent) hover:text-(--tmd-accent) disabled:opacity-50"
          >
            {t("重试")}
          </button>
        </div>
      )}

      {loading && items.length === 0 ? (
        <div className="py-10 text-center text-xs text-(--tmd-fg-faint)">
          <Spinner /> {t("加载中…")}
        </div>
      ) : items.length === 0 && !error ? (
        <div className="py-10 text-center text-xs text-(--tmd-fg-faint)">{t("无结果;换个关键词试试")}</div>
      ) : (
        <div className="flex flex-col gap-1.5">
          {items.map((card) => (
            <StoreCard key={card.id} card={card} onInstall={() => setInstalling(card)} />
          ))}
        </div>
      )}

      {nextCursor && (
        <button
          type="button"
          className="mcphub-ghost-btn mt-3 w-full justify-center"
          disabled={loading}
          onClick={() => void run(source, submitted, nextCursor)}
        >
          <DownloadSimple size="0.75rem" aria-hidden />
          {loading ? <Spinner /> : t("加载更多")}
        </button>
      )}

      {installing && (
        <InstallDraftModal
          card={installing}
          engines={engines}
          defaultEngine={defaultEngine}
          onClose={() => setInstalling(null)}
        />
      )}
    </div>
  );
}
