/**
 * 右栏 Memory 面板 —— 池状态 / 检索 / 过滤 / 只读列表。
 *
 * Phase 1 只读:移除与治理操作随 Phase 2 经 d 路(omp 代写 ctx_memory)接入。
 * 检索:FTS5 关键词(memories_fts MATCH);语义向量检索随 Phase 2 评估。
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronDown, Search } from "lucide-react";
import { useWorkspaces } from "@kernel/workspace";
import { CATEGORY_CN, type MemoryItem } from "../protocol";
import { toggleConsoleTab } from "../console/MemoryConsole";
import { useEditorTabs } from "@kernel/tabs";
import { archiveMemory, mergeMemories } from "../phase2/write";
import { getSettingsState } from "@kernel/settings";
import { memoryPool, resolveProjectIdentity } from "../pool";

/** 命中词高亮:按当前查询拆段包 <mark>(大小写不敏感,首处起全部命中)。 */
function highlight(text: string, query: string): React.ReactNode {
  const q = query.trim();
  if (!q) return text;
  const lower = text.toLowerCase();
  const ql = q.toLowerCase();
  const parts: React.ReactNode[] = [];
  let i = 0;
  let n = 0;
  while (i < text.length) {
    const hit = lower.indexOf(ql, i);
    if (hit < 0 || n > 50) {
      parts.push(text.slice(i));
      break;
    }
    if (hit > i) parts.push(text.slice(i, hit));
    parts.push(<mark key={hit} className="rounded-sm bg-(--tmd-accent-soft) px-px">{text.slice(hit, hit + q.length)}</mark>);
    i = hit + q.length;
    n += 1;
  }
  return parts;
}

