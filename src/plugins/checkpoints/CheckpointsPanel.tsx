/**
 * CheckpointsPanel —— 右栏「审批线」时间线(spec §4,D 主形态)。
 *
 * 生命周期严格绑定单个会话:清单由后端按 sessionId 推导,新会话从零开始,
 * 历史批次不跨会话可见(不允许扩散)。cwd 取活跃 workspace(与 git/files
 * 面板同模式);仅当活跃会话属于该工作区时展示其审批线。
 * 动作极简:回退是唯一动作(带确认),done 全自动(提交/失配),无保留按钮。
 */

import { useEffect, useState } from "react";
import { History, Loader2, RotateCcw, Undo2 } from "lucide-react";
import { host } from "@kernel/host";
import { useWorkspaces } from "@kernel/workspace";
import { formatRelativeTime } from "@kernel/relativeTime";
import type { CkptBatch, CkptBatchFile, CkptPatch } from "@kernel/ipc";
import {
  getCachedDiff,
  loadDiff,
  refreshBatches,
  revertBatch,
  undoRevertBatch,
  useCkptBatches,
} from "./store";
import { openBatchTab } from "./batchTab";

const POLL_MS = 6000;

const STATE_META = {
  open: { label: "进行中", dot: "#007acc", chip: "bg-[#007acc]/20 text-[#7ec3f0]" },
  pending: { label: "待审", dot: "#facc20", chip: "bg-[#facc20]/10 text-[#facc20]" },
  reverted: { label: "已退", dot: "#a78bfa", chip: "bg-[#a78bfa]/15 text-[#a78bfa]" },
  done: { label: "已处理", dot: "#9d9d9d", chip: "bg-[#9d9d9d]/15 text-[#9d9d9d]" },
} as const;

type BatchStateKey = keyof typeof STATE_META;

function batchState(b: CkptBatch): BatchStateKey {
  return b.open ? "open" : b.state;
}

function fileChipCls(st: string): string {
  if (st === "A") return "bg-[#4ade80]/15 text-[#4ade80]";
  if (st === "D") return "bg-[#f87171]/15 text-[#f87171]";
  return "bg-[#facc20]/15 text-[#facc20]";
}

/** 批 ± 汇总(来自懒加载 patch;未加载/open 批返回 null,UI 显示占位)。 */
function batchStats(patches: CkptPatch[] | undefined): { ins: number; del: number } | null {
  if (!patches) return null;
  return {
    ins: patches.reduce((s, p) => s + p.additions, 0),
    del: patches.reduce((s, p) => s + p.deletions, 0),
  };
}

