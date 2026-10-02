/**
 * 会话检索浮层 ── 输入即搜;索引按需增量构建(后台宏任务推进,进度可见)。
 * 点击结果 = openDiskSession 续聊(与侧栏磁盘行同语义);Esc/遮罩关闭。
 * 多关键词 AND 检索 + 命中片段 <mark> 高亮 + 引擎过滤 chip(拆件见 Parts);
 * 弹层焦点圈闭:打开入输入框、Tab 循环、关闭还原焦点。
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { MagnifyingGlass } from "@phosphor-icons/react";
import { host } from "@kernel/host";
import { getActiveWorkspace } from "@kernel/workspace";
import { t } from "@kernel/i18n";
import { deriveWorkspaceName } from "@kernel/pathUtils";
import { closeSessionSearch, useSessionSearchOpen } from "./overlayStore";
import { SessionIndexer, searchSessions, type SessionIndex } from "./indexer";
import { IndexingChip, ResultBody } from "./SearchOverlayParts";
import { startIndexerTicks } from "./indexerTicks";
import { useFocusTrap } from "@kernel/useFocusTrap";

export { ResultBody } from "./SearchOverlayParts";

/* 弹层焦点圈闭(同款见 RelayDialog/SendConfirmDialog/WorktreeManageDialog/academy
   wizard;候选统一收口进 kernel/DialogShell):打开焦点入首控件、Tab 循环、
   关闭还原焦点。 */

export function SessionSearchOverlay() {
  const open = useSessionSearchOpen();
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState<SessionIndex | null>(null);
  const [indexing, setIndexing] = useState(false);
  const [active, setActive] = useState(0);
  /* 引擎过滤 chip:按当前结果集的引擎集合生成,点击过滤(再点/点「全部」清)。 */
  const [engineFilter, setEngineFilter] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useFocusTrap(open);

  const ws = getActiveWorkspace();
  const cwd = ws?.root;
  const workspaceName = ws ? (ws.alias || deriveWorkspaceName(ws.root)) : undefined;

  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
    if (!cwd) return;
    setIndexing(true);
    const indexer = new SessionIndexer(cwd);
    setIndex(indexer.index);
    return startIndexerTicks(indexer, setIndex, () => setIndexing(false));
  }, [open, cwd]);

  const rawHits = useMemo(() => (index ? searchSessions(index, query) : []), [index, query]);
  /* 过滤 chip 的引擎集合来自未过滤结果;选中的引擎不在集合时视为清空(查询已变)。 */
  const engines = useMemo(
    () => Array.from(new Set(rawHits.map((h) => h.entry.profileId))),
    [rawHits],
  );
  const hits = useMemo(
    () => (engineFilter && engines.includes(engineFilter) ? rawHits.filter((h) => h.entry.profileId === engineFilter) : rawHits),
    [rawHits, engineFilter, engines],
  );
  /* 越界收口(命中集随索引推进/过滤变化);选中行滚入视野(QuickOpen 惯例)。 */
  const sel = Math.min(active, Math.max(hits.length - 1, 0));
  useEffect(() => {
    listRef.current
      ?.querySelector('[data-sel="true"]')
      ?.scrollIntoView({ block: "nearest" });
  }, [sel]);

  if (!open || !cwd) return null;

  const openHit = (profileId: string, cliSessionId: string) => {
    closeSessionSearch();
    void host.openDiskSession(profileId, cwd, getActiveWorkspace()?.id, cliSessionId);
  };

  return createPortal(
    <>
      {/* 全屏容器(z-1201)统一收 Esc 与遮罩点击(自靶判定):容器自身即覆盖
          全屏,独立捕获层会被其整体遮蔽成死代码,故不设。 */}
      <div
        role="presentation"
        className="fixed inset-0 z-[1201] flex items-start justify-center bg-black/45 pt-[12vh]"
        onClick={(e) => {
          if (e.target === e.currentTarget) closeSessionSearch();
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape" && !e.nativeEvent.isComposing) closeSessionSearch();
        }}
        data-testid="session-search-backdrop"
      >
        <div
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-label={t("会话历史搜索")}
          className="flex max-h-[70vh] w-[560px] flex-col overflow-hidden rounded-xl border border-(--tmd-border) bg-(--tmd-bg-panel) shadow-(--tmd-shadow-modal)"
        >
        <div className="flex items-center gap-2 border-b border-(--tmd-border) px-3 py-2.5">
          <MagnifyingGlass size="0.9375rem" className="shrink-0 text-(--tmd-fg-faint)" aria-hidden />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0); /* 输入变 = 结果变,选中回顶(索引推进不清位:越界由 sel 收口兜) */
            }}
            onKeyDown={(e) => {
              /* IME 组合期按键(含 Enter 选词)不动作,同 QuickOpen enterAction 契约。 */
              if (e.nativeEvent.isComposing) return;
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setActive(Math.min(sel + 1, hits.length - 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setActive(Math.max(sel - 1, 0));
              } else if (e.key === "Enter") {
                const hit = hits[sel];
                if (hit) openHit(hit.entry.profileId, hit.entry.cliSessionId);
              }
            }}
            placeholder={t("搜索本工作区的会话历史(你输入过的内容)…")}
            aria-label={t("会话历史搜索")}
            className="w-full bg-transparent text-sm text-(--tmd-fg) outline-none placeholder:text-(--tmd-fg-faint)"
          />
          {indexing && <IndexingChip index={index} />}
        </div>
        {engines.length > 1 && (
          /* 引擎过滤 chip:结果引擎集合生成(单引擎不出,无噪音)。 */
          <div className="flex flex-wrap items-center gap-1 border-b border-(--tmd-border) px-3 py-1.5" role="group" aria-label={t("按引擎过滤")}>
            <button
              type="button"
              aria-pressed={engineFilter == null}
              onClick={() => setEngineFilter(null)}
              className={chipCls(engineFilter == null)}
            >
              {t("全部")}
            </button>
            {engines.map((e) => (
              <button
                key={e}
                type="button"
                aria-pressed={engineFilter === e}
                onClick={() => setEngineFilter(engineFilter === e ? null : e)}
                className={chipCls(engineFilter === e)}
              >
                {host.getCliProfile(e)?.name ?? e}
              </button>
            ))}
          </div>
        )}
        <div ref={listRef} className="min-h-0 flex-1 overflow-auto">
          <ResultBody
            queryEmpty={query.trim() === ""}
            indexing={indexing}
            index={index}
            hits={hits}
            active={sel}
            onOpen={openHit}
          />
        </div>
        <div className="border-t border-(--tmd-border) px-3 py-1.5 text-xs text-(--tmd-fg-faint)">
          {t("↑↓ 选择 · Enter 打开 {name} 的历史会话 · Esc 关闭", { name: workspaceName ?? "" })}
        </div>
        </div>
      </div>
    </>,
    document.body,
  );
}

/** 引擎过滤 chip 按钮(选中 = accent 软底;与目标引擎单选 chip 同视觉语系)。 */
function chipCls(on: boolean): string {
  return `rounded border px-1.5 py-px text-xs leading-4 ${
    on
      ? "border-(--tmd-accent) bg-(--tmd-accent)/10 text-(--tmd-fg)"
      : "border-(--tmd-border) text-(--tmd-fg-faint) hover:text-(--tmd-fg)"
  }`;
}
