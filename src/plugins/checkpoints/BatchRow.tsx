/**
 * BatchRow —— 审批线时间线的批次行(CheckpointsPanel 拆分件,文件规模铁则)。
 *
 * 组成:批头(状态点 + prompt 摘要 + ±stats + 状态徽标 + 归因标记)→
 * 文件行(状态 chip + 路径 + ± + 深链审阅单)→ 批尾动作(通过/回退/应用/反悔)
 * → 内联确认卡(回退与应用共用,mode 区分文案与动作)。
 */

import { useEffect } from "react";
import { Check, RotateCcw, Undo2, Zap } from "lucide-react";
import { formatAbsolute, formatRelativeTime } from "@kernel/relativeTime";
import type { CkptBatch, CkptBatchFile, CkptPatch } from "@kernel/ipc";
import { getCachedDiff, loadDiff, refreshOpenDiff } from "./store";
import { openBatchTab } from "./batchTab";

const POLL_MS = 6000;

/* 状态色走主题 token(随 preset 联动);紫 = 回退语义色(无 token,钉死 #a78bfa) */
const STATE_META = {
  open: {
    label: "进行中",
    dot: "var(--tmd-accent)",
    chip: "bg-(--tmd-accent-soft) text-(--tmd-accent)",
  },
  pending: {
    label: "待审",
    dot: "var(--tmd-git-modified)",
    chip: "bg-(--tmd-git-modified)/15 text-(--tmd-git-modified)",
  },
  approved: { label: "已通过", dot: "var(--tmd-diff-inserted)", chip: "bg-(--tmd-diff-inserted)/15 text-(--tmd-diff-inserted)" },
  reverted: { label: "已退", dot: "#a78bfa", chip: "bg-[#a78bfa]/15 text-[#a78bfa]" },
  done: {
    label: "已处理",
    dot: "var(--tmd-fg-subtle)",
    chip: "bg-(--tmd-fg-subtle)/15 text-(--tmd-fg-subtle)",
  },
} as const;

type BatchStateKey = keyof typeof STATE_META;

function batchState(b: CkptBatch): BatchStateKey {
  return b.open ? "open" : b.state;
}

function fileChipCls(st: string): string {
  if (st === "A") return "bg-(--tmd-diff-inserted)/15 text-(--tmd-diff-inserted)";
  if (st === "D") return "bg-(--tmd-diff-removed)/15 text-(--tmd-diff-removed)";
  return "bg-(--tmd-git-modified)/15 text-(--tmd-git-modified)";
}

/** 批 ± 汇总(来自懒加载 patch;未加载/open 批返回 null,UI 显示占位)。 */
function batchStats(patches: CkptPatch[] | undefined): { ins: number; del: number } | null {
  if (!patches) return null;
  return {
    ins: patches.reduce((s, p) => s + p.additions, 0),
    del: patches.reduce((s, p) => s + p.deletions, 0),
  };
}

/** 内联确认卡目标:mode 区分回退(默认,兼容既有 paths 子集语义)与应用。 */
export interface ConfirmTarget {
  batchId: string;
  paths?: string[];
  mode?: "revert" | "apply";
}

