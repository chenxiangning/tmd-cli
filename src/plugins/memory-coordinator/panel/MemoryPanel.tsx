/**
 * 右栏 Memory 面板 —— 池状态 / 检索 / 过滤 / 只读列表。
 *
 * Phase 1 只读:移除与治理操作随 Phase 2 经 d 路(omp 代写 ctx_memory)接入。
 * 检索:FTS5 关键词(memories_fts MATCH);语义向量检索随 Phase 2 评估。
 * 列表行与底部工具条拆至 MemoryPanelParts.tsx,合并所选逻辑拆至
 * useMemoryMerge.ts,头部摘要与过滤 chips 拆至 MemoryPanelFilters.tsx
 * (文件规模铁则 + no-high-complexity 降分支)。
 */

import { useEffect, useMemo } from "react";
import { MagnifyingGlass } from "@phosphor-icons/react";
import { useWorkspaces } from "@kernel/workspace";
import { type MemoryItem } from "../protocol";
import { useEditorTabs } from "@kernel/tabs";
import { t } from "@kernel/i18n";
import {
  MemoryListItem,
  MemoryPanelFooter,
  MemorySelectBar,
  useMemoryDiag,
} from "./MemoryPanelParts";
import { MemoryFilterChips, MemoryHead } from "./MemoryPanelFilters";
import { useMemoryMerge } from "./useMemoryMerge";
import { useMemoryPanelState } from "./useMemoryPanelState";

/** 检索谓词(FTS 关键词 + 类目 + 来源三重过滤;模块级纯函数,降组件分支)。 */
function matchesFilter(m: MemoryItem, kind: string, source: string, q: string): boolean {
  return (
    (kind === "all" || m.category === kind) &&
    (source === "all" || (m.harness || "pi") === source) &&
    (!q || m.content.toLowerCase().includes(q) || m.category.toLowerCase().includes(q))
  );
}

/** 池不可用态:提前返回也必须带底部工具条(控制台入口与诊断按钮只在这里)。 */
function PoolUnavailableView({
  identity,
  poolReason,
  children,
}: {
  identity: string | null;
  poolReason: "not-installed" | "locked" | null;
  children: React.ReactNode;
}) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="p-3">
        <div className="rounded-md border border-(--tmd-border) bg-(--tmd-bg-elevated) p-2.5 text-[0.6875rem] leading-relaxed text-(--tmd-fg-muted)">
          <span className="text-(--tmd-err)">{t("池不可用")}</span>
          {identity === null
            ? t(" —— 当前工作区不是 git 仓库,未纳入记忆池。")
            : poolReason === "locked"
              ? t(" —— 共享 SQLite 暂时读不到(可能处于迁移窗口:关闭全部 omp/pi 会话后重开即可)。")
              : t(" —— Magic Context 共享库尚未初始化(未安装或未迁移),点下方「控制台」完成安装/迁移。")}
          <div className="mt-1 text-(--tmd-fg-faint)">{t("会话 / 对话框 / 审批线不受影响。")}</div>
        </div>
      </div>
      <div className="min-h-0 flex-1" />
      {children}
    </div>
  );
}