export function CheckpointsPanel() {
  const { list, activeId } = useWorkspaces();
  const active = list.find((w) => w.id === activeId) ?? list[0];
  const cwd = active?.root ?? null;
  /* 会话严格绑定:只认属于当前工作区的活跃会话(审批线生命周期 = 单个会话) */
  const activeSessionId = host.getActiveSessionId();
  const activeSession = host.getSessions().find((s) => s.id === activeSessionId);
  const sessionId = activeSession && cwd && activeSession.cwd === cwd ? activeSessionId : null;

  const state = useCkptBatches(cwd, sessionId);
  const [confirm, setConfirm] = useState<{ batchId: string; paths?: string[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!cwd || !sessionId) return;
    void refreshBatches(cwd, sessionId);
    const timer = window.setInterval(() => void refreshBatches(cwd, sessionId), POLL_MS);
    return () => window.clearInterval(timer);
  }, [cwd, sessionId]);

  const pendingCount = state.batches.filter((b) => batchState(b) === "pending").length;

  async function doRevert(batchId: string, paths?: string[]) {
    if (!cwd || !sessionId) return;
    setBusy(true);
    setConfirm(null);
    try {
      const out = await revertBatch(cwd, batchId, paths);
      const n = out.restored.length + out.deleted.length;
      const skipped = out.skipped.map((s) => `${s.path}(${s.reason})`).join("、");
      setNotice(
        skipped
          ? `已回退 ${n} 个文件;跳过:${skipped}`
          : `已回退 ${n} 个路径 · 恢复点已留存,可反悔`,
      );
    } catch (e) {
      setNotice(String(e).replace(/^E_\w+:\s*/, ""));
    } finally {
      setBusy(false);
      void refreshBatches(cwd, sessionId);
    }
  }

  async function doUndo(batchId: string) {
    if (!cwd || !sessionId) return;
    setBusy(true);
    try {
      const out = await undoRevertBatch(cwd, batchId);
      setNotice(`已从恢复点恢复 ${out.restored.length} 个文件,批次回到待审`);
    } catch (e) {
      setNotice(String(e).replace(/^E_\w+:\s*/, ""));
    } finally {
      setBusy(false);
      void refreshBatches(cwd, sessionId);
    }
  }

  return (
    <div className="flex h-full flex-col bg-(--tmd-bg-base)">
      {/* 摘要行 —— 字号对齐面板体系(11px 为主),项目名用扁平标签非胶囊 */}
      <div className="flex h-[30px] flex-none items-center gap-2 border-b border-(--tmd-border) bg-(--tmd-bg-elevated) px-2.5 text-[11px]">
        <span className="flex flex-none items-center gap-1.5 text-[11px] font-semibold text-(--tmd-fg)">
          <History size={12} className="text-[#007acc]" aria-hidden />
          审批线
        </span>
        {active && (
          <span
            className="max-w-[45%] truncate rounded-(--tmd-radius-sm) border border-(--tmd-border) bg-(--tmd-bg-input) px-1.5 py-px text-[10px] leading-[14px] text-(--tmd-fg-subtle)"
            title={active.root}
          >
            {active.name}
          </span>
        )}
        <span className="flex-1" />
        <span className="flex-none text-(--tmd-fg-faint)">
          待审 <b className="font-semibold text-[#facc20]">{pendingCount}</b>
        </span>
        <span
          className="flex-none cursor-help border-b border-dotted border-(--tmd-fg-faint) text-[10px] text-(--tmd-fg-faint)"
          title="审批线跟随会话生命周期;快照每会话保留最近 100 批、超期 30 天清理"
        >
          100/30 天
        </span>
      </div>

      {notice && (
        <button
          type="button"
          className="flex-none border-b border-(--tmd-border) bg-[#007acc]/10 px-3 py-1.5 text-left text-[11px] text-(--tmd-fg-muted) hover:underline"
          onClick={() => setNotice(null)}
        >
          {notice} · 点击关闭
        </button>
      )}

      {/* 时间线 */}
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {!cwd ? (
          <Empty text="暂无活跃工作区" />
        ) : !sessionId ? (
          <Empty text="审批线跟随会话生命周期 —— 当前工作区没有活会话" />
        ) : state.notARepo ? (
          <Empty text="该工作区不是 git 仓库 —— 审批线目前仅支持 git 工作区" />
        ) : state.loading && state.batches.length === 0 ? (
          <div className="flex items-center justify-center gap-2 pt-10 text-(--tmd-fg-faint)">
            <Loader2 size={13} className="animate-spin" aria-hidden /> 读取批次…
          </div>
        ) : state.batches.length === 0 ? (
          <Empty text="本会话还没有批次 —— 发送一条让 AI 改文件的消息后,这里会按轮归批" />
        ) : (
          state.batches.map((b, i) => (
            <BatchRow
              key={b.id}
              batch={b}
              last={i === state.batches.length - 1}
              busy={busy}
              confirm={confirm?.batchId === b.id ? confirm : null}
              setConfirm={setConfirm}
              onRevert={doRevert}
              onUndo={doUndo}
              cwd={cwd}
              sessionId={sessionId}
            />
          ))
        )}
      </div>
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return (
    <div className="px-4 pt-10 text-center text-[11px] leading-relaxed text-(--tmd-fg-faint)">
      {text}
    </div>
  );
}

