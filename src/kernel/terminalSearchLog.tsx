/**
 * ⌘F 日志全文搜索 —— 磁盘命中面(自 terminalSearch.tsx 拆出,文件规模铁则)。
 *
 * 缓冲(xterm 滚动缓冲,上限 2.4 万行)零命中且日志还有更早字节时,搜完整
 * 磁盘日志(64MB 旋转日志,Rust 字面量扫描):命中行去重列表 + 总数,点击
 * 窗口化跳转定位(jumpToByte,512KB 窗重写 + 间隙标记,不逐页回放)。
 * 正则模式不搜磁盘(字面量子串口径,如实隐藏入口)。
 */
import type { LogSearchResult } from "@kernel/ipc";
import { MagnifyingGlass } from "@phosphor-icons/react";
import { t } from "@kernel/i18n";

export function TerminalLogSearchButton({
  searching,
  onClick,
}: {
  searching: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex shrink-0 items-center gap-0.5 rounded px-1 text-xs text-(--tmd-fg-faint) hover:text-(--tmd-accent)"
    >
      <MagnifyingGlass size="0.75rem" aria-hidden />
      {searching ? t("搜索日志中…") : t("搜完整日志")}
    </button>
  );
}

export function TerminalLogHits({
  result,
  jumping,
  onPick,
}: {
  result: LogSearchResult;
  jumping: boolean;
  onPick: (offset: number) => void;
}) {
  return (
    <div className="absolute left-0 right-0 top-full z-10 mt-1 max-h-72 overflow-y-auto rounded-md border border-(--tmd-border) bg-(--tmd-bg-popover) py-1 shadow-(--tmd-shadow-popover)">
      <div className="px-2 pb-1 text-[10px] leading-4 text-(--tmd-fg-faint)">
        {t("日志命中 {n} 处", { n: String(result.totalHits) })}
        {result.truncated ? t("(仅列前 {n} 行)", { n: String(result.hits.length) }) : ""}
        {jumping ? t("定位中…") : ""}
      </div>
      {result.hits.map((hit) => (
        <button
          type="button"
          key={hit.byteOffset}
          onClick={() => onPick(hit.byteOffset)}
          title={t("定位")}
          className="block w-full truncate px-2 py-0.5 text-left font-mono text-[11px] leading-4 text-(--tmd-fg-muted) hover:bg-(--tmd-bg-hover) hover:text-(--tmd-fg)"
        >
          {hit.line || "␀"}
        </button>
      ))}
    </div>
  );
}
