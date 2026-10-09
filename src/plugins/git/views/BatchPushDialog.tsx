/**
 * BatchPushDialog —— 多仓推送确认弹窗(spec 2026-10-08-git-batch-ops-design §推送确认弹窗):
 * 左列 = 可推仓勾选列表(可推置顶、禁选沉底;☐ + 仓名 + ↑n;第二行完整 `branch → remote:target`,
 *  target 行内可改,覆盖值随推送下发并驱动右侧预览;失败行徽标可点,行内展开完整失败日志);
 * 右列 = 选中仓的本次推送内容(BatchPushPreview:提交清单 + 选中提交变更文件);
 * 底栏对齐单仓 PushDialog:推送标签 / 运行 Git 挂钩 + 取消 / 推送(n)。
 * 不给 force-with-lease(批量强推无逐仓确认);不给 Gerrit;remote 固定取上游所属
 *  (多 remote 仓去单仓弹窗改,批量场景上游 remote 已覆盖绝大多数);无上游行
 *  (本地独有分支)同样可推,target 缺省 origin:<branch> 行内可改。
 */

import { useMemo, useState } from "react";
import { t } from "@kernel/i18n";
import { DialogShell } from "@kernel/DialogShell";
import { UploadSimple } from "@phosphor-icons/react";
import { splitUpstream, type AggRepo } from "../aggregateModel";
import type { BatchRunning, RowResult } from "../useBatchGitOps";
import { BatchPushPreview } from "./BatchPushPreview";
import { BatchPushFooter, BatchPushRow } from "./BatchPushStatus";

/** 行可推判定:ahead>0 即可(无上游也推,目标缺省 origin:<branch>);否则禁选并给原因。 */
function eligibleOf(r: AggRepo): string | null {
  if (r.ahead <= 0) return t("无待推提交");
  return null;
}

