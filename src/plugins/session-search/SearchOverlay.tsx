/**
 * 会话检索浮层 ── 输入即搜;索引按需增量构建(后台宏任务推进,进度可见)。
 * 作用域 chip(042):本工作区 / 全部工作区(N)——「全部」= getWorkspaces() 各
 * root 喂同一 SessionIndexer,零第二条管线;切回即中止扫描(缓存留存)。
 * 跨区 Enter = 先 setActiveWorkspace(目标)再 openThenJumpToText(先切后跳裁决:
 * miss/opened 降级时用户已身处目标区);失效区命中灰显不可跳,点击仅 toast。
 * 点击结果 = openDiskSession 续聊(与侧栏磁盘行同语义);Esc/遮罩关闭。
 * 多关键词 AND 检索 + 命中片段 <mark> 高亮 + 引擎/时间/作用域过滤 chip(拆件见 Parts);
 * 弹层焦点圈闭:打开入输入框、Tab 循环、关闭还原焦点。
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { MagnifyingGlass } from "@phosphor-icons/react";
import { host } from "@kernel/host";
import { KernelTopics } from "@kernel/events";
import { getActiveWorkspace, getWorkspaces, setActiveWorkspace } from "@kernel/workspace";
import { t } from "@kernel/i18n";
import { deriveWorkspaceName } from "@kernel/pathUtils";
import { openThenJumpToText } from "@kernel/anchorJump";
import { closeSessionSearch, showSearchToast, useSearchToast, useSessionSearchOpen } from "./overlayStore";
import { SessionIndexer, type SessionIndex } from "./indexer";
import {
  searchSessions,
  timeRangeFor,
  applyFilters,
  engineFilterDangling,
  locateTargetOf,
  type SessionSearchHit,
  type SessionSubHit,
  type TimeFilterKey,
} from "./searchCore";
import { FilterChips, IndexingChip, ResultBody, type SearchScope } from "./SearchOverlayParts";
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
  /* 作用域 chip(042):浮层局部 state 不持久化(裁决④),关浮层再开回本区。 */
  const [scope, setScope] = useState<SearchScope>("ws");
  /* 引擎过滤 chip:按当前结果集的引擎集合生成,点击过滤(再点/点「全部」清)。 */
  const [engineFilter, setEngineFilter] = useState<string | null>(null);
  /* 时间过滤 chip:静态枚举恒渲染;换挡即换查询窗(chip 不变时 now 不重算,
     回溯窗以打开浮层那一刻为基准,足够语义)。 */
  const [timeFilter, setTimeFilter] = useState<TimeFilterKey>("all");
  const toast = useSearchToast();
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useFocusTrap(open);

  const ws = getActiveWorkspace();
  const cwd = ws?.root;
  const scopeAll = scope === "all";
  const workspaceName = ws ? (ws.alias || deriveWorkspaceName(ws.root)) : undefined;

  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
    if (!cwd || !ws) return;
    setIndexing(true);
    /* 作用域只是喂索引的 cwd 集合(定稿):本区单元素;全部 = getWorkspaces 快照。 */
    const cwds = scopeAll
      ? getWorkspaces().map((w) => ({ root: w.root, id: w.id }))
      : [{ root: cwd, id: ws.id }];
    const indexer = new SessionIndexer(cwds);
    setIndex(indexer.index);
    /* effect cleanup = 切作用域/关浮层即中止扫描;缓存命名空间留存,再开秒出。 */
    return startIndexerTicks(indexer, setIndex, () => setIndexing(false));
  }, [open, cwd, scope]); /* eslint-disable-line react-hooks/exhaustive-deps -- ws/scopeAll 由 cwd/scope 派生 */

  const timeRange = useMemo(() => timeRangeFor(timeFilter, Date.now()), [timeFilter]);
  const rawHits = useMemo(
    () => (index ? searchSessions(index, query, 50, timeRange) : []),
    [index, query, timeRange],
  );
  /* 过滤 chip 的引擎集合来自时间窗过滤后的结果;选中的引擎不在集合时视为清空(查询已变)。 */
  const engines = useMemo(
    () => Array.from(new Set(rawHits.map((h) => h.entry.profileId))),
    [rawHits],
  );
  const hits = useMemo(() => applyFilters(rawHits, engineFilter), [rawHits, engineFilter]);
  /* 引擎 chip 悬空收口:查询/时间窗变更使所选引擎掉出结果集时复位(null);
     扫描进行中结果集不全,不收口(避免把尚未出现的合法选中提前清掉)。 */
  useEffect(() => {
    if (!indexing && engineFilterDangling(engineFilter, engines)) setEngineFilter(null);
  }, [engines, engineFilter, indexing]);
  /* 越界收口(命中集随索引推进/过滤变化);选中行滚入视野(QuickOpen 惯例)。 */
  const sel = Math.min(active, Math.max(hits.length - 1, 0));
  useEffect(() => {
    listRef.current
      ?.querySelector('[data-sel="true"]')
      ?.scrollIntoView({ block: "nearest" });
  }, [sel]);

  const openHit = (hit: SessionSearchHit, sub?: SessionSubHit) => {
    /* 失效区(root 复核失败):不可跳——开出的会话 workspaceId 空、侧栏永不可见,
       比不跳更坑(定稿否决「cwd 在就跳」);点击仅提示。 */
    if (index?.goneCwds.includes(hit.entry.cwd)) {
      showSearchToast(t("工作区已移走,无法跳转"));
      return;
    }
    closeSessionSearch();
    host.events.emit(KernelTopics.sessionViewRequested, null); /* 用户手势,摘最大化 */
    /* 先切后跳(定稿):miss/opened 降级时用户必须已身处目标区(侧栏/面包屑就位)。
       8s 定位超时 → miss toast 不回滚切换(单向手势);openDiskSession reject 同理,
       区已切到位可手动重试。 */
    const workspaces = getWorkspaces();
    const targetWs =
      workspaces.find((w) => w.id === hit.entry.workspaceId) ??
      workspaces.find((w) => w.root === hit.entry.cwd);
    if (targetWs && targetWs.id !== getActiveWorkspace()?.id) setActiveWorkspace(targetWs.id);
    const locate = locateTargetOf(hit, sub);
    if (!locate) {
      /* 标题命中无消息原文,无可定位行:维持纯打开语义(不猜不定位)。 */
      void host
        .openDiskSession(hit.entry.profileId, hit.entry.cwd, hit.entry.workspaceId, hit.entry.cliSessionId)
        .catch(() => showSearchToast(t("未定位到命中行"))); /* 区已切,提示后可手动重试 */
      return;
    }
    void openThenJumpToText(locate.target, locate.text).then((r) => {
      /* jumped = 已定位到行,不扰;jumped 以外都说明行没定位上,轻提示告知。 */
      if (r === "opened") showSearchToast(t("已打开会话(未定位到命中行)"));
      else if (r === "miss") showSearchToast(t("未定位到命中行"));
    });
  };

  return createPortal(
    <>
      {/* 全屏容器(z-1201)统一收 Esc 与遮罩点击(自靶判定):容器自身即覆盖
          全屏,独立捕获层会被其整体遮蔽成死代码,故不设。 */}
      {open && cwd && (
      <div
        role="presentation"
        className="fixed inset-0 z-[1201] flex items-start justify-center bg-black/45 pt-[12vh]"
        data-icon-decor="search"
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
                if (hit) openHit(hit);
              }
            }}
            placeholder={scopeAll ? t("搜索全部工作区的会话历史(你输入过的内容)…") : t("搜索本工作区的会话历史(你输入过的内容)…")}
            aria-label={t("会话历史搜索")}
            className="w-full bg-transparent text-sm text-(--tmd-fg) outline-none placeholder:text-(--tmd-fg-faint)"
          />
          {indexing && <IndexingChip index={index} />}
        </div>
        <FilterChips
          scope={scope}
          onScope={(s) => {
            setScope(s);
            setActive(0);
            setEngineFilter(null); /* 结果集全换,引擎 chip 重建(不在集合恒等回落) */
          }}
          workspaceCount={getWorkspaces().length}
          timeFilter={timeFilter}
          onTimeFilter={setTimeFilter}
          engines={engines}
          engineFilter={engineFilter}
          onEngineFilter={setEngineFilter}
        />
        <div ref={listRef} className="min-h-0 flex-1 overflow-auto">
          <ResultBody
            queryEmpty={query.trim() === ""}
            indexing={indexing}
            index={index}
            hits={hits}
            active={sel}
            onOpen={openHit}
            onOpenSub={(hit, sub) => openHit(hit, sub)}
            scopeAll={scopeAll}
            goneCwds={index?.goneCwds}
            workspaceNameOf={(id) => {
              const w = id ? getWorkspaces().find((x) => x.id === id) : undefined;
              return w ? w.alias || deriveWorkspaceName(w.root) : undefined;
            }}
          />
        </div>
        <div className="flex items-center gap-3 border-t border-(--tmd-border) px-3 py-1.5 text-xs text-(--tmd-fg-faint)">
          <span>
            {t("↑↓ 选择 · Enter 打开 {name} 的历史会话 · Esc 关闭", { name: scopeAll ? t("全部工作区") : workspaceName ?? "" })}
          </span>
          {/* 全部态扫描进度「N/M 个工作区」:行内进度,不弹窗不遮输入(示例页契约)。 */}
          {indexing && index && index.workspacesTotal > 1 && (
            <span className="text-(--tmd-accent)">
              {t("正在扫描 {n}/{total} 个工作区", { n: index.scannedWorkspaces, total: index.workspacesTotal })}
            </span>
          )}
        </div>
        </div>
      </div>
      )}
      {/* 定位轻提示:浮层关闭后仍要呈现(openThenJumpToText 异步回调),常驻 portal 承载。 */}
      {toast && (
        <div className="pointer-events-none fixed inset-x-0 bottom-6 z-[1201] flex justify-center">
          <div className="rounded-lg border border-(--tmd-border) bg-(--tmd-bg-panel) px-3 py-1.5 text-xs text-(--tmd-fg) shadow-(--tmd-shadow-modal)">
            {toast}
          </div>
        </div>
      )}
    </>,
    document.body,
  );
}
