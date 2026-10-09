/**
 * AggregateReposView —— Git 聚合「全部」主体(spec 2026-10-08-git-batch-ops-design):
 * 批量条(摘要 + ⟳ + 「拉取全部 ▾」分裂钮)+ RepoBar + 仓行;行三态:常态(hover 拉取/推送,点行跳仓)→ 执行中 → 结果(✓/⊘/✗)。
 */
import { useState, type ReactNode } from "react";
import { ArrowClockwise, ArrowDown, ArrowUp, CaretDown } from "@phosphor-icons/react";
import { t } from "@kernel/i18n";
import { Spinner } from "@kernel/Spinner";
import { useMinSpin } from "@kernel/useMinSpin";
import { KIND_META } from "./repoKindMeta";
import { BatchPushDialog } from "./BatchPushDialog";
import { MenuShell } from "../GitToolbar";
import { useAggregateRepos } from "../useAggregateRepos";
import { useBatchGitOps, type RowResult } from "../useBatchGitOps";
import type { AggRepo, BatchOp } from "../aggregateModel";

/** 单行状态列:执行结果优先于 ↑↓ 常态(结果保留到下次执行/手动 ⟳)。 */
function RowStatus({ repo, result }: { repo: AggRepo; result: RowResult | undefined }) {
  if (result) {
    if (result.phase === "running") {
      return (
        <span className="flex items-center gap-1 text-(--tmd-fg-muted)">
          <Spinner /> {t("{op}中…", { op: result.text })}
        </span>
      );
    }
    if (result.phase === "queued") return <span className="text-(--tmd-fg-faint)">{t("排队…")}</span>;
    if (result.phase === "ok") return <span className="text-(--tmd-diff-inserted)">✓ {result.text}</span>;
    if (result.phase === "skip") return <span className="text-(--tmd-fg-faint)">⊘ {result.text}</span>;
    return <span className="text-(--tmd-diff-removed)" title={result.text}>✗ {result.text}</span>;
  }
  return (
    <span className="tabular-nums text-(--tmd-fg-muted)">
      <span className="text-(--tmd-diff-inserted)">↑{repo.ahead}</span>{" "}
      <span className="text-(--tmd-diff-removed)">↓{repo.behind}</span>
      {repo.dirty > 0 && <span className="text-(--tmd-git-modified)"> · {t("{n} 改动", { n: repo.dirty })}</span>}
    </span>
  );
}

/** 行级快操(hover 显):拉取需上游;推送 ahead>0 即可(无上游走缺省目标)。 */
function RowQuickOps({ repo: r, onOp }: { repo: AggRepo; onOp: (op: BatchOp) => void }) {
  const ops = [{ op: "pull" as const, on: r.upstream != null }, { op: "push" as const, on: r.ahead > 0 }].filter((o) => o.on);
  return (
    <span className="hidden shrink-0 gap-2 pr-2.5 group-hover:flex">
      {ops.map(({ op }) => (
        <button
          key={op}
          type="button"
          onClick={(e) => { e.stopPropagation(); onOp(op); }}
          className="text-[11px] text-(--tmd-fg-faint) hover:text-(--tmd-fg) hover:underline"
        >
          {t(op === "pull" ? "拉取" : "推送")}
        </button>
      ))}
    </span>
  );
}