function BatchRow({
  batch: b,
  last,
  busy,
  confirm,
  setConfirm,
  onRevert,
  onUndo,
  cwd,
  sessionId,
}: {
  batch: CkptBatch;
  last: boolean;
  busy: boolean;
  confirm: { batchId: string; paths?: string[] } | null;
  setConfirm: (v: { batchId: string; paths?: string[] } | null) => void;
  onRevert: (batchId: string, paths?: string[]) => Promise<void>;
  onUndo: (batchId: string) => Promise<void>;
  cwd: string;
  sessionId: string;
}) {
  // sealed 批懒加载 patch(时间线 ± 用;审阅单共用同一缓存)
  useEffect(() => {
    if (!b.open) loadDiff(cwd, b.id);
  }, [cwd, b.id, b.open]);

  const st = batchState(b);
  const meta = STATE_META[st];
  const stats = batchStats(b.open ? undefined : getCachedDiff(cwd, b.id));
  const revertable = b.files.filter((f) => f.live === "same");

  return (
    <div className="relative mb-1.5">
      {!last && <span className="absolute bottom-1 left-[15px] top-6 w-px bg-(--tmd-border)" aria-hidden />}

      {/* 批头 → 审阅单 */}
      <button
        type="button"
        className="relative z-[1] flex w-full items-start gap-2 rounded-(--tmd-radius-sm) px-2.5 py-1.5 text-left hover:bg-(--tmd-bg-hover)"
        title="点击审阅该批(用户消息 + 文件 diff)"
        onClick={() =>
          openBatchTab({ cwd, sessionId, batchId: b.id, title: `批次 #${b.index}` })
        }
      >
        <span
          className={`mt-0.5 h-3 w-3 flex-none rounded-full border-2 border-[#555] ${st === "open" ? "animate-pulse" : ""}`}
          style={{ borderColor: meta.dot, background: st === "done" ? "transparent" : meta.dot }}
          aria-hidden
        />
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline gap-1.5 overflow-hidden whitespace-nowrap">
            <span className="flex-none text-(--tmd-fg-faint)">#{b.index}</span>
            <span
              className={`truncate ${st === "reverted" ? "text-(--tmd-fg-faint) line-through" : "text-(--tmd-fg)"}`}
            >
              {b.prompt.split("\n")[0]}
            </span>
          </span>
          <span className="mt-px flex items-center gap-1.5 overflow-hidden whitespace-nowrap text-[11px] text-(--tmd-fg-faint)">
            <span className="flex-none">{b.files.length} 文件</span>
            {stats && (
              <span className="flex-none font-mono">
                <span className="text-[#2ea043]">+{stats.ins}</span>{" "}
                <span className="text-[#f85149]">−{stats.del}</span>
              </span>
            )}
            <span className={`flex-none rounded-full px-1.5 text-[9.5px] font-semibold leading-[15px] ${meta.chip}`}>
              {meta.label}
              {st === "done" && b.doneReason ? ` · ${b.doneReason}` : ""}
            </span>
            <span className="ml-auto flex-none">{formatRelativeTime(b.ts)}</span>
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
            busy={busy}
            setConfirm={setConfirm}
          />
        ))}
      </div>

      {/* 批尾动作 */}
      <div className="ml-8 mb-2 mt-0.5 flex items-center gap-1.5">
        {st === "pending" && revertable.length > 0 && (
          <button
            type="button"
            disabled={busy}
            className="flex h-[21px] flex-none items-center gap-1 rounded border border-[rgba(167,139,250,.4)] px-2 text-[10.5px] text-[#a78bfa] hover:bg-[#a78bfa]/10 disabled:opacity-40"
            onClick={() => setConfirm({ batchId: b.id, paths: revertable.map((f) => f.path) })}
          >
            <RotateCcw size={10} aria-hidden /> 回退整批({revertable.length})
          </button>
        )}
        {st === "reverted" && b.guardId && (
          <button
            type="button"
            disabled={busy}
            className="flex h-[21px] flex-none items-center gap-1 rounded border border-(--tmd-border) px-2 text-[10.5px] text-(--tmd-fg-subtle) hover:bg-(--tmd-bg-hover) disabled:opacity-40"
            onClick={() => void onUndo(b.id)}
          >
            <Undo2 size={10} aria-hidden /> 反悔 · 恢复回来
          </button>
        )}
        <span className="truncate text-[10.5px] text-(--tmd-fg-faint)">
          {st === "open"
            ? "进行中 —— 下一条消息发出时自动封口进入待审"
            : st === "done"
              ? "已处理 —— 无需操作"
              : st === "reverted"
                ? "已回退 · 恢复点留存"
                : "回退前自动打恢复点"}
        </span>
      </div>

      {/* 回退确认(内联卡) */}
      {confirm && (
        <div className="ml-8 mb-2 rounded-(--tmd-radius-sm) border border-[#555] bg-(--tmd-bg-popover) p-2.5">
          <div className="mb-1 text-xs font-semibold">
            回退{confirm.paths ? `${confirm.paths.length} 个路径` : "整批"}
          </div>
          <div className="mb-2 text-[11px] leading-relaxed text-(--tmd-fg-muted)">
            改动将还原到这轮消息发出之前;
            <span className="text-[#4ade80]">回退前已自动打恢复点,可反悔</span>。
            内容已变的文件会被跳过,绝不静默覆盖。
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
              className="h-6 rounded border border-[rgba(167,139,250,.5)] px-2 text-[#a78bfa] hover:bg-[#a78bfa]/10 disabled:opacity-40"
              onClick={() => void onRevert(b.id, confirm.paths)}
            >
              确认回退
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function FileRow({
  file: f,
  batch: b,
  cwd,
  sessionId,
  busy,
  setConfirm,
}: {
  file: CkptBatchFile;
  batch: CkptBatch;
  cwd: string;
  sessionId: string;
  busy: boolean;
  setConfirm: (v: { batchId: string; paths?: string[] } | null) => void;
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
            batchId: b.id,
            title: `批次 #${b.index}`,
            focusPath: f.path,
          })
        }
      >
        <span
          className={`grid h-[14px] w-[14px] flex-none place-items-center rounded text-[9.5px] font-bold ${fileChipCls(f.status)}`}
        >
          {f.status}
        </span>
        <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-(--tmd-fg-muted)">
          <b className="font-medium text-(--tmd-fg)">{name}</b>{" "}
          <span className="text-(--tmd-fg-faint)">{dir}</span>
        </span>
        {mine && (
          <span className="flex-none font-mono text-[10.5px]">
            <span className="text-[#2ea043]">+{mine.additions}</span>{" "}
            <span className="text-[#f85149]">−{mine.deletions}</span>
          </span>
        )}
        {f.reverted && (
          <span className="flex-none rounded border border-dashed border-[#a78bfa] px-1 text-[9.5px] leading-[14px] text-[#a78bfa]">
            已退
          </span>
        )}
        {f.stale && (
          <span
            className="flex-none rounded border border-dashed border-(--tmd-fg-faint) px-1 text-[9.5px] leading-[14px] text-(--tmd-fg-faint)"
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