export function MemoryPanel() {
  const editorTabs = useEditorTabs();
  const consoleOpen = editorTabs.tabs.some((t) => t.id === "memory-console" && t.id === editorTabs.activeId);
  const workspaces = useWorkspaces();
  const root = workspaces.list.find((w) => w.id === workspaces.activeId)?.root ?? "";
  const { state, patch, reload, removeItem } = useMemoryPanelState(root);
  const {
    identity, ready, poolReason, count, items, query, kind, source,
    loading, detailOpen, expandedId, selectMode, selected, dbPath, archivingId,
  } = state;
  const setQuery = (v: string) => patch({ query: v });
  const setKind = (v: string) => patch({ kind: v });
  const setSource = (v: string) => patch({ source: v });
  const setDetailOpen = (v: boolean) => patch({ detailOpen: v });
  const setExpandedId = (v: number | null) => patch({ expandedId: v });
  const setSelectMode = (v: boolean) => patch({ selectMode: v });
  const setSelected = (v: Set<number>) => patch({ selected: v });

  const { diag, diagRunning, runDiag } = useMemoryDiag();

  const q = query.trim().toLowerCase();
  const filtered = useMemo(
    () => items.filter((m) => matchesFilter(m, kind, source, q)),
    [items, kind, source, q],
  );

  const { merging, mergeNote, startMerge } = useMemoryMerge({
    root,
    filtered,
    selected,
    reload,
    setSelected,
    setSelectMode,
  });

  useEffect(() => {
    void reload();
  }, [reload]);

  /* 两分支共用的底部工具条(duplicate-jsx 消重):元素对象可安全复用,
     同一轮渲染只会落进其中一个返回分支。 */
  const footer = (
    <MemoryPanelFooter
      consoleOpen={consoleOpen}
      diag={diag}
      diagRunning={diagRunning}
      onDiag={runDiag}
    />
  );
  if (!root) {
    return <div className="placeholder p-4 text-center text-[0.6875rem] text-(--tmd-fg-faint)">{t("未选择工作区")}</div>;
  }

  if (ready === false) {
    /* 2026-09-06 win 新装机实证:池不可用时入口整条消失,用户既打不开控制台也无法排障。 */
    return (
      <PoolUnavailableView identity={identity} poolReason={poolReason}>
        {footer}
      </PoolUnavailableView>
    );
  }
  return (
    <div className="flex h-full min-h-0 flex-col">
      <MemoryHead
        detailOpen={detailOpen}
        onToggle={() => setDetailOpen(!detailOpen)}
        identity={identity}
        dbPath={dbPath}
        count={count}
        items={items}
      />

      <div className="flex gap-1.5 px-1 pb-1.5">
        <div className="relative flex-1">
          <MagnifyingGlass size="0.75rem" className="absolute left-2 top-1.5 text-(--tmd-fg-faint)" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("关键词检索(FTS)…")}
            className="h-[26px] w-full rounded-md border border-(--tmd-border) bg-(--tmd-bg-input) pl-7 pr-2 text-[0.6875rem] text-(--tmd-fg) outline-none placeholder:text-(--tmd-fg-faint) focus:border-(--tmd-accent)"
          />
        </div>
      </div>

      <MemoryFilterChips
        items={items}
        source={source}
        onSource={setSource}
        kind={kind}
        onKind={setKind}
      />

      {diag.length > 0 && (
        <div className="mb-1.5 flex flex-col gap-0.5 px-1">
          {diag.map((line) => (
            <span key={line} className="truncate text-[0.65625rem] text-(--tmd-fg-subtle)">
              {line}
            </span>
          ))}
        </div>
      )}

      <MemorySelectBar
        selectMode={selectMode}
        selectedSize={selected.size}
        merging={merging}
        mergeNote={mergeNote}
        mergeDisabled={selected.size < 2 || merging || !root}
        onToggleSelectMode={() => {
          setSelectMode(!selectMode);
          setSelected(new Set());
        }}
        onMerge={startMerge}
      />

      <div className="min-h-0 flex-1 overflow-y-auto px-1">
        {loading ? (
          <div className="p-3 text-center text-[0.6875rem] text-(--tmd-fg-faint)">{t("读取中…")}</div>
        ) : filtered.length === 0 ? (
          <div className="p-3 text-center text-[0.6875rem] text-(--tmd-fg-faint)">
            {count === 0 ? t("当前工作区还没有记忆") : t("无匹配")}
          </div>
        ) : (
          filtered.map((m) => (
            <MemoryListItem
              key={m.id}
              m={m}
              query={query}
              selectMode={selectMode}
              selected={selected.has(m.id)}
              expanded={expandedId === m.id}
              archiving={archivingId === m.id}
              onSelect={() => {
                selected.has(m.id) ? selected.delete(m.id) : selected.add(m.id);
                setSelected(new Set(selected));
              }}
              onExpand={() => setExpandedId(expandedId === m.id ? null : m.id)}
              onRemove={() => void removeItem(m.id)}
            />
          ))
        )}
      </div>

      {footer}
    </div>
  );
}
