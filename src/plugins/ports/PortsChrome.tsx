/**
 * ports · 工具栏与告警条 —— PortsView 的展示性小块(react-doctor 复杂度分装)。
 */

import { ArrowClockwise, MagnifyingGlass, Pause, Play } from "@phosphor-icons/react";
import { t } from "@kernel/i18n";
import { Spinner } from "@kernel/Spinner";
import { OS_LABEL } from "./platform";
import type { OsKind, ScanOutcome } from "./types";

export function PortsToolbar({
  loading,
  auto,
  filter,
  ports,
  procs,
  os,
  source,
  onRefresh,
  onToggleAuto,
  onFilter,
}: {
  loading: boolean;
  auto: boolean;
  filter: string;
  ports: number;
  procs: number;
  os: OsKind;
  source: string;
  onRefresh: () => void;
  onToggleAuto: () => void;
  onFilter: (q: string) => void;
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
      <div className="flex h-7 min-w-0 flex-1 items-center gap-1.5 rounded-(--tmd-radius-sm) border border-(--tmd-border-strong) px-2">
        <MagnifyingGlass size="0.875rem" className="shrink-0 text-(--tmd-fg-faint)" aria-hidden />
        <input
          value={filter}
          onChange={(e) => onFilter(e.target.value)}
          placeholder={t("搜索端口 / 进程 / 仓库…")}
          className="h-full min-w-0 flex-1 bg-transparent outline-none placeholder:text-(--tmd-fg-faint)"
        />
      </div>
      <span
        className="shrink-0 text-(--tmd-fg-muted)"
        title={t("平台:{os} · 工具:{source}", { os: OS_LABEL[os], source })}
      >
        {t("{n} 个端口 · {m} 个进程", { n: ports, m: procs })}
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
