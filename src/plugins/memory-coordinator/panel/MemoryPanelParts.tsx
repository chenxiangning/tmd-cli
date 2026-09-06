/**
 * Memory 面板拆件 —— 自 MemoryPanel.tsx 拆出(文件规模铁则)。
 *
 * 命中词高亮 / 类目中文 label / 记忆列表行(截断摘要 + 展开详情 + 选择态
 * + hover 移除)/ 底部工具条(控制台切换 + 诊断 + 上游治理提示)。
 */

import { useCallback, useState } from "react";
import { ChevronDown } from "lucide-react";
import { CATEGORY_CN, type MemoryItem } from "../protocol";
import { memoryPool } from "../pool";
import { toggleConsoleTab } from "../console/MemoryConsole";

/**
 * 面板诊断状态 + 执行器 —— 池就绪与池不可用两态共用(不可用态同样要能
 * 点「诊断」排障、点「控制台」进安装流程;状态提升免两处复制)。
 */
export function useMemoryDiag() {
  const [diag, setDiag] = useState<string[]>([]);
  const [diagRunning, setDiagRunning] = useState(false);
  const runDiag = useCallback(() => {
    setDiagRunning(true);
    memoryPool
      .status()
      .then((st) => {
        const verdict = st.ready
          ? "✓ 共享数据库可读"
          : st.reason === "locked"
            ? "✗ 共享数据库不可读(被占用,疑似迁移窗口)"
            : "✗ 共享数据库不可读(未安装或未迁移)";
        setDiag([verdict, `✓ 检测完成 · ${st.count} 条生效记忆`]);
      })
      .finally(() => setDiagRunning(false));
  }, []);
  return { diag, diagRunning, runDiag };
}

/** 命中词高亮:按当前查询拆段包 <mark>(大小写不敏感,首处起全部命中)。 */
export function highlight(text: string, query: string): React.ReactNode {
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

export function categoryLabel(key: string): string {
  return (CATEGORY_CN as Record<string, string>)[key] ?? key;
}

export function MemoryListItem({
  m,
  query,
  selectMode,
  selected,
  expanded,
  archiving,
  onSelect,
  onExpand,
  onRemove,
}: {
  m: MemoryItem;
  query: string;
  selectMode: boolean;
  selected: boolean;
  expanded: boolean;
  archiving: boolean;
  onSelect: () => void;
  onExpand: () => void;
  onRemove: () => void;
}) {
  return (
    <div
      className={`group relative rounded-md px-2 py-1.5 hover:bg-(--tmd-bg-hover) ${
        selected ? "bg-(--tmd-accent-soft)" : ""
      } ${selectMode ? "cursor-pointer" : ""}`}
      onClick={() => {
        if (selectMode) {
          onSelect();
          return;
        }
        onExpand();
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
          className={`ml-auto transition-transform ${expanded ? "rotate-180" : ""}`}
        />
      </div>
      {expanded && (
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
          archiving ? "text-(--tmd-fg-faint)" : "text-(--tmd-fg-muted) hover:text-(--tmd-err)"
        }`}
        disabled={archiving}
        onClick={onRemove}
        title="移除(经 omp 官方管线归档,可恢复)"
      >
        {archiving ? "归档中…" : "移除"}
      </button>
    </div>
  );
}

/** 选择模式工具条:选择/退出 + 合并所选 + 合并进度提示。 */
export function MemorySelectBar({
  selectMode,
  selectedSize,
  merging,
  mergeNote,
  mergeDisabled,
  onToggleSelectMode,
  onMerge,
}: {
  selectMode: boolean;
  selectedSize: number;
  merging: boolean;
  mergeNote: string | null;
  mergeDisabled: boolean;
  onToggleSelectMode: () => void;
  onMerge: () => void;
}) {
  return (
    <>
      <div className="mb-1.5 flex min-w-0 flex-wrap items-center gap-1.5 px-1">
        <button
          className={`rounded-md border px-2 py-0.5 text-[10.5px] ${
            selectMode ? "border-(--tmd-accent) bg-(--tmd-accent-soft) text-(--tmd-fg)" : "border-(--tmd-border) text-(--tmd-fg-muted)"
          } hover:bg-(--tmd-bg-hover)`}
          onClick={onToggleSelectMode}
        >
          {selectMode ? "退出选择" : "选择"}
        </button>
        {selectMode && (
          <>
            <button
              className="flex-none rounded-md border border-(--tmd-accent) bg-(--tmd-accent) px-2 py-0.5 text-[10.5px] text-(--tmd-accent-fg) disabled:opacity-45"
              disabled={mergeDisabled}
              title="合并所选为一条(content 取首条表述,经 omp 官方管线 merge)"
              onClick={onMerge}
            >
              {merging ? "合并中…" : `合并所选(${selectedSize})`}
            </button>
          </>
        )}
      </div>
      {selectMode && (
        <div className="mb-1.5 px-1 text-[10px] text-(--tmd-fg-faint)">
          {mergeNote ?? "选 2 条以上重复记忆折叠为一条"}
        </div>
      )}
    </>
  );
}

/** 底部工具条:控制台切换 + 诊断按钮 + 上游治理提示(诊断后显示结果行)。 */
export function MemoryPanelFooter({
  consoleOpen,
  diag,
  diagRunning,
  onDiag,
}: {
  consoleOpen: boolean;
  diag: string[];
  diagRunning: boolean;
  onDiag: () => void;
}) {
  return (
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
        onClick={onDiag}
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
  );
}