export function BatchRow({
  batch: b,
  last,
  busy,
  confirm,
  setConfirm,
  onApprove,
  onRevert,
  onApply,
  onUndo,
  cwd,
  sessionId,
  tmdSessionId,
}: {
  batch: CkptBatch;
  last: boolean;
  busy: boolean;
  confirm: ConfirmTarget | null;
  setConfirm: (v: ConfirmTarget | null) => void;
  onApprove: (batchId: string) => Promise<void>;
  onRevert: (batchId: string, paths?: string[]) => Promise<void>;
  onApply: (batchId: string) => Promise<void>;
  onUndo: (batchId: string) => Promise<void>;
  cwd: string;
  sessionId: string;
  tmdSessionId?: string;
}) {
  // 批 diff 懒加载(含 open 批,时间线 ± 与审阅单共用同一缓存);
  // open 批新像 = live 工作区,轮内改动定时跟进,封口后停
  useEffect(() => {
    loadDiff(cwd, b.id);
    if (!b.open) return;
    const timer = window.setInterval(() => refreshOpenDiff(cwd, b.id), POLL_MS);
    return () => window.clearInterval(timer);
  }, [cwd, b.id, b.open]);

  const st = batchState(b);
  const meta = STATE_META[st];
  const stats = batchStats(getCachedDiff(cwd, b.id));
  const revertable = b.files.filter((f) => f.live === "same");

  return (
    <div className="relative mb-1.5">
      {!last && <span className="absolute bottom-1 left-[15px] top-6 w-px bg-(--tmd-border)" aria-hidden />}

      {/* 批头 → 审阅单 */}
      <button
        type="button"
        className="relative z-[1] flex w-full items-start gap-2 rounded-(--tmd-radius-sm) px-2.5 py-1.5 text-left hover:bg-(--tmd-bg-hover)"
        title={
          `点击审阅该批(用户消息 + 文件 diff) · ${formatAbsolute(b.ts)} 发起` +
          (b.tsEnd ? ` · ${formatAbsolute(b.tsEnd)} 封口` : "")
        }
        onClick={() =>
          openBatchTab({ cwd, sessionId, tmdSessionId, batchId: b.id, title: `批次 #${b.index}` })
        }
      >
        <span
          className={`mt-0.5 h-3 w-3 flex-none rounded-full border-2 border-(--tmd-border-strong) ${st === "open" ? "animate-pulse" : ""}`}
          style={{ borderColor: meta.dot, background: st === "done" ? "transparent" : meta.dot }}
          aria-hidden
        />
        <span className="min-w-0 flex-1">
          {/* 批次标题:text-xs 基准对齐面板体系(此前继承根字号 16px,偏大) */}
          <span className="flex items-baseline gap-1.5 overflow-hidden whitespace-nowrap text-xs">
            <span className="flex-none text-[11px] text-(--tmd-fg-faint)">#{b.index}</span>
            <span
              className={`truncate font-medium ${st === "reverted" ? "text-(--tmd-fg-faint) line-through" : "text-(--tmd-fg)"}`}
            >
              {b.prompt.split("\n")[0]}
            </span>
          </span>
          <span className="mt-px flex items-center gap-1.5 overflow-hidden whitespace-nowrap text-[11px] text-(--tmd-fg-faint)">
            <span className="flex-none">{b.files.length} 文件</span>
            {stats && (
              <span className="flex-none font-mono">
                <span className="text-(--tmd-diff-inserted)">+{stats.ins}</span>{" "}
                <span className="text-(--tmd-diff-removed)">−{stats.del}</span>
              </span>
            )}
            <span className={`flex-none rounded-full px-1.5 text-[10px] font-semibold leading-[14px] ${meta.chip}`} title={b.attribution === "events" ? "归因:AI 写入事件流(账本只记 CLI 声称写过的文件)" : "归因:窗口内 git 变更推断(该 CLI 未声明写入事件检测,可能有误差)"}>
              {meta.label}
              {st === "done" && b.doneReason ? ` · ${b.doneReason}` : ""}
            </span>
            {b.attribution === "git" && !b.open && (
              <span
                className="flex-none rounded border border-dashed border-(--tmd-border-strong) px-1 text-[9px] leading-[13px] text-(--tmd-fg-faint)"
                title="该 CLI 未声明写入事件检测:批次由 git 变更推断,可能混入手改"
              >
                推断
              </span>
            )}
            {(b.engine || b.model) && (
              <span
                className="min-w-0 truncate text-[10px]"
                title={[b.engine, b.model, b.thinking ? `思考 ${b.thinking}` : ""].filter(Boolean).join(" · ")}
              >
                {b.engine}
                {b.engine && b.model ? " · " : ""}
                {b.model}
              </span>
            )}
            <span className="ml-auto flex-none" title={formatAbsolute(b.ts)}>
              {formatRelativeTime(b.ts)}
            </span>
          </span>
        </span>
      </button>

      {/* 文件行 → 审阅单深链 */}
      <div className="ml-8 mt-px">
        {b.files.map((f) => (
          <FileRow
            key={f.path}
            file={f}
            batch={b}
            cwd={cwd}
            sessionId={sessionId}
            tmdSessionId={tmdSessionId}
            busy={busy}
            setConfirm={setConfirm}
          />
        ))}
      </div>

      {/* 批尾动作 */}
      <div className="ml-8 mb-2 mt-0.5 flex items-center gap-1.5">
        {st === "pending" && (
          <button
            type="button"
            disabled={busy}
            className="flex h-[21px] flex-none items-center gap-1 rounded border border-(--tmd-diff-inserted)/40 px-2 text-[10px] text-(--tmd-diff-inserted) hover:bg-(--tmd-diff-inserted)/10 disabled:opacity-40"
            title="标记本批已审阅(纯标记,不影响任何文件)"
            onClick={() => void onApprove(b.id)}
          >
            <Check size={10} aria-hidden /> 通过
          </button>
        )}
        {(st === "pending" || st === "approved") && revertable.length > 0 && (
          <button
            type="button"
            disabled={busy}
            className="flex h-[21px] flex-none items-center gap-1 rounded border border-[rgba(167,139,250,.4)] px-2 text-[10px] text-[#a78bfa] hover:bg-[#a78bfa]/10 disabled:opacity-40"
            onClick={() => setConfirm({ batchId: b.id, paths: revertable.map((f) => f.path) })}
          >
            <RotateCcw size={10} aria-hidden /> 回退整批({revertable.length})
          </button>
        )}
        {st === "reverted" && (
          <button
            type="button"
            disabled={busy}
            className="flex h-[21px] flex-none items-center gap-1 rounded border border-(--tmd-diff-inserted)/40 px-2 text-[10px] text-(--tmd-diff-inserted) hover:bg-(--tmd-diff-inserted)/10 disabled:opacity-40"
            title="按账本副本把这轮改动精确写回(live 已偏离批前像的文件跳过,绝不覆盖)"
            onClick={() => setConfirm({ batchId: b.id, mode: "apply" })}
          >
            <Zap size={10} aria-hidden /> 应用回此批
          </button>
        )}
        {st === "reverted" && b.guardId && (
          <button
            type="button"
            disabled={busy}
            className="flex h-[21px] flex-none items-center gap-1 rounded border border-(--tmd-border) px-2 text-[10px] text-(--tmd-fg-subtle) hover:bg-(--tmd-bg-hover) disabled:opacity-40"
            onClick={() => void onUndo(b.id)}
          >
            <Undo2 size={10} aria-hidden /> 反悔 · 恢复回来
          </button>
        )}
        <span className="truncate text-[10px] text-(--tmd-fg-faint)">
          {st === "open"
            ? "进行中 —— 本轮对话结算后自动封口进入待审"
            : st === "done"
              ? "已处理 —— 无需操作"
              : st === "approved"
                ? "已通过 —— 仅标记,改动仍在工作区"
                : st === "reverted"
                  ? "已回退 · 恢复点留存"
                  : "回退前自动打恢复点"}
        </span>
      </div>

      {/* 动作确认(内联卡;回退/应用共用,镜像文案) */}
      {confirm && <ConfirmCard batchId={b.id} confirm={confirm} busy={busy} setConfirm={setConfirm} onRevert={onRevert} onApply={onApply} />}
    </div>
  );
}

