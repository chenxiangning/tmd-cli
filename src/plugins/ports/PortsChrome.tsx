/**
 * ports · 工具栏与告警条 —— PortsView 的展示性小块(react-doctor 复杂度分装)。
 */

import { ArrowClockwise, CaretDoubleDown, CaretDoubleUp, MagnifyingGlass, Pause, Play, Plugs, X } from "@phosphor-icons/react";
import { t } from "@kernel/i18n";
import { Empty } from "@kernel/Empty";
import { Spinner } from "@kernel/Spinner";
import { OS_LABEL } from "./platform";
import { PortGroupBlock, PortListHeader, type RowCtx } from "./PortsRows";
import { rowKey } from "./portsTree";
import type { OsKind, PortGroup, ScanOutcome, SortKey, SortSpec } from "./types";

const ICON_BTN =
  "flex h-7 w-7 shrink-0 items-center justify-center rounded-(--tmd-radius-sm) border border-(--tmd-border-strong) text-(--tmd-fg-muted) hover:bg-(--tmd-bg-hover) hover:text-(--tmd-fg) disabled:opacity-40 disabled:hover:bg-transparent";

export function PortsToolbar({
  loading,
  auto,
  filter,
  ports,
  shown,
  procs,
  os,
  source,
  canFoldAll,
  onRefresh,
  onToggleAuto,
  onFilter,
  onCollapseAll,
  onExpandAll,
}: {
  loading: boolean;
  auto: boolean;
  filter: string;
  ports: number;
  /** 过滤后的可见行数;无过滤时 = ports。 */
  shown: number;
  procs: number;
  os: OsKind;
  source: string;
  /** 有子行的可见组数 > 0 才允许批量折叠。 */
  canFoldAll: boolean;
  onRefresh: () => void;
  onToggleAuto: () => void;
  onFilter: (q: string) => void;
  onCollapseAll: () => void;
  onExpandAll: () => void;
}) {
  return (
    <div className="flex items-center gap-2 px-3 pt-3">
      <button
        type="button"
        disabled={loading}
        className="flex h-7 items-center gap-1.5 rounded-(--tmd-radius-sm) border border-(--tmd-border-strong) px-2.5 hover:bg-(--tmd-bg-hover) disabled:opacity-50"
        onClick={onRefresh}
      >
        {loading ? <Spinner size="0.875rem" /> : <ArrowClockwise size="0.875rem" aria-hidden />}
        {t("刷新")}
      </button>
      <button
        type="button"
        aria-pressed={auto}
        className={
          "flex h-7 items-center gap-1.5 rounded-(--tmd-radius-sm) border px-2.5 " +
          (auto
            ? "border-(--tmd-accent) bg-(--tmd-accent-soft) text-(--tmd-accent)"
            : "border-(--tmd-border-strong) hover:bg-(--tmd-bg-hover)")
        }
        onClick={onToggleAuto}
      >
        {auto ? <Pause size="0.875rem" aria-hidden /> : <Play size="0.875rem" aria-hidden />}
        {t("自动刷新")}
      </button>
      <button
        type="button"
        className={ICON_BTN}
        disabled={!canFoldAll}
        title={t("全部折叠")}
        aria-label={t("全部折叠")}
        onClick={onCollapseAll}
      >
        <CaretDoubleUp size="0.875rem" aria-hidden />
      </button>
      <button
        type="button"
        className={ICON_BTN}
        disabled={!canFoldAll}
        title={t("全部展开")}
        aria-label={t("全部展开")}
        onClick={onExpandAll}
      >
        <CaretDoubleDown size="0.875rem" aria-hidden />
      </button>
      <div className="flex h-7 min-w-0 flex-1 items-center gap-1.5 rounded-(--tmd-radius-sm) border border-(--tmd-border-strong) px-2">
        <MagnifyingGlass size="0.875rem" className="shrink-0 text-(--tmd-fg-faint)" aria-hidden />
        <input
          value={filter}
          onChange={(e) => onFilter(e.target.value)}
          placeholder={t("搜索端口 / 进程 / 仓库…")}
          className="h-full min-w-0 flex-1 bg-transparent outline-none placeholder:text-(--tmd-fg-faint)"
        />
        {filter && (
          <button
            type="button"
            className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-(--tmd-fg-faint) hover:bg-(--tmd-bg-hover) hover:text-(--tmd-fg)"
            title={t("清除")}
            onClick={() => onFilter("")}
          >
            <X size="0.75rem" aria-hidden />
          </button>
        )}
      </div>
      <span
        className="shrink-0 text-(--tmd-fg-muted)"
        title={t("平台:{os} · 工具:{source}", { os: OS_LABEL[os], source })}
      >
        {shown === ports
          ? t("{n} 个端口 · {m} 个进程", { n: ports, m: procs })
          : t("{s} / {n} 个端口 · {m} 个进程", { s: shown, n: ports, m: procs })}
      </span>
    </div>
  );
}