export function AggregateReposView({
  onJump,
  afterBatch,
  repoBar,
}: {
  /** 点行跳仓:置选中仓 + 切工作区 + 退回本仓态(由 GitPanel 编排)。 */
  onJump: (wsId: string, path: string) => void;
  /** 批量落定后让当前仓面板数据失效重取。 */
  afterBatch: () => void;
  /** RepoBar(仓 chips + 本仓/全部开关),渲染在批量条之下(两行头部 2026-10-09 上下互换)。 */
  repoBar: ReactNode;
}) {
  const agg = useAggregateRepos();
  const batch = useBatchGitOps(() => {
    void agg.refresh();
    afterBatch();
  });
  const [opsMenu, setOpsMenu] = useState<{ x: number; y: number } | null>(null);
  const { spinning: refreshing, spin: spinRefresh } = useMinSpin();
  const [pushOpen, setPushOpen] = useState(false);
  const [pushed, setPushed] = useState<readonly string[]>([]);
  const all = agg.groups.flatMap((g) => g.repos);
  const pullable = all.filter((r) => r.upstream != null).length;
  /* 可推 = ahead>0:无上游但本地有独有提交也可推(目标缺省 origin:<branch>,弹窗可改)。 */
  const pushable = all.filter((r) => r.ahead > 0).length;
  const dirty = all.filter((r) => r.dirty > 0).length;
  const errCount = all.filter((r) => batch.rows.get(r.path)?.phase === "err").length;
  const opLabels: Record<BatchOp, string> = { fetch: t("获取"), pull: t("拉取"), push: t("推送") };
  const menuRows: { op: BatchOp; label: string; icon: typeof ArrowDown; count: number }[] = [
    { op: "fetch", label: t("获取全部"), icon: ArrowClockwise, count: all.length },
    { op: "pull", label: t("拉取全部"), icon: ArrowDown, count: pullable },
    { op: "push", label: t("推送全部"), icon: ArrowUp, count: pushable },
  ];

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center gap-1 whitespace-nowrap border-b border-(--tmd-border) px-2 py-1">
        <span className="min-w-0 flex-1 truncate text-xs text-(--tmd-fg-muted) tabular-nums">
          {batch.running
            ? t("{op} {done}/{total}…", {
                op: opLabels[batch.running.op],
                done: batch.running.done,
                total: batch.running.total,
              })
            : t("{n} 仓 · {p} 可拉 · {u} 可推 · {d} 有改动", {
                n: all.length,
                p: pullable,
                u: pushable,
                d: dirty,
              })}
        </span>
        {batch.running && <Spinner />}
        {batch.running ? (
          <>
            {/* 推送弹窗假关闭后的重看入口:进度仍在跑,点开续看逐仓状态。 */}
            {batch.running.op === "push" && !pushOpen && (
              <button
                type="button"
                onClick={() => setPushOpen(true)}
                className="rounded-md border border-(--tmd-border) px-2 py-0.5 text-[11px] hover:bg-(--tmd-bg-hover)"
              >
                {t("查看进度")}
              </button>
            )}
            <button
              type="button"
              onClick={batch.cancel}
              className="rounded-md border border-(--tmd-diff-removed) px-2 py-0.5 text-[11px] text-(--tmd-diff-removed)"
            >
              {t("取消")}
            </button>
          </>
        ) : (
          <>
            {errCount > 0 && (
              <button
                type="button"
                onClick={() => batch.retryFailed(all)}
                className="rounded-md border border-(--tmd-border) px-2 py-0.5 text-[11px] hover:bg-(--tmd-bg-hover)"
              >
                {t("重试失败({n})", { n: errCount })}
              </button>
            )}
            <button
              type="button"
              title={t("刷新")}
              aria-label={t("刷新")}
              onClick={() => spinRefresh(() => {
                batch.clear();
                return agg.refresh();
              })}
              className="flex shrink-0 items-center gap-0.5 rounded px-1 py-1 text-(--tmd-fg-muted) hover:bg-(--tmd-bg-hover)"
            >
              {refreshing
                ? <Spinner size="0.75rem" />
                : <ArrowClockwise className="h-[0.75rem] w-[0.75rem]" aria-hidden />}
            </button>
            {/* 分裂按钮组:主钮 = 拉取全部(最高频);▾ 菜单含获取/拉取/推送全部,带目标数。 */}
            <span className="flex shrink-0 items-stretch overflow-hidden rounded-md border border-(--tmd-accent)">
              <button
                type="button"
                disabled={pullable === 0}
                onClick={() => batch.run("pull", all)}
                className="flex items-center gap-1 bg-(--tmd-accent) px-2 py-0.5 text-[11px] text-(--tmd-accent-fg) hover:brightness-108 disabled:opacity-45"
              >
                <ArrowDown className="h-[0.6875rem] w-[0.6875rem]" aria-hidden />
                {t("拉取全部")}
              </button>
              <button
                type="button"
                title={t("更多批量操作")}
                aria-label={t("更多批量操作")}
                aria-haspopup="menu"
                aria-expanded={opsMenu != null}
                disabled={all.length === 0}
                onClick={(e) => {
                  const rect = e.currentTarget.getBoundingClientRect();
                  /* 钳制同 GitToolbar:窄面板防左缘出屏,贴底菜单向上翻。 */
                  const x = Math.max(12, Math.min(rect.right - 176, window.innerWidth - 176 - 12));
                  const y = rect.bottom + 4 + 132 > window.innerHeight ? rect.top - 132 - 4 : rect.bottom + 4;
                  setOpsMenu({ x, y });
                }}
                className="border-l border-(--tmd-accent-fg)/30 bg-(--tmd-accent) px-1 text-(--tmd-accent-fg) hover:brightness-108 disabled:opacity-45"
              >
                <CaretDown className="h-[0.625rem] w-[0.625rem]" aria-hidden />
              </button>
            </span>
          </>
        )}
      </div>
      {repoBar}
      {opsMenu && !batch.running && (
        <MenuShell position={opsMenu} width={176} onClose={() => setOpsMenu(null)}>
          {menuRows.map((row) => {
            const RowIcon = row.icon;
            return (
              <button
                key={row.op}
                type="button"
                role="menuitem"
                /* 推送项不按目标数置灰:0 可推也开弹窗(行给原因,确认自会拦);获取/拉取无可操作仓才禁。 */
                disabled={row.op !== "push" && row.count === 0}
                onClick={() => {
                  /* 推送必须经确认弹窗(勾选仓 + 挂钩/标签选项);获取/拉取直发。
                     菜单新开 = 清上次快照(查看进度重开则保留,续看同一次推送)。 */
                  if (row.op === "push") {
                    setPushed([]);
                    setPushOpen(true);
                  } else batch.run(row.op, all);
                  setOpsMenu(null);
                }}
                className="flex w-full items-center justify-between px-3 py-1.5 text-left text-xs hover:bg-(--tmd-bg-hover) disabled:opacity-50"
              >
                <span className="flex items-center gap-1.5">
                  <RowIcon className="h-[0.75rem] w-[0.75rem]" aria-hidden />
                  <span>{row.label}</span>
                </span>
                {row.count > 0 && <span>{row.count}</span>}
              </button>
            );
          })}
        </MenuShell>
      )}
      {pushOpen && (
        <BatchPushDialog
          repos={all}
          running={batch.running?.op === "push" ? batch.running : null}
          rows={batch.rows}
          pushed={pushed}
          onClose={() => setPushOpen(false)}
          onConfirm={(sel, opts) => {
            setPushed(sel.map((r) => r.path));
            batch.runPush(sel, opts);
          }}
        />
      )}

      <div className="min-h-0 flex-1 overflow-y-auto py-1">
        {all.length === 0 && !agg.loading && (
          <div className="grid h-24 place-items-center text-(--tmd-fg-faint)">
            {t("本机工作区内未发现 Git 仓库")}
          </div>
        )}
        {agg.groups.map((g) => (
          <div key={g.wsId}>
            <div className="flex items-baseline gap-1.5 px-2.5 pt-2 pb-0.5">
              <span className="text-[11px] font-semibold text-(--tmd-fg-subtle)">{g.wsName}</span>
              <span className="min-w-0 truncate text-[10px] text-(--tmd-fg-faint)">{g.root}</span>
              {g.truncated && (
                <span className="shrink-0 text-[10px] text-(--tmd-git-modified)" title={t("扫描结果超过 32 仓被截断,其余仓请在 RepoBar 逐仓操作")}>
                  {t("已截断")}
                </span>
              )}
            </div>
            {g.repos.map((r) => {
              const result = batch.rows.get(r.path);
              const meta = KIND_META[r.kind];
              return (
                <div key={r.path} className="group flex items-center whitespace-nowrap select-none hover:bg-(--tmd-bg-hover)">
                  <button
                    type="button"
                    title={t("打开此仓")}
                    disabled={batch.running != null}
                    onClick={() => onJump(g.wsId, r.path)}
                    className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 px-2.5 py-1.5 text-left disabled:cursor-default"
                  >
                    <span
                      className={`h-1.5 w-1.5 shrink-0 rounded-full ${r.dirty > 0 ? "bg-(--tmd-git-modified)" : "bg-(--tmd-fg-faint)"}`}
                    />
                    <span className="max-w-[38%] truncate font-semibold">{r.name}</span>
                    {meta.label && (
                      <span className="shrink-0 rounded-[3px] border border-(--tmd-border) px-1 text-[9.5px] text-(--tmd-fg-faint)">
                        {t(meta.label)}
                      </span>
                    )}
                    <span className="max-w-[22%] truncate font-mono text-[11px] text-(--tmd-fg-subtle)">
                      {r.branch || "—"}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-[11px]">
                      <RowStatus repo={r} result={result} />
                    </span>
                  </button>
                  {!result && !batch.running && (r.upstream != null || r.ahead > 0) && (
                    <RowQuickOps repo={r} onOp={(op) => batch.runSingle(op, r)} />
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </div>

      {agg.remoteSkipped > 0 && (
        <div className="shrink-0 border-t border-(--tmd-border) px-2.5 py-1.5 text-[10.5px] text-(--tmd-fg-faint)">
          {t("已排除 {n} 个远程工作区(本机 Git 不支持远程路径)", { n: agg.remoteSkipped })}
        </div>
      )}
    </div>
  );
}