function ConfirmCard({
  batchId,
  confirm,
  busy,
  setConfirm,
  onRevert,
  onApply,
}: {
  batchId: string;
  confirm: ConfirmTarget;
  busy: boolean;
  setConfirm: (v: ConfirmTarget | null) => void;
  onRevert: (batchId: string, paths?: string[]) => Promise<void>;
  onApply: (batchId: string) => Promise<void>;
}) {
  const apply = confirm.mode === "apply";
  return (
    <div className="ml-8 mb-2 rounded-(--tmd-radius-sm) border border-(--tmd-border-strong) bg-(--tmd-bg-popover) p-2.5">
      <div className="mb-1 text-xs font-semibold">
        {apply
          ? "应用回此批"
          : `回退${confirm.paths ? `${confirm.paths.length} 个路径` : "整批"}`}
      </div>
      <div className="mb-2 text-[11px] leading-relaxed text-(--tmd-fg-muted)">
        {apply ? (
          <>
            按账本副本把这轮改动精确写回磁盘(回退的镜像);
            <span className="text-(--tmd-diff-inserted)">执行前已自动打恢复点,可反悔</span>。
            live 已偏离批前像的文件会跳过,绝不静默覆盖。
          </>
        ) : (
          <>
            改动将还原到这轮消息发出之前;
            <span className="text-(--tmd-diff-inserted)">回退前已自动打恢复点,可反悔</span>。
            内容已变的文件会被跳过,绝不静默覆盖。
          </>
        )}
      </div>
      <div className="flex justify-end gap-1.5">
        <button
          type="button"
          className="h-6 rounded border border-(--tmd-border) px-2 text-(--tmd-fg-muted) hover:bg-(--tmd-bg-hover)"
          onClick={() => setConfirm(null)}
        >
          取消
        </button>
        <button
          type="button"
          disabled={busy}
          className={
            apply
              ? "h-6 rounded border border-(--tmd-diff-inserted)/50 px-2 text-(--tmd-diff-inserted) hover:bg-(--tmd-diff-inserted)/10 disabled:opacity-40"
              : "h-6 rounded border border-[rgba(167,139,250,.5)] px-2 text-[#a78bfa] hover:bg-[#a78bfa]/10 disabled:opacity-40"
          }
          onClick={() =>
            apply ? void onApply(batchId) : void onRevert(batchId, confirm.paths)
          }
        >
          {apply ? "确认应用" : "确认回退"}
        </button>
      </div>
    </div>
  );
}

