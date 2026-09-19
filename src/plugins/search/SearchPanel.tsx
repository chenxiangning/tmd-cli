/**
 * 全文搜索面板(⇧⌘F)—— yn 行为复刻:回车触发(无防抖)、结果按文件分组折叠、
 * 行预览全量高亮(行内全部出现,FE indexOf)、点击命中 openFileAtLine 跳转
 * 并关闭浮层(快开同款;再搜重开成本低于残留遮挡)。
 * Esc/遮罩关闭由 index.tsx 浮层壳统一处理。
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { CaretRight, MagnifyingGlass } from "@phosphor-icons/react";
import { ipc, type FsSearchHit } from "@kernel/ipc";
import { t } from "@kernel/i18n";
import { normalizePath } from "@kernel/pathUtils";
import { openFileAtLine } from "@kernel/fileTabs";
import { closeSearchOverlay, useActiveWorkspaceRoot } from "./overlayStore";

/** 全局命中上限(护栏在 fs_search.rs;命中即提示截断)。 */
const MAX_RESULTS = 2000;

/** 行文本按 query 全部出现切段(大小写跟随开关);纯前端 indexOf。 */
function splitHits(
  text: string,
  query: string,
  caseSensitive: boolean,
): { text: string; hit: boolean }[] {
  if (!query) return [{ text, hit: false }];
  /* ponytail: 大小写归一下切片用原 text,U+0130(İ)等 lower 变长字符会错位——
     CJK/常规拉丁不受影响,接受;极端场景需精确时改用 hay 切片。 */
  const hay = caseSensitive ? text : text.toLowerCase();
  const needle = caseSensitive ? query : query.toLowerCase();
  const parts: { text: string; hit: boolean }[] = [];
  let cursor = 0;
  for (;;) {
    const at = hay.indexOf(needle, cursor);
    if (at === -1) break;
    if (at > cursor) parts.push({ text: text.slice(cursor, at), hit: false });
    parts.push({ text: text.slice(at, at + query.length), hit: true });
    cursor = at + query.length;
  }
  if (cursor < text.length) parts.push({ text: text.slice(cursor), hit: false });
  return parts;
}

/** 命中按文件分组(保持首见顺序,行序即 walk 序自然递增)。 */
function groupByFile(hits: readonly FsSearchHit[]): Map<string, FsSearchHit[]> {
  const groups = new Map<string, FsSearchHit[]>();
  for (const hit of hits) {
    const arr = groups.get(hit.path);
    if (arr) arr.push(hit);
    else groups.set(hit.path, [hit]);
  }
  return groups;
}

