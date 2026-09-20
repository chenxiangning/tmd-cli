/**
 * 文件名快开(⌘P)—— fsWalkIndex(带截断标志)+ 自写 fuzzy 打分(spec 取舍四:
 * 不引 fuzzy 库);目录项(尾 /)不进快开。↑↓ 选择、Enter/click 打开
 * (openFileInTab);Esc/遮罩关闭由 index.tsx 浮层壳统一处理。
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { FileMagnifyingGlass } from "@phosphor-icons/react";
import { ipc } from "@kernel/ipc";
import { t } from "@kernel/i18n";
import { normalizePath } from "@kernel/pathUtils";
import { openFileInTab } from "@kernel/fileTabs";
import { closeSearchOverlay, useActiveWorkspaceRoot } from "./overlayStore";
import { fuzzyMatch } from "./fuzzy";

/** walk 上限(与 spec 一致);展示截断条数。 */
const WALK_CAP = 5000;
const SHOW_LIMIT = 50;

interface Row {
  path: string;
  score: number;
  indices: number[];
}

/** 命中下标 → 相邻段合并(高亮渲染用,避免逐字符 span)。 */
function pathParts(path: string, indices: readonly number[]): { text: string; hit: boolean }[] {
  const hits = new Set(indices);
  const parts: { text: string; hit: boolean }[] = [];
  let buf = "";
  let bufHit = false;
  for (let i = 0; i < path.length; i++) {
    const hit = hits.has(i);
    if (hit !== bufHit && buf) {
      parts.push({ text: buf, hit: bufHit });
      buf = "";
    }
    bufHit = hit;
    buf += path[i];
  }
  if (buf) parts.push({ text: buf, hit: bufHit });
  return parts;
}

export function QuickOpen() {
  const root = useActiveWorkspaceRoot();
  const [files, setFiles] = useState<string[] | null>(null);
  const [walkTruncated, setWalkTruncated] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [sel, setSel] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    if (!root) return;
    let cancelled = false;
    ipc
      .fsWalkIndex(root, WALK_CAP)
      .then((res) => {
        if (cancelled) return;
        setFiles(res.files.filter((p) => !p.endsWith("/")));
        setWalkTruncated(res.truncated);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [root]);

  const rows = useMemo<Row[]>(() => {
    if (!files) return [];
    if (!query.trim()) {
      return files.slice(0, SHOW_LIMIT).map((p) => ({ path: p, score: 0, indices: [] }));
    }
    const scored: Row[] = [];
    for (const p of files) {
      const m = fuzzyMatch(query, p);
      if (m) scored.push({ path: p, score: m.score, indices: m.indices });
    }
    scored.sort((a, b) => b.score - a.score || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
    return scored.slice(0, SHOW_LIMIT);
  }, [files, query]);

  /* rows 变短时夹取选中;选中行滚入视口 */
  const active = Math.min(sel, Math.max(rows.length - 1, 0));
  useEffect(() => {
    listRef.current
      ?.querySelector('[data-sel="true"]')
      ?.scrollIntoView({ block: "nearest" });
  }, [active]);

  function open(row: Row): void {
    if (!root) return;
    openFileInTab(`${normalizePath(root)}/${row.path}`);
    closeSearchOverlay();
  }

  return (
    <div className="flex max-h-[50vh] w-[560px] max-w-full flex-col overflow-hidden rounded-(--tmd-radius-lg) border border-(--tmd-border) bg-(--tmd-bg-popover) shadow-2xl">
      <div className="flex items-center gap-2 border-b border-(--tmd-border) px-3 py-2">
        <FileMagnifyingGlass
          size="0.875rem"
          aria-hidden
          className="shrink-0 text-(--tmd-fg-subtle)"
        />
        <input
          ref={inputRef}
          value={query}
          spellCheck={false}
          disabled={!root}
          placeholder={root ? t("输入文件名…") : t("无激活工作区")}
          aria-label={t("文件名快开")}
          onChange={(e) => {
            setQuery(e.target.value);
            setSel(0);
          }}
          onKeyDown={(e) => {
            /* IME 组合期按键(含 Enter 选词)不动作,同 composer enterAction 契约。 */
            if (e.nativeEvent.isComposing) return;
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setSel(Math.min(active + 1, rows.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setSel(Math.max(active - 1, 0));
            } else if (e.key === "Enter") {
              const row = rows[active];
              if (row) open(row);
            }
          }}
          className="min-w-0 flex-1 bg-transparent text-sm text-(--tmd-fg) outline-none placeholder:text-(--tmd-fg-faint)"
        />
      </div>

      <div ref={listRef} className="min-h-[80px] flex-1 overflow-y-auto py-1">
        {!root ? (
          <div className="px-3 py-6 text-center text-xs text-(--tmd-fg-faint)">
            {t("无激活工作区")}
          </div>
        ) : error ? (
          <div className="px-3 py-6 text-center text-xs text-(--tmd-err)">
            {t("加载文件列表失败")}:{error}
          </div>
        ) : files === null ? (
          <div className="px-3 py-6 text-center text-xs text-(--tmd-fg-faint)">
            {t("正在加载文件列表…")}
          </div>
        ) : rows.length === 0 ? (
          <div className="px-3 py-6 text-center text-xs text-(--tmd-fg-faint)">
            {t("无匹配文件")}
          </div>
        ) : (
          rows.map((row, i) => (
            <button
              type="button"
              key={row.path}
              data-sel={i === active}
              onMouseEnter={() => setSel(i)}
              onClick={() => open(row)}
              className={`flex w-full items-center gap-2 px-3 py-1.5 text-left font-mono text-xs ${
                i === active ? "bg-(--tmd-bg-active)" : "hover:bg-(--tmd-bg-hover)"
              }`}
            >
              <span className="truncate text-(--tmd-fg)">
                {pathParts(row.path, row.indices).map((part, j) =>
                  part.hit ? (
                    <span key={j} className="font-semibold text-(--tmd-accent)">
                      {part.text}
                    </span>
                  ) : (
                    <span key={j}>{part.text}</span>
                  ),
                )}
              </span>
            </button>
          ))
        )}
        {/* 截断提示:walk 5000 / 展示 50 双闸,被截掉的文件静默不可达是误导(P3 评审项)。 */}
        {rows.length === SHOW_LIMIT ? (
          <div className="px-3 py-1.5 text-center text-[0.6875rem] text-(--tmd-fg-faint)">
            {t("仅显示前 50 项,继续输入缩小范围")}
          </div>
        ) : null}
        {walkTruncated && (
          <div className="px-3 py-1.5 text-center text-[0.6875rem] text-(--tmd-fg-faint)">
            {t("结果可能不完整:文件数超过扫描上限")}
          </div>
        )}
      </div>
    </div>
  );
}