function FileRow({
  file: f,
  batch: b,
  cwd,
  sessionId,
  tmdSessionId,
  busy,
  setConfirm,
}: {
  file: CkptBatchFile;
  batch: CkptBatch;
  cwd: string;
  sessionId: string;
  tmdSessionId?: string;
  busy: boolean;
  setConfirm: (v: ConfirmTarget | null) => void;
}) {
  const canRevert = b.state === "pending" && f.live === "same";
  const segs = f.path.split("/");
  const name = segs.pop() ?? f.path;
  const dir = segs.length ? segs.join("/") + "/" : "";
  const patches = getCachedDiff(cwd, b.id);
  const mine = patches?.find((p) => p.path === f.path);
  return (
    <div className="group flex h-[25px] items-center gap-1.5 rounded px-1.5 hover:bg-(--tmd-bg-hover)">
      <button
        type="button"
        className="flex h-full min-w-0 flex-1 items-center gap-1.5 text-left"
        title="点击在编辑区查看该文件 diff"
        onClick={() =>
          openBatchTab({
            cwd,
            sessionId,
            tmdSessionId,
            batchId: b.id,
            title: `批次 #${b.index}`,
            focusPath: f.path,
          })
        }
      >
        <span
          className={`grid h-[14px] w-[14px] flex-none place-items-center rounded text-[10px] font-bold ${fileChipCls(f.status)}`}
        >
          {f.status}
        </span>
        <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-(--tmd-fg-muted)">
          <b className="font-medium text-(--tmd-fg)">{name}</b>{" "}
          <span className="text-(--tmd-fg-faint)">{dir}</span>
        </span>
        {mine && (
          <span className="flex-none font-mono text-[10px]">
            <span className="text-(--tmd-diff-inserted)">+{mine.additions}</span>{" "}
            <span className="text-(--tmd-diff-removed)">−{mine.deletions}</span>
          </span>
        )}
        {f.reverted && (
          <span className="flex-none rounded border border-dashed border-[#a78bfa] px-1 text-[10px] leading-[14px] text-[#a78bfa]">
            已退
          </span>
        )}
        {f.stale && (
          <span
            className="flex-none rounded border border-dashed border-(--tmd-fg-faint) px-1 text-[10px] leading-[14px] text-(--tmd-fg-faint)"
            title="工作区内容已偏离本批后像,不可回退,仅可对照"
          >
            内容已变
          </span>
        )}
      </button>
      {canRevert && (
        <button
          type="button"
          disabled={busy}
          className="hidden h-[19px] w-[19px] flex-none place-items-center rounded text-(--tmd-fg-subtle) group-hover:grid hover:bg-[#a78bfa]/15 hover:text-[#a78bfa] disabled:opacity-40"
          title="只回退这个文件"
          onClick={() => setConfirm({ batchId: b.id, paths: [f.path] })}
        >
          <RotateCcw size={11} aria-hidden />
        </button>
      )}
    </div>
  );
}
