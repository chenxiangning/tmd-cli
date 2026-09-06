/**
 * 右栏 Memory 面板 —— 池状态 / 检索 / 过滤 / 只读列表。
 *
 * Phase 1 只读:移除与治理操作随 Phase 2 经 d 路(omp 代写 ctx_memory)接入。
 * 检索:FTS5 关键词(memories_fts MATCH);语义向量检索随 Phase 2 评估。
 * 列表行与底部工具条拆至 MemoryPanelParts.tsx,合并所选逻辑拆至
 * useMemoryMerge.ts(文件规模铁则)。
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronDown, Search } from "lucide-react";
import { useWorkspaces } from "@kernel/workspace";
import { type MemoryItem } from "../protocol";
import { useEditorTabs } from "@kernel/tabs";
import { archiveMemory } from "../phase2/write";
import { memoryPool, resolveProjectIdentity } from "../pool";
import {
  categoryLabel,
  MemoryListItem,
  MemoryPanelFooter,
  MemorySelectBar,
} from "./MemoryPanelParts";
import { useMemoryMerge } from "./useMemoryMerge";

export function MemoryPanel() {
  const editorTabs = useEditorTabs();
  const consoleOpen = editorTabs.tabs.some((t) => t.id === "memory-console" && t.id === editorTabs.activeId);
  const workspaces = useWorkspaces();
  const root = workspaces.list.find((w) => w.id === workspaces.activeId)?.root ?? "";
  const [identity, setIdentity] = useState<string | null>(null);
  const [ready, setReady] = useState<boolean | null>(null);
  const [count, setCount] = useState(0);
  const [items, setItems] = useState<MemoryItem[]>([]);
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<string>("all");
  const [source, setSource] = useState<string>("all");
  const [loading, setLoading] = useState(false);
  const [diag, setDiag] = useState<string[]>([]);
  const [detailOpen, setDetailOpen] = useState(false);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [dbPath, setDbPath] = useState<string | null>(null);
  const [diagRunning, setDiagRunning] = useState(false);
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
      return;
    }
    const st = await memoryPool.status();
    setReady(st.ready);
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
    return <div className="placeholder p-4 text-center text-[11px] text-(--tmd-fg-faint)">未选择工作区</div>;
  }

  if (ready === false) {
    return (
      <div className="p-3">
        <div className="rounded-md border border-(--tmd-border) bg-(--tmd-bg-elevated) p-2.5 text-[11px] leading-relaxed text-(--tmd-fg-muted)">
          <span className="text-(--tmd-err)">池不可用</span>
          {identity === null
            ? " —— 当前工作区不是 git 仓库,未纳入记忆池。"
            : " —— 共享 SQLite 暂时读不到(可能处于迁移窗口)。"}
          <div className="mt-1 text-(--tmd-fg-faint)">会话 / 对话框 / 审批线不受影响。</div>
        </div>
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
        <span className="text-[11px] text-(--tmd-fg-muted)">池就绪</span>
        <span className="ml-auto text-[11px] font-semibold">{count} 条</span>
        <ChevronDown size={11} className={detailOpen ? "rotate-180 transition-transform" : "transition-transform"} />
      </button>
      {detailOpen && (
        <div className="mb-2 flex flex-col gap-0.5 rounded-md border border-(--tmd-border) bg-(--tmd-bg-elevated) p-2 font-mono text-[10px] text-(--tmd-fg-muted)">
          <div className="truncate" title={dbPath ?? "未解析"}>库:{dbPath ?? "未解析"}</div>
          <div className="truncate" title={identity ?? "非 git 工作区"}>身份:{identity ?? "非 git 工作区"}</div>
          <div>生效记忆:{count} 条 · 覆盖类目:{presentKinds.length} 类</div>
          <div className="truncate text-(--tmd-fg-faint)">
            提示:记忆由 omp/pi 会话沉淀(原生注入),其余引擎经胶囊读取;写入与治理见控制台。
          </div>
        </div>
      )}

      <div className="flex gap-1.5 px-1 pb-1.5">
        <div className="relative flex-1">
          <Search size={12} className="absolute left-2 top-1.5 text-(--tmd-fg-faint)" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="关键词检索(FTS)…"
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
            全部来源
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
            全部 {items.length}
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
          <div className="p-3 text-center text-[11px] text-(--tmd-fg-faint)">读取中…</div>
        ) : filtered.length === 0 ? (
          <div className="p-3 text-center text-[11px] text-(--tmd-fg-faint)">
            {count === 0 ? "当前工作区还没有记忆" : "无匹配"}
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
        onDiag={() => {
          setDiagRunning(true);
          memoryPool
            .status()
            .then((st) => {
              setDiag([st.ready ? "✓ 共享数据库可读" : "✗ 共享数据库不可读(迁移窗口)", `✓ 检测完成 · ${st.count} 条生效记忆`]);
            })
            .finally(() => setDiagRunning(false));
        }}
      />
    </div>
  );
}
