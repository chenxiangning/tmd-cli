/**
 * 会话检索浮层 ── 输入即搜;索引按需增量构建(后台宏任务推进,进度可见)。
 * 点击结果 = openDiskSession 续聊(与侧栏磁盘行同语义);Esc/遮罩关闭。
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CircleNotch, MagnifyingGlass } from "@phosphor-icons/react";
import { host } from "@kernel/host";
import { getActiveWorkspace } from "@kernel/workspace";
import { t } from "@kernel/i18n";
import { formatRelativeTime } from "@kernel/relativeTime";
import { closeSessionSearch } from "./overlayStore";
import { SessionIndexer, searchSessions, type SessionIndex } from "./indexer";

/** 索引推进节奏:每 60ms 一个会话(单会话读取可达数 MB,不让 I/O 连发)。 */
const STEP_INTERVAL_MS = 60;

export function SessionSearchOverlay() {
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState<SessionIndex | null>(null);
  const [indexing, setIndexing] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const cwd = getActiveWorkspace()?.root;
  const workspaceName = getActiveWorkspace()
    ? (getActiveWorkspace()?.alias || getActiveWorkspace()?.root.split("/").pop())
    : undefined;

  useEffect(() => {
    inputRef.current?.focus();
    if (!cwd) return;
    setIndexing(true);
    const indexer = new SessionIndexer(cwd);
    setIndex(indexer.index);
    let primed = false;
    const tick = async (): Promise<boolean> => {
      if (!primed) {
        primed = true;
        return (await indexer.prime()) > 0;
      }
      const more = await indexer.step();
      setIndex({ ...indexer.index });
      if (!more) {
        setIndexing(false);
        clearInterval(timer); // 扫完自停
      }
      return more;
    };
    const timer = setInterval(() => void tick().catch(() => clearInterval(timer)), STEP_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [cwd]);

  const hits = useMemo(() => (index ? searchSessions(index, query) : []), [index, query]);

  if (!cwd) return null;

  const openHit = (profileId: string, cliSessionId: string) => {
    closeSessionSearch();
    void host.openDiskSession(profileId, cwd, getActiveWorkspace()?.id, cliSessionId);
  };

  return createPortal(
    <>
      {/* 壳对齐 house search 插件:透明点击捕获层(z-1200) + 全屏容器(z-1201,Esc 随焦点容器收)。
          原实现 z-1000 + 遮罩点击关 + 输入行级 Esc——被中层内容压过即「关不掉/浮层泄进页面」。 */}
      <div className="wsmenu-backdrop" role="presentation" onClick={closeSessionSearch} />
      <div
        className="fixed inset-0 z-[1201] flex items-start justify-center pt-[12vh]"
        onKeyDown={(e) => {
          if (e.key === "Escape") closeSessionSearch();
        }}
        data-testid="session-search-backdrop"
      >
        <div className="flex max-h-[70vh] w-[560px] flex-col overflow-hidden rounded-xl border border-(--tmd-border) bg-(--tmd-bg-panel) shadow-2xl">
        <div className="flex items-center gap-2 border-b border-(--tmd-border) px-3 py-2.5">
          <MagnifyingGlass size="0.9375rem" className="shrink-0 text-(--tmd-fg-faint)" aria-hidden />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("搜索本工作区的会话历史(你输入过的内容)…")}
            aria-label={t("会话历史搜索")}
            className="w-full bg-transparent text-sm text-(--tmd-fg) outline-none placeholder:text-(--tmd-fg-faint)"
          />
          {indexing && (
            <span className="flex shrink-0 items-center gap-1 text-[0.6875rem] text-(--tmd-fg-faint)">
              <CircleNotch size="0.75rem" className="animate-spin" aria-hidden />
              {index ? t("索引中 {n}/{total}", { n: index.scanned, total: index.total }) : t("准备中…")}
            </span>
          )}
        </div>
        <div className="min-h-0 flex-1 overflow-auto">
          {query.trim() === "" ? (
            <div className="px-3 py-6 text-center text-xs text-(--tmd-fg-faint)">
              {t("输入关键词,按标题与你的历史输入检索会话")}
            </div>
          ) : hits.length === 0 ? (
            <div className="px-3 py-6 text-center text-xs text-(--tmd-fg-faint)">
              {indexing ? t("索引还没扫到,稍候…") : t("无匹配会话")}
            </div>
          ) : (
            hits.map((hit) => (
              <button
                key={`${hit.entry.profileId}:${hit.entry.cliSessionId}`}
                type="button"
                onClick={() => openHit(hit.entry.profileId, hit.entry.cliSessionId)}
                className="block w-full border-b border-(--tmd-border)/60 px-3 py-2 text-left hover:bg-(--tmd-bg-hover)"
              >
                <div className="flex items-center gap-2">
                  <span className="shrink-0 text-[0.6875rem] font-medium text-(--tmd-accent)">
                    {host.getCliProfile(hit.entry.profileId)?.name ?? hit.entry.profileId}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-xs text-(--tmd-fg)">
                    {hit.entry.title || hit.entry.messages[0]?.slice(0, 60) || hit.entry.cliSessionId}
                  </span>
                  {hit.entry.usage && (
                    <span className="shrink-0 rounded bg-(--tmd-bg-hover) px-1 text-[0.625rem] text-(--tmd-fg-faint)">
                      {hit.entry.usage}
                    </span>
                  )}
                  <span className="shrink-0 text-[0.6875rem] text-(--tmd-fg-faint)">
                    {formatRelativeTime(hit.entry.modifiedAt)}
                  </span>
                </div>
                <div className="mt-0.5 line-clamp-2 text-[0.75rem] leading-4 text-(--tmd-fg-faint)">
                  {hit.snippet}
                </div>
              </button>
            ))
          )}
        </div>
        <div className="border-t border-(--tmd-border) px-3 py-1.5 text-[0.6875rem] text-(--tmd-fg-faint)">
          {t("Enter 打开 {name} 的历史会话 · Esc 关闭", { name: workspaceName ?? "" })}
        </div>
        </div>
      </div>
    </>,
    document.body,
  );
}