export function BatchPushDialog({
  repos,
  running,
  rows,
  pushed,
  onClose,
  onConfirm,
}: {
  repos: readonly AggRepo[];
  /** 批量推送进行中态(null = 空闲);进行中弹窗可假关闭,重开续看进度。 */
  running: BatchRunning | null;
  /** 行结果(进行中/落定后逐仓 ✓/✗ 标识)。 */
  rows: ReadonlyMap<string, RowResult>;
  /** 本次推送仓集快照(父层持有):行状态徽章/落定回执的口径,重开不丢。 */
  pushed: readonly string[];
  onClose: () => void;
  onConfirm: (
    rows: AggRepo[],
    opts: { followTags: boolean; runHooks: boolean; targetByPath: ReadonlyMap<string, { remote: string; branch: string }> },
  ) => void;
}) {
  const eligibility = useMemo(() => new Map(repos.map((r) => [r.path, eligibleOf(r)])), [repos]);
  const eligible = repos.filter((r) => eligibility.get(r.path) == null);
  const [excluded, setExcluded] = useState<ReadonlySet<string>>(new Set());
  const [selected, setSelected] = useState<string | null>(eligible[0]?.path ?? null);
  const [editing, setEditing] = useState<string | null>(null);
  const [branchByPath, setBranchByPath] = useState<Record<string, string>>({});
  const [tags, setTags] = useState(false);
  const [runHooks, setRunHooks] = useState(true);
  /* 落定派生:快照非空、running 已收、且快照行全部终态。快照归父层:假关闭重开续看,
   *  菜单新开时父层清空 = 干净态;确认与父层 setRunning 同事件批处理,无「旧结果闪 settled」窗口。 */
  const pushedSet = useMemo(() => new Set(pushed), [pushed]);
  const settled =
    !running &&
    pushed.length > 0 &&
    pushed.every((p) => {
      const ph = rows.get(p)?.phase;
      return ph === "ok" || ph === "err" || ph === "skip";
    });

  const checked = eligible.filter((r) => !excluded.has(r.path));
  const allChecked = eligible.length > 0 && checked.length === eligible.length;
  const selectedRepo = eligible.find((r) => r.path === selected) ?? null;
  /* 行序:可推仓置顶(组内保持聚合序 —— sort 稳定),禁选行沉底一眼扫过。 */
  const ordered = useMemo(
    () =>
      repos
        .slice()
        .sort((a, b) => Number(eligibility.get(a.path) != null) - Number(eligibility.get(b.path) != null)),
    [repos, eligibility],
  );

  /* 落定统计:按确认时快照的仓集计失败数(rows 含历史结果,只数本次)。 */
  let failCount = 0;
  if (settled) {
    for (const p of pushed) {
      if (rows.get(p)?.phase === "err") failCount += 1;
    }
  }

  /** 行有效目标:覆盖值 > 上游 leaf;无上游缺省 origin:<branch>(显式 refspec 推送不依赖上游)。 */
  const defaultTargetOf = (r: AggRepo): { remote: string; branch: string } =>
    r.upstream != null ? splitUpstream(r.upstream) : { remote: "origin", branch: r.branch };
  const targetOf = (r: AggRepo): { remote: string; branch: string } => {
    const b = branchByPath[r.path];
    return b ? { remote: defaultTargetOf(r).remote, branch: b } : defaultTargetOf(r);
  };

  const confirm = () => {
    /* 全部勾选行都带显式目标下发:无上游行必须(执行器不再回落 gitPullPush),
       有上游行与上游拆分等值,语义不变。 */
    const targetByPath = new Map<string, { remote: string; branch: string }>();
    for (const r of checked) targetByPath.set(r.path, targetOf(r));
    /* 快照由父层在 onConfirm 落(此处不再置)。 */
    onConfirm(checked, { followTags: tags, runHooks, targetByPath });
  };

  return (
    <DialogShell
      title={t("推送全部到远端")}
      icon={<UploadSimple className="h-[0.875rem] w-[0.875rem]" aria-hidden />}
      width={1040}
      zClass="z-[1201]"
      onClose={onClose}
      footer={
        /* 冻结计数:落定后 repos 重扫 ahead=0,checked 塌成 0,标签不能闪成「推送(0)」。 */
        <BatchPushFooter
          tags={tags}
          runHooks={runHooks}
          running={running}
          settled={settled}
          failCount={failCount}
          confirmCount={running || settled ? pushed.length : checked.length}
          confirmDisabled={checked.length === 0 || running != null || settled}
          onToggleTags={() => setTags((v) => !v)}
          onToggleHooks={() => setRunHooks((v) => !v)}
          onConfirm={confirm}
          onCancel={onClose}
        />
      }
    >
      <div className="flex min-h-0 gap-2" style={{ height: 380 }}>
        <div className="flex min-h-0 w-[46%] flex-col rounded-md border border-(--tmd-border)">
          <label className="flex shrink-0 items-center gap-2 border-b border-(--tmd-border) px-2.5 py-1.5 text-xs text-(--tmd-fg-subtle)">
            <input
              type="checkbox"
              checked={allChecked}
              disabled={running != null || settled}
              ref={(el) => {
                if (el) el.indeterminate = !allChecked && checked.length > 0;
              }}
              onChange={() => setExcluded(allChecked ? new Set(eligible.map((r) => r.path)) : new Set())}
              className="h-3.5 w-3.5 shrink-0 cursor-pointer accent-(--tmd-accent) disabled:cursor-default"
            />
            {t("已选 {n}/{m} 仓", { n: checked.length, m: eligible.length })}
          </label>
          <div className="min-h-0 flex-1 overflow-y-auto py-0.5">
            {ordered.map((r) => {
              const reason = eligibility.get(r.path) ?? null;
              /* 推送期间/落定后:行尾换逐仓状态(转圈/✓/✗),静态 ↑n 让位。 */
              const st = (running || settled) && pushedSet.has(r.path) ? rows.get(r.path) : undefined;
              return (
                <BatchPushRow
                  key={r.path}
                  repo={r}
                  reason={reason}
                  selected={selected === r.path}
                  editing={editing === r.path}
                  st={st}
                  tgt={targetOf(r)}
                  overridden={branchByPath[r.path] != null}
                  checkedOn={!excluded.has(r.path)}
                  interactive={running == null && !settled}
                  onToggleExclude={() => {
                    const next = new Set(excluded);
                    if (next.has(r.path)) next.delete(r.path);
                    else next.add(r.path);
                    setExcluded(next);
                  }}
                  onSelect={() => setSelected(r.path)}
                  onEditStart={() => {
                    setSelected(r.path);
                    setEditing(r.path);
                  }}
                  onEditCommit={(next) => {
                    setEditing(null);
                    setBranchByPath((m) => {
                      const c = { ...m };
                      if (next && next !== defaultTargetOf(r).branch) c[r.path] = next;
                      else delete c[r.path];
                      return c;
                    });
                  }}
                />
              );
            })}
          </div>
        </div>
        {selectedRepo != null ? (
          <BatchPushPreview cwd={selectedRepo.path} remote={targetOf(selectedRepo).remote} target={targetOf(selectedRepo).branch} ahead={selectedRepo.ahead} />
        ) : (
          <div className="grid flex-1 place-items-center rounded-md border border-(--tmd-border) text-xs text-(--tmd-fg-faint)">
            {t("选择左侧仓查看提交")}
          </div>
        )}
      </div>
    </DialogShell>
  );
}