function categoryLabel(key: string): string {
  return (CATEGORY_CN as Record<string, string>)[key] ?? key;
}

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
  const [merging, setMerging] = useState(false);
  const [mergeNote, setMergeNote] = useState<string | null>(null);
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

      <div className="mb-1.5 flex min-w-0 flex-wrap items-center gap-1.5 px-1">
        <button
          className={`rounded-md border px-2 py-0.5 text-[10.5px] ${
            selectMode ? "border-(--tmd-accent) bg-(--tmd-accent-soft) text-(--tmd-fg)" : "border-(--tmd-border) text-(--tmd-fg-muted)"
          } hover:bg-(--tmd-bg-hover)`}
          onClick={() => {
            setSelectMode(!selectMode);
            setSelected(new Set());
          }}
        >
          {selectMode ? "退出选择" : "选择"}
        </button>
        {selectMode && (
          <>
            <button
              className="flex-none rounded-md border border-(--tmd-accent) bg-(--tmd-accent) px-2 py-0.5 text-[10.5px] text-(--tmd-accent-fg) disabled:opacity-45"
              disabled={selected.size < 2 || merging || !root}
              title="合并所选为一条(content 取首条表述,经 omp 官方管线 merge)"
              onClick={() => {
                const chosen = filtered.filter((m) => selected.has(m.id));
                if (chosen.length < 2 || !root) return;
                setMerging(true);
                setMergeNote("合并中…(经 omp 官方管线,可能需数十秒)");
                const ids = chosen.map((m) => m.id);
                void mergeMemories(ids, chosen[0].content, root, {
                  engine: getSettingsState().settings.memoryDistillEngine,
                  model: getSettingsState().settings.memoryDistillModel || undefined,
                }).then(async (out) => {
                  setMerging(false);
                  if (!out.ok) {
                    setMergeNote(`失败: ${out.detail || "代写引擎无响应"}`);
                    return;
                  }
                  await reload();
                  const still = (await memoryPool.recall((await resolveProjectIdentity(root)) ?? "", undefined, 200))
                    .filter((m) => ids.includes(m.id));
                  if (still.length > 0) {
                    setMergeNote(`引擎回复成功但 ${still.length} 条仍在(模型可能未执行合并):${out.detail.slice(0, 80)}`);
                  } else {
                    setMergeNote("已合并");
                    setSelected(new Set());
                    setSelectMode(false);
                  }
                });
              }}
            >
              {merging ? "合并中…" : `合并所选(${selected.size})`}
            </button>
          </>
        )}
      </div>
      {selectMode && (
        <div className="mb-1.5 px-1 text-[10px] text-(--tmd-fg-faint)">
          {mergeNote ?? "选 2 条以上重复记忆折叠为一条"}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto px-1">
        {loading ? (
          <div className="p-3 text-center text-[11px] text-(--tmd-fg-faint)">读取中…</div>
        ) : filtered.length === 0 ? (
          <div className="p-3 text-center text-[11px] text-(--tmd-fg-faint)">
            {count === 0 ? "当前工作区还没有记忆" : "无匹配"}
          </div>
        ) : (
          filtered.map((m) => (
            <div
              key={m.id}
              className={`group relative rounded-md px-2 py-1.5 hover:bg-(--tmd-bg-hover) ${
                selected.has(m.id) ? "bg-(--tmd-accent-soft)" : ""
              } ${selectMode ? "cursor-pointer" : ""}`}
              onClick={() => {
                if (selectMode) {
                  selected.has(m.id) ? selected.delete(m.id) : selected.add(m.id);
                  setSelected(new Set(selected));
                  return;
                }
                setExpandedId(expandedId === m.id ? null : m.id);
              }}
            >
              <div className="truncate text-[11px] leading-[1.5] text-(--tmd-fg)" title={m.content}>{highlight(m.content, query)}</div>
              <div className="mt-0.5 flex gap-1.5 text-[10.5px] text-(--tmd-fg-faint)">
                <span>{categoryLabel(m.category)}</span>
                <span>·</span>
                <span>{m.harness || "pi"}</span>
                <span>·</span>
                <span>{new Date(m.updatedAt).toLocaleDateString("zh-CN")}</span>
                <ChevronDown
                  size={11}
                  className={`ml-auto transition-transform ${expandedId === m.id ? "rotate-180" : ""}`}
                />
              </div>
              {expandedId === m.id && (
                <div className="mt-1.5 flex flex-col gap-1 rounded-md border border-(--tmd-border) bg-(--tmd-bg-base) p-2 text-[10.5px] leading-relaxed">
                  <div className="whitespace-pre-wrap break-words text-(--tmd-fg)">{m.content}</div>
                  <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-(--tmd-fg-faint)">
                    <span title={m.category}>类目:{categoryLabel(m.category)}({m.category})</span>
                    <span>来源:{m.harness || "pi"}</span>
                    <span>状态:{m.status}</span>
                    <span>重要度:{m.importance ?? "—"}</span>
                    <span>ID:{m.id}</span>
                    <span>创建:{new Date(m.createdAt).toLocaleString("zh-CN")}</span>
                    <span>更新:{new Date(m.updatedAt).toLocaleString("zh-CN")}</span>
                  </div>
                </div>
              )}
              <button
                className={`absolute right-1.5 top-1.5 hidden rounded px-1.5 text-[10px] group-hover:block ${
                  archivingId === m.id ? "text-(--tmd-fg-faint)" : "text-(--tmd-fg-muted) hover:text-(--tmd-err)"
                }`}
                disabled={archivingId === m.id}
                onClick={() => void removeItem(m.id)}
                title="移除(经 omp 官方管线归档,可恢复)"
              >
                {archivingId === m.id ? "归档中…" : "移除"}
              </button>
            </div>
          ))
        )}
      </div>

      <div className="flex min-w-0 flex-none items-center gap-2 border-t border-(--tmd-border) px-2 py-1.5">
        <button
          className="flex-none rounded-md border border-(--tmd-border) px-2 py-0.5 text-[10.5px] text-(--tmd-fg-muted) hover:bg-(--tmd-bg-hover) hover:text-(--tmd-fg)"
          onClick={toggleConsoleTab}
          title="打开/关闭中央编辑区的 Memory 控制台"
        >
          {consoleOpen ? "关闭控制台" : "控制台"}
        </button>
        <button
          className="flex-none rounded-md border border-(--tmd-border) px-2 py-0.5 text-[10.5px] text-(--tmd-fg-muted) hover:bg-(--tmd-bg-hover) hover:text-(--tmd-fg)"
          onClick={() => {
            setDiagRunning(true);
            memoryPool
              .status()
              .then((st) => {
                setDiag([st.ready ? "✓ 共享数据库可读" : "✗ 共享数据库不可读(迁移窗口)", `✓ 检测完成 · ${st.count} 条生效记忆`]);
              })
              .finally(() => setDiagRunning(false));
          }}
          disabled={diagRunning}
        >
          {diagRunning ? "诊断中…" : "诊断"}
        </button>
        {diag.length === 0 ? (
          <span className="min-w-0 flex-1 truncate text-[10.5px] text-(--tmd-fg-faint)" title="上游未暴露 CLI 触发;omp 会话内可用">
            上游治理(/ctx-dream · /ctx-aug)在 omp 会话内执行;写入与移除经 omp 官方管线
          </span>
        ) : (
          <span className="min-w-0 flex-1 truncate text-[10.5px] text-(--tmd-fg-subtle)" title={diag.join("\n")}>
            {diag[diag.length - 1]}
          </span>
        )}
      </div>
    </div>
  );
}
