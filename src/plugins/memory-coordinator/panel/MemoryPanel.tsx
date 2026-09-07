/**
 * 右栏 Memory 面板 —— 池状态 / 检索 / 过滤 / 只读列表。
 *
 * Phase 1 只读:移除与治理操作随 Phase 2 经 d 路(omp 代写 ctx_memory)接入。
 * 检索:FTS5 关键词(memories_fts MATCH);语义向量检索随 Phase 2 评估。
 * 列表行与底部工具条拆至 MemoryPanelParts.tsx,合并所选逻辑拆至
 * useMemoryMerge.ts(文件规模铁则)。
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { CaretDown, MagnifyingGlass } from "@phosphor-icons/react";
import { useWorkspaces } from "@kernel/workspace";
import { type MemoryItem } from "../protocol";
import { useEditorTabs } from "@kernel/tabs";
import { t } from "@kernel/i18n";
import { archiveMemory } from "../phase2/write";
import { memoryPool, resolveProjectIdentity } from "../pool";
import {
  categoryLabel,
  MemoryListItem,
  MemoryPanelFooter,
  MemorySelectBar,
  useMemoryDiag,
} from "./MemoryPanelParts";
import { useMemoryMerge } from "./useMemoryMerge";

export function MemoryPanel() {
  const editorTabs = useEditorTabs();
  const consoleOpen = editorTabs.tabs.some((t) => t.id === "memory-console" && t.id === editorTabs.activeId);
  const workspaces = useWorkspaces();
  const root = workspaces.list.find((w) => w.id === workspaces.activeId)?.root ?? "";
  const [identity, setIdentity] = useState<string | null>(null);
  const [ready, setReady] = useState<boolean | null>(null);
  const [poolReason, setPoolReason] = useState<"not-installed" | "locked" | null>(null);
  const [count, setCount] = useState(0);
  const [items, setItems] = useState<MemoryItem[]>([]);
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<string>("all");
  const [source, setSource] = useState<string>("all");
  const { diag, diagRunning, runDiag } = useMemoryDiag();
  const [loading, setLoading] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [dbPath, setDbPath] = useState<string | null>(null);
  const [archivingId, setArchivingId] = useState<number | null>(null);

  const removeItem = async (id: number) => {
    if (!root) return;
    setArchivingId(id);
    const out = await archiveMemory(id, root);
    setArchivingId(null);
    if (out.ok) setItems((list) => list.filter((m) => m.id !== id));
  };

  const reload = useCallback(async () => {
    if (!root) return;
    const id = await resolveProjectIdentity(root);
    setIdentity(id);
    if (!id) {
      setReady(false);
      setPoolReason(null);
      return;
    }
    const st = await memoryPool.status();
    setReady(st.ready);
    setPoolReason(st.reason ?? null);
    setCount(st.count);
    setDbPath(st.dbPath);
    if (!st.ready) return;
    setLoading(true);
    const list = await memoryPool.recall(id, undefined, 200);
    setItems(list);
    setLoading(false);
  }, [root]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const q = query.trim().toLowerCase();
  const filtered = useMemo(
    () =>
      items.filter(
        (m) =>
          (kind === "all" || m.category === kind) &&
          (source === "all" || (m.harness || "pi") === source) &&
          (!q || m.content.toLowerCase().includes(q) || m.category.toLowerCase().includes(q)),
      ),
    [items, kind, source, q],
  );

  const presentKinds = useMemo(() => {
    const byCat = new Map<string, number>();
    for (const m of items) byCat.set(m.category, (byCat.get(m.category) ?? 0) + 1);
    return [...byCat.entries()].sort((a, b) => b[1] - a[1]);
  }, [items]);

  const presentSources = useMemo(() => {
    const bySrc = new Map<string, number>();
    for (const m of items) {
      const k = m.harness || "pi";
      bySrc.set(k, (bySrc.get(k) ?? 0) + 1);
    }
    return [...bySrc.entries()].sort((a, b) => b[1] - a[1]);
  }, [items]);

  const { merging, mergeNote, startMerge } = useMemoryMerge({
    root,
    filtered,
    selected,
    reload,
    setSelected,
    setSelectMode,
  });

  if (!root) {
    return <div className="placeholder p-4 text-center text-[11px] text-(--tmd-fg-faint)">{t("未选择工作区")}</div>;
  }

  if (ready === false) {
    /* 提前返回也必须带底部工具条:控制台入口与诊断按钮只在这里,
    否则池不可用时入口整条消失,用户既打不开控制台也无法排障
    (2026-09-06 win 新装机实证)。 */
    return (
      <div className="flex h-full min-h-0 flex-col">
        <div className="p-3">
          <div className="rounded-md border border-(--tmd-border) bg-(--tmd-bg-elevated) p-2.5 text-[11px] leading-relaxed text-(--tmd-fg-muted)">
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
        <MemoryPanelFooter consoleOpen={consoleOpen} diag={diag} diagRunning={diagRunning} onDiag={runDiag} />
      </div>
    );
  }
  return (
    <div className="flex h-full min-h-0 flex-col">
      <button
        className="mb-2 flex w-full items-center gap-2 px-1 pt-1 text-left"
        onClick={() => setDetailOpen(!detailOpen)}
      >
        <span className="h-2 w-2 flex-none rounded-full bg-(--tmd-ok)" />
        <span className="text-[11px] text-(--tmd-fg-muted)">{t("池就绪")}</span>
        <span className="ml-auto text-[11px] font-semibold">{t("{count} 条", { count })}</span>
        <CaretDown size={11} className={detailOpen ? "rotate-180 transition-transform" : "transition-transform"} />
      </button>
      {detailOpen && (
        <div className="mb-2 flex flex-col gap-0.5 rounded-md border border-(--tmd-border) bg-(--tmd-bg-elevated) p-2 font-mono text-[10px] text-(--tmd-fg-muted)">
          <div className="truncate" title={dbPath ?? t("未解析")}>{t("库:{path}", { path: dbPath ?? t("未解析") })}</div>
          <div className="truncate" title={identity ?? t("非 git 工作区")}>{t("身份:{id}", { id: identity ?? t("非 git 工作区") })}</div>
          <div>{t("生效记忆:{count} 条 · 覆盖类目:{kinds} 类", { count, kinds: presentKinds.length })}</div>
          <div className="truncate text-(--tmd-fg-faint)">
            {t("提示:记忆由 omp/pi 会话沉淀(原生注入),其余引擎经胶囊读取;写入与治理见控制台。")}
          </div>
        </div>
      )}

      <div className="flex gap-1.5 px-1 pb-1.5">
        <div className="relative flex-1">
          <MagnifyingGlass size={12} className="absolute left-2 top-1.5 text-(--tmd-fg-faint)" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("关键词检索(FTS)…")}
            className="h-[26px] w-full rounded-md border border-(--tmd-border) bg-(--tmd-bg-input) pl-7 pr-2 text-[11px] text-(--tmd-fg) outline-none placeholder:text-(--tmd-fg-faint) focus:border-(--tmd-accent)"
          />
        </div>
      </div>

      {presentSources.length > 1 && (
        <div className="mb-1.5 flex flex-wrap gap-1 px-1">
          <button
            className={`h-5 rounded-full border px-2 text-[10.5px] ${
              source === "all"
                ? "border-(--tmd-accent) bg-(--tmd-bg-active) text-(--tmd-fg)"
                : "border-(--tmd-border) text-(--tmd-fg-subtle)"
            }`}
            onClick={() => setSource("all")}
          >
            {t("全部来源")}
          </button>
          {presentSources.map(([srcName, n]) => (
            <button
              key={srcName}
              className={`h-5 rounded-full border px-2 text-[10.5px] ${
                source === srcName
                  ? "border-(--tmd-accent) bg-(--tmd-bg-active) text-(--tmd-fg)"
                  : "border-(--tmd-border) text-(--tmd-fg-subtle)"
              }`}
              onClick={() => setSource(srcName)}
            >
              {srcName} {n}
            </button>
          ))}
        </div>
      )}

      {presentKinds.length > 0 && (
        <div className="mb-1.5 flex flex-wrap gap-1 px-1">
          <button
            className={`h-5 rounded-full border px-2 text-[10.5px] ${
              kind === "all"
                ? "border-(--tmd-accent) bg-(--tmd-bg-active) text-(--tmd-fg)"
                : "border-(--tmd-border) text-(--tmd-fg-subtle)"
            }`}
            onClick={() => setKind("all")}
          >
            {t("全部 {n}", { n: items.length })}
          </button>
          {presentKinds.map(([key, n]) => (
            <button
              key={key}
              className={`h-5 rounded-full border px-2 text-[10.5px] ${
                kind === key
                  ? "border-(--tmd-accent) bg-(--tmd-bg-active) text-(--tmd-fg)"
                  : "border-(--tmd-border) text-(--tmd-fg-subtle)"
              }`}
              onClick={() => setKind(kind === key ? "all" : key)}
            >
              {categoryLabel(key)} {n}
            </button>
          ))}
        </div>
      )}

      {diag.length > 0 && (
        <div className="mb-1.5 flex flex-col gap-0.5 px-1">
          {diag.map((line) => (
            <span key={line} className="truncate text-[10.5px] text-(--tmd-fg-subtle)">
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
          <div className="p-3 text-center text-[11px] text-(--tmd-fg-faint)">{t("读取中…")}</div>
        ) : filtered.length === 0 ? (
          <div className="p-3 text-center text-[11px] text-(--tmd-fg-faint)">
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

      <MemoryPanelFooter
        consoleOpen={consoleOpen}
        diag={diag}
        diagRunning={diagRunning}
        onDiag={runDiag}
      />
    </div>
  );
}