export function ViewAlerts({
  error,
  notice,
  outcome,
  os,
}: {
  error: string | null;
  notice: string | null;
  outcome: ScanOutcome | null;
  os: OsKind;
}) {
  const warnings = outcome?.warnings ?? [];
  return (
    <div>
      {error && (
        <p role="alert" className="text-(--tmd-diff-removed)">
          {t("扫描失败:{error}", { error })}
        </p>
      )}
      {notice && (
        <p role="alert" className="text-(--tmd-diff-removed)">
          {notice}
        </p>
      )}
      {warnings.length > 0 && (
        <p className="text-[0.6875rem] text-(--tmd-git-modified)" title={warnings.join("\n")}>
          {t("部分信息获取失败:{n} 项", { n: warnings.length })}
        </p>
      )}
      {os === "windows" && (
        <p className="text-[0.6875rem] text-(--tmd-fg-faint)">
          {t("Windows 无法读取进程 cwd,仓库标注不可用")}
        </p>
      )}
    </div>
  );
}

/** 空态:扫描中 / 过滤无匹配(动作 = 清除筛选)/ 真无监听(动作 = 刷新)。 */
export function PortsEmpty({
  loading,
  filter,
  onRefresh,
  onClearFilter,
}: {
  loading: boolean;
  filter: string;
  onRefresh: () => void;
  onClearFilter: () => void;
}) {
  return (
    <div className="flex flex-1 items-center justify-center">
      <Empty
        icon={<Plugs size="1.25rem" />}
        action={
          loading
            ? undefined
            : filter
              ? { label: t("清除筛选"), onClick: onClearFilter }
              : { label: t("刷新"), onClick: onRefresh }
        }
      >
        {loading ? t("正在扫描…") : filter ? t("无匹配的监听端口") : t("没有监听中的 TCP 端口")}
      </Empty>
    </div>
  );
}

/** 列表主体:空态三分支 / 排序列头 + 家族卡片列表,scroll 容器。 */
export function PortsBody({
  filtered,
  sort,
  onSort,
  ctx,
  loading,
  filter,
  onRefresh,
  onClearFilter,
}: {
  filtered: PortGroup[];
  sort: SortSpec | null;
  onSort: (key: SortKey) => void;
  ctx: RowCtx;
  loading: boolean;
  filter: string;
  onRefresh: () => void;
  onClearFilter: () => void;
}) {
  if (filtered.length === 0) {
    return (
      <div className="flex min-h-0 flex-1 flex-col px-3 py-2">
        <PortsEmpty loading={loading} filter={filter} onRefresh={onRefresh} onClearFilter={onClearFilter} />
      </div>
    );
  }
  return (
    <div className="flex min-h-0 flex-1 flex-col px-3 py-2">
      <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto">
        <PortListHeader sort={sort} onSort={onSort} />
        {filtered.map((g) => (
          <PortGroupBlock key={rowKey(g.top)} group={g} ctx={ctx} />
        ))}
      </div>
    </div>
  );
}
