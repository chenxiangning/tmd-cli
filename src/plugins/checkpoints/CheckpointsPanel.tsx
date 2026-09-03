/**
 * CheckpointsPanel —— 右栏「审批线」时间线(spec §4,D 主形态)。
 *
 * 生命周期严格绑定单个会话:清单由后端按 sessionId 推导,新会话从零开始,
 * 历史批次不跨会话可见(不允许扩散)。cwd 取活跃 workspace(与 git/files
 * 面板同模式);仅当活跃会话属于该工作区时展示其审批线。
 * 动作极简:回退是唯一动作(带确认),done 全自动(提交/失配),无保留按钮。
 */

import { useEffect, useReducer, useState } from "react";
import { Check, History, Loader2, RotateCcw, Undo2 } from "lucide-react";
import { host } from "@kernel/host";
import { KernelTopics } from "@kernel/events";
import { useWorkspaces } from "@kernel/workspace";
import { formatAbsolute, formatRelativeTime } from "@kernel/relativeTime";
import type { CkptBatch, CkptBatchFile, CkptPatch } from "@kernel/ipc";
import { checkpointIdentity } from "./identity";
import {
  approveBatch,
  getCachedDiff,
  loadDiff,
  pruneRetention,
  refreshBatches,
  refreshOpenDiff,
  revertBatch,
  undoRevertBatch,
  useCkptBatches,
} from "./store";
import { openBatchTab } from "./batchTab";

const POLL_MS = 6000;

/* 状态色走主题 token(随 preset 联动);紫 = 回退语义色(与文件树 git-r 一致,无 token) */
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

export function CheckpointsPanel() {
  const { list, activeId } = useWorkspaces();
  const active = list.find((w) => w.id === activeId) ?? list[0];
  const cwd = active?.root ?? null;
  /* 会话严格绑定:只认当前活跃会话(审批线生命周期 = 单个会话);不再要求
     session.cwd === 工作区 root —— 锚点写入用 session.cwd,Rust 侧按键
     精确匹配,跨工作区查询天然返回空,而会话 cwd 是工作区子目录时旧守卫
     会把本可命中的批次整批隐藏。
     读写都以 CLI 磁盘身份为准(账本按其落盘),身份统一经 identity.ts 仲裁:
     cli 身份被多个活会话争持(绑定竞态)时先创建者保留、后到者回退 tmd id,
     新会话不再看到老会话的审批线;首条 prompt 时身份常未绑上(锚点暂记
     tmd id 名下),查询把 tmd id 作为副键一并命中,后端自动回填。 */
  const [, bumpRender] = useReducer((x: number) => x + 1, 0);
  useEffect(() => {
    const offs = [
      host.events.on(KernelTopics.activeSessionChanged, bumpRender),
      host.events.on(KernelTopics.sessionsChanged, bumpRender),
    ];
    return () => offs.forEach((off) => off());
  }, []);

  const activeSessionId = host.getActiveSessionId();
  const identity = activeSessionId ? checkpointIdentity(activeSessionId) : null;
  const sessionId = identity && cwd ? identity.key : null;
  const tmdSessionId = activeSessionId ?? undefined;

  const state = useCkptBatches(cwd, sessionId);
  const [confirm, setConfirm] = useState<{ batchId: string; paths?: string[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!cwd) return;
    pruneRetention(cwd);
    if (!sessionId) return;
    void refreshBatches(cwd, sessionId, tmdSessionId);
    const timer = window.setInterval(() => void refreshBatches(cwd, sessionId, tmdSessionId), POLL_MS);
    return () => window.clearInterval(timer);
  }, [cwd, sessionId, tmdSessionId]);

  const pendingCount = state.batches.filter((b) => batchState(b) === "pending").length;

  async function doApprove(batchId: string) {
    if (!cwd || !sessionId) return;
    setBusy(true);
    try {
      await approveBatch(cwd, batchId);
      setNotice("批次已标记通过 —— 仅记录状态,不影响任何文件");
    } catch (e) {
      setNotice(String(e).replace(/^E_\w+:\s*/, ""));
    } finally {
      setBusy(false);
      void refreshBatches(cwd, sessionId, tmdSessionId);
    }
  }

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
      void refreshBatches(cwd, sessionId, tmdSessionId);
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
      void refreshBatches(cwd, sessionId, tmdSessionId);
    }
  }

  return (
    <div className="flex h-full flex-col bg-(--tmd-bg-base)">
      {/* 摘要行 —— 字号对齐面板体系(11px 为主),项目名用扁平标签非胶囊 */}
      <div className="flex h-[30px] flex-none items-center gap-2 border-b border-(--tmd-border) bg-(--tmd-bg-elevated) px-2.5 text-[11px]">
        <span className="flex flex-none items-center gap-1.5 text-[11px] font-semibold text-(--tmd-fg)">
          <History size={12} className="text-(--tmd-accent)" aria-hidden />
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
          待审 <b className="font-semibold text-(--tmd-git-modified)">{pendingCount}</b>
        </span>
      </div>

      {notice && (
        <button
          type="button"
          className="flex-none border-b border-(--tmd-border) bg-(--tmd-accent)/10 px-3 py-1.5 text-left text-[11px] text-(--tmd-fg-muted) hover:underline"
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
              onApprove={doApprove}
              onRevert={doRevert}
              onUndo={doUndo}
              cwd={cwd}
              sessionId={sessionId}
              tmdSessionId={tmdSessionId}
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
  onApprove,
  onRevert,
  onUndo,
  cwd,
  sessionId,
  tmdSessionId,
}: {
  batch: CkptBatch;
  last: boolean;
  busy: boolean;
  confirm: { batchId: string; paths?: string[] } | null;
  setConfirm: (v: { batchId: string; paths?: string[] } | null) => void;
  onApprove: (batchId: string) => Promise<void>;
  onRevert: (batchId: string, paths?: string[]) => Promise<void>;
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
            <span className={`flex-none rounded-full px-1.5 text-[10px] font-semibold leading-[14px] ${meta.chip}`}>
              {meta.label}
              {st === "done" && b.doneReason ? ` · ${b.doneReason}` : ""}
            </span>
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

      {/* 回退确认(内联卡) */}
      {confirm && (
        <div className="ml-8 mb-2 rounded-(--tmd-radius-sm) border border-(--tmd-border-strong) bg-(--tmd-bg-popover) p-2.5">
          <div className="mb-1 text-xs font-semibold">
            回退{confirm.paths ? `${confirm.paths.length} 个路径` : "整批"}
          </div>
          <div className="mb-2 text-[11px] leading-relaxed text-(--tmd-fg-muted)">
            改动将还原到这轮消息发出之前;
            <span className="text-(--tmd-diff-inserted)">回退前已自动打恢复点,可反悔</span>。
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
