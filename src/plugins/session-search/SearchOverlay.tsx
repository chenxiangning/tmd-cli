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
import { deriveWorkspaceName } from "@kernel/pathUtils";
import { closeSessionSearch, useSessionSearchOpen } from "./overlayStore";
import { SessionIndexer, searchSessions, type SessionIndex, type SessionSearchHit } from "./indexer";

/** 索引推进节奏:每 60ms 一个会话(单会话读取可达数 MB,不让 I/O 连发)。 */
const STEP_INTERVAL_MS = 60;

/** 索引推进循环:prime 一次后逐步 step,扫完/空索引自停。
 * 独立组件外函数——控制流不进 React 函数体(react-doctor 复杂度闸)。 */
function startIndexerTicks(
  indexer: SessionIndexer,
  onIndex: (idx: SessionIndex) => void,
  onSettled: () => void,
): () => void {
  let primed = false;
  let stop: () => void;
  const tick = async (): Promise<boolean> => {
    if (!primed) {
      primed = true;
      const total = await indexer.prime().catch(() => 0);
      indexer.index.total = total;
      onIndex({ ...indexer.index }); /* 列举失败位(listFailed)随首拍可见 */
      if (total === 0) {
        onSettled();
        stop();
      }
      return total > 0;
    }
    const more = await indexer.step();
    onIndex({ ...indexer.index });
    if (!more) {
      onSettled();
      stop(); // 扫完自停
    }
    return more;
  };
  /* 单步失败只跳过该会话(坏行/越权读),继续推进 —— 否则一步 reject
   * 永久停摆且 indexing 永不落位,搜索静默变成「永远扫不完」。
   * 自调度 setTimeout 链:上一拍 await 完才排下一拍,单会话读取(数 MB)
   * 超 60ms 时不再多拍并发在途。 */
  stop = (() => {
    let stopped = false;
    let timer: number | undefined;
    const run = async () => {
      let keepGoing = false;
      try {
        keepGoing = await tick();
      } catch {
        keepGoing = true; /* 单步失败跳过,不灭循环 */
      }
      if (keepGoing && !stopped) timer = window.setTimeout(() => void run(), STEP_INTERVAL_MS);
    };
    timer = window.setTimeout(() => void run(), STEP_INTERVAL_MS);
    return () => {
      stopped = true;
      window.clearTimeout(timer);
    };
  })();
  return stop;
}

/** 索引进度小徽标(输入行右侧)。 */
function IndexingChip({ index }: { index: SessionIndex | null }) {
  return (
    <span className="flex shrink-0 items-center gap-1 text-[0.6875rem] text-(--tmd-fg-faint)">
      <CircleNotch size="0.75rem" className="animate-spin" aria-hidden />
      {index ? t("索引中 {n}/{total}", { n: index.scanned, total: index.total }) : t("准备中…")}
    </span>
  );
}

/** 单条命中行:标题回退链(标题/首条消息/短 id)+ usage 徽标 + 相对时间。 */
function HitRow({ hit, onOpen, selected }: { hit: SessionSearchHit; onOpen: (profileId: string, cliSessionId: string) => void; selected: boolean }) {
  return (
    <button
      type="button"
      data-sel={selected || undefined}
      onClick={() => onOpen(hit.entry.profileId, hit.entry.cliSessionId)}
      className={`block w-full border-b border-(--tmd-border)/60 px-3 py-2 text-left ${selected ? "bg-(--tmd-bg-hover)" : "hover:bg-(--tmd-bg-hover)"}`}
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
  );
}

/** 结果区:未输入提示 / 无命中(索引中·空索引·列举失败·无匹配四分流)/ 命中列表。
 *  导出为测试缝(ExitSessionNotices 先例):钉选中呈现契约,键盘面走桩目检。 */
export function ResultBody({ queryEmpty, indexing, index, hits, active, onOpen }: {
  queryEmpty: boolean;
  indexing: boolean;
  index: SessionIndex | null;
  hits: SessionSearchHit[];
  active: number;
  onOpen: (profileId: string, cliSessionId: string) => void;
}) {
  if (queryEmpty) {
    return (
      <div className="px-3 py-6 text-center text-xs text-(--tmd-fg-faint)">
        {t("输入关键词,按标题与你的历史输入检索会话")}
      </div>
    );
  }
  if (hits.length === 0) {
    const hint = indexing
      ? t("索引还没扫到,稍候…")
      : index && index.total === 0
        ? index.listFailed > 0
          ? t("会话列举失败:部分引擎的磁盘会话目录读不到")
          : t("此工作区未发现可检索的磁盘会话")
        : t("已扫 {scanned}/{total} 个会话,无匹配", { scanned: index?.scanned ?? 0, total: index?.total ?? 0 });
    return <div className="px-3 py-6 text-center text-xs text-(--tmd-fg-faint)">{hint}</div>;
  }
  return (
    <>
      {hits.map((hit, i) => (
        <HitRow key={`${hit.entry.profileId}:${hit.entry.cliSessionId}`} hit={hit} onOpen={onOpen} selected={i === active} />
      ))}
    </>
  );
}

export function SessionSearchOverlay() {
  const open = useSessionSearchOpen();
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState<SessionIndex | null>(null);
  const [indexing, setIndexing] = useState(false);
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

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

  const hits = useMemo(() => (index ? searchSessions(index, query) : []), [index, query]);
  /* 越界收口(命中集随索引推进变化);选中行滚入视野(QuickOpen 惯例)。 */
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
        <div className="flex max-h-[70vh] w-[560px] flex-col overflow-hidden rounded-xl border border-(--tmd-border) bg-(--tmd-bg-panel) shadow-2xl">
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
        <div className="border-t border-(--tmd-border) px-3 py-1.5 text-[0.6875rem] text-(--tmd-fg-faint)">
          {t("↑↓ 选择 · Enter 打开 {name} 的历史会话 · Esc 关闭", { name: workspaceName ?? "" })}
        </div>
        </div>
      </div>
    </>,
    document.body,
  );
}