export function SearchPanel() {
  const root = useActiveWorkspaceRoot();
  const [query, setQuery] = useState("");
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [results, setResults] = useState<FsSearchHit[] | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /* 展开集(命中 path);默认全折叠,新搜索重置 */
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const inputRef = useRef<HTMLInputElement>(null);
  /* 请求序守卫:大仓在途搜索(可至 3s 预算)期间输入清空后,旧 IPC 晚到
     resolve 不得把旧结果回填进新关键词态;新回车可顶替旧请求。 */
  const seqRef = useRef(0);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const groups = useMemo(() => [...groupByFile(results ?? []).entries()], [results]);

  /* 输入或大小写开关变化即清旧结果:旧命中行配新高亮/过期计数是误导(P3 评审项)。 */
  useEffect(() => {
    setResults(null);
    seqRef.current++;
  }, [query, caseSensitive]);

  async function runSearch(): Promise<void> {
    if (!root || !query.trim()) return;
    const seq = ++seqRef.current;
    setBusy(true);
    setError(null);
    try {
      const found = await ipc.fsSearch(root, query, caseSensitive, MAX_RESULTS);
      if (seqRef.current !== seq) return;
      setResults(found.hits);
      setTruncated(found.truncated);
      setExpanded(new Set());
    } catch (e) {
      if (seqRef.current !== seq) return;
      setError(String(e));
      setResults(null);
    } finally {
      /* 无条件复位:busy 只承担 spinner 展示;被新回车顶替的旧请求提前灭灯
         属可接受瞬时态(新请求 Enter 不受 busy 拦截)。 */
      setBusy(false);
    }
  }

  function toggleExpand(path: string): void {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }

  return (
    <div className="flex max-h-[70vh] w-[640px] max-w-full flex-col overflow-hidden rounded-(--tmd-radius-lg) border border-(--tmd-border) bg-(--tmd-bg-popover) shadow-2xl">
      <div className="flex items-center gap-2 border-b border-(--tmd-border) px-3 py-2">
        <MagnifyingGlass size="0.875rem" aria-hidden className="shrink-0 text-(--tmd-fg-subtle)" />
        <input
          ref={inputRef}
          value={query}
          spellCheck={false}
          disabled={!root}
          placeholder={root ? t("输入关键词,回车搜索") : t("无激活工作区")}
          aria-label={t("全文搜索")}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            /* IME 组合期 Enter 是选词确认,不触发搜索(同 composer enterAction 契约)。 */
            if (e.key === "Enter" && !e.nativeEvent.isComposing) void runSearch();
          }}
          className="min-w-0 flex-1 bg-transparent text-sm text-(--tmd-fg) outline-none placeholder:text-(--tmd-fg-faint)"
        />
        <button
          type="button"
          aria-pressed={caseSensitive}
          title={t("区分大小写")}
          onClick={() => setCaseSensitive((v) => !v)}
          className={`shrink-0 rounded-(--tmd-radius-sm) px-1.5 py-0.5 font-mono text-xs ${
            caseSensitive
              ? "bg-(--tmd-accent-soft) text-(--tmd-fg)"
              : "text-(--tmd-fg-subtle) hover:bg-(--tmd-bg-hover)"
          }`}
        >
          Aa
        </button>
      </div>

      <div className="min-h-[120px] flex-1 overflow-y-auto py-1">
        {!root ? (
          <div className="px-3 py-6 text-center text-xs text-(--tmd-fg-faint)">
            {t("无激活工作区")}
          </div>
        ) : error ? (
          <div className="px-3 py-6 text-center text-xs text-(--tmd-err)">
            {t("搜索失败")}:{error}
          </div>
        ) : busy ? (
          <div className="px-3 py-6 text-center text-xs text-(--tmd-fg-faint)">
            {t("正在搜索…")}
          </div>
        ) : results && groups.length === 0 ? (
          <div className="px-3 py-6 text-center text-xs text-(--tmd-fg-faint)">
            {t("无匹配结果")}
          </div>
        ) : (
          groups.map(([path, hits]) => (
            <div key={path}>
              <button
                type="button"
                aria-expanded={expanded.has(path)}
                onClick={() => toggleExpand(path)}
                className="flex w-full items-center gap-1.5 px-3 py-1.5 text-left text-xs text-(--tmd-fg-muted) hover:bg-(--tmd-bg-hover)"
              >
                <CaretRight
                  size="0.625rem"
                  aria-hidden
                  className={`shrink-0 transition-transform ${expanded.has(path) ? "rotate-90" : ""}`}
                />
                <span className="truncate font-mono">{path}</span>
                <span className="ml-auto shrink-0 tabular-nums text-(--tmd-fg-faint)">
                  {hits.length}
                </span>
              </button>
              {expanded.has(path) &&
                hits.map((hit) => (
                  <button
                    type="button"
                    key={hit.line}
                    onClick={() => {
                      if (!root) return;
                      openFileAtLine(`${normalizePath(root)}/${hit.path}`, hit.line);
                      closeSearchOverlay();
                    }}
                    className="flex w-full items-baseline gap-2 px-3 py-1 pl-7 text-left hover:bg-(--tmd-bg-hover)"
                  >
                    <span className="w-10 shrink-0 text-right tabular-nums text-(--tmd-fg-faint)">
                      {hit.line}
                    </span>
                    <span className="truncate font-mono text-xs leading-5 text-(--tmd-fg)">
                      {splitHits(hit.text, query, caseSensitive).map((part, i) =>
                        part.hit ? (
                          <mark
                            key={i}
                            className="rounded-(--tmd-radius-sm) bg-(--tmd-accent-soft) px-0.5 text-inherit"
                          >
                            {part.text}
                          </mark>
                        ) : (
                          <span key={i}>{part.text}</span>
                        ),
                      )}
                    </span>
                  </button>
                ))}
            </div>
          ))
        )}
      </div>

      <div className="flex items-center gap-3 border-t border-(--tmd-border) px-3 py-1.5 text-xs text-(--tmd-fg-faint)">
        {results ? t("{n} 个结果", { n: results.length }) : "\u00a0"}
        {results && truncated && t("结果不完整(扫描预算耗尽或已达上限),仅显示前 {n} 条", { n: results.length })}
      </div>
    </div>
  );
}
