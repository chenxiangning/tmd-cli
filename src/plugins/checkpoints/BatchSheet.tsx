/**
 * BatchSheet —— 中央「批审阅单」tab(spec §4,editorCenter.tabContent 挂载)。
 *
 * 一批一个 tab:用户消息全文卡 + "AI 修改的文件"分区列表(各自 unified diff,
 * 默认展开可折叠);文件行深链滚动到分区并高亮。
 * 会话严格绑定:清单按 payload 里的 (cwd, sessionId) 取 —— 会话切换/结束后,
 * 旧审阅单显示"已随会话结束"。
 * 动作同面板:回退唯一(整批/单文件,带确认),done 无操作。
 * 非 ckpt-batch kind 的 tab 返回 null —— 每种 kind 的渲染由各自插件负责。
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronRight, Loader2, RotateCcw } from "lucide-react";
import { useEditorTabs } from "@kernel/tabs";
import { formatAbsolute, formatRelativeTime } from "@kernel/relativeTime";
import type { CkptBatch, CkptPatch } from "@kernel/ipc";
import { approveBatch, getCachedDiff, loadDiff, refreshBatches, refreshOpenDiff, revertBatch, useCkptVersion, useCkptBatches } from "./store";
import { readBatchPayload } from "./batchTab";

/** 轮耗时短语(锚点 → 封口);秒取整,分段到时。 */
function formatDuration(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s} 秒`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} 分 ${s % 60} 秒`;
  return `${Math.floor(m / 60)} 小时 ${m % 60} 分`;
}

export function BatchSheetTabContent() {
  const { activeId, tabs } = useEditorTabs();
  const active = tabs.find((t) => t.id === activeId);
  const payload = active ? readBatchPayload(active) : null;
  if (!active || !payload) return null;
  return (
    <BatchSheet
      key={`${payload.sessionId}:${payload.batchId}`}
      cwd={payload.cwd}
      sessionId={payload.sessionId}
      tmdSessionId={payload.tmdSessionId}
      batchId={payload.batchId}
      focusPath={payload.focusPath}
    />
  );
}

function BatchSheet({
  cwd,
  sessionId,
  tmdSessionId,
  batchId,
  focusPath,
}: {
  cwd: string;
  sessionId: string;
  tmdSessionId?: string;
  batchId: string;
  focusPath?: string;
}) {
  useCkptVersion();
  const { batches, notARepo } = useCkptBatches(cwd, sessionId);
  const batch = batches.find((b) => b.id === batchId);
  useEffect(() => {
    // 审阅单挂载即拉该批 patch(与时间线共享缓存)
    loadDiff(cwd, batchId);
    // open 批新像 = live 工作区:轮内改动要跟进,定时强刷直到封口
    if (!batch?.open) return;
    const timer = window.setInterval(() => refreshOpenDiff(cwd, batchId), 6000);
    return () => window.clearInterval(timer);
  }, [cwd, batchId, batch?.open]);

  if (notARepo) {
    return <Center>该工作区不是 git 仓库,无审批数据</Center>;
  }
  if (!batch) {
    return <Center>批次不存在或已随会话结束(审批线生命周期 = 单个会话)</Center>;
  }
  return (
    <SheetBody
      cwd={cwd}
      sessionId={sessionId}
      tmdSessionId={tmdSessionId}
      batch={batch}
      focusPath={focusPath}
    />
  );
}

function SheetBody({
  cwd,
  sessionId,
  tmdSessionId,
  batch,
  focusPath,
}: {
  cwd: string;
  sessionId: string;
  tmdSessionId?: string;
  batch: CkptBatch;
  focusPath?: string;
}) {
  useCkptVersion();
  const patches = getCachedDiff(cwd, batch.id) ?? null;
  const scrollRef = useRef<HTMLDivElement>(null);
  const [confirmPath, setConfirmPath] = useState<"all" | string | null>(null);
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState<string | null>(focusPath ?? null);

  // 深链定位:滚动到目标分区并高亮
  useEffect(() => {
    if (!focusPath || !patches) return;
    const el = scrollRef.current?.querySelector<HTMLElement>(`[data-file="${CSS.escape(focusPath)}"]`);
    if (el) {
      el.scrollIntoView({ block: "center" });
      setFlash(focusPath);
      const timer = window.setTimeout(() => setFlash(null), 1400);
      return () => window.clearInterval(timer);
    }
  }, [focusPath, patches]);

  async function doApprove() {
    setBusy(true);
    try {
      await approveBatch(cwd, batch.id);
    } finally {
      setBusy(false);
      void refreshBatches(cwd, sessionId, tmdSessionId);
    }
  }

  async function doRevert(paths?: string[]) {
    setBusy(true);
    setConfirmPath(null);
    try {
      await revertBatch(cwd, batch.id, paths);
    } catch {
      /* 错误横幅与时间线共享:此处静默,时间线 notice 已展示同源错误 */
    } finally {
      setBusy(false);
      void refreshBatches(cwd, sessionId, tmdSessionId);
    }
  }

  const revertable = batch.files.filter((f) => f.live === "same");
  const stateLabel = batch.open
    ? "进行中"
    : batch.state === "done"
      ? `已处理 · ${batch.doneReason ?? ""}`
      : batch.state === "approved"
        ? "已通过"
        : batch.state === "reverted"
          ? "已退"
          : "待审";

  return (
    <div className="flex h-full flex-col">
      {/* 工具条 */}
      <div className="flex h-8 flex-none items-center gap-2 border-b border-(--tmd-border) bg-(--tmd-bg-elevated) px-3">
        <span
          className="text-[11px] text-(--tmd-fg-faint)"
          title={`${formatAbsolute(batch.ts)} 发起${batch.tsEnd ? ` · ${formatAbsolute(batch.tsEnd)} 封口` : ""}`}
        >
          批次 #{batch.index} · {stateLabel} · {formatRelativeTime(batch.ts)}
        </span>
        {patches && (
          <span className="font-mono text-[11px]">
            <span className="text-(--tmd-diff-inserted)">
              +{patches.reduce((s, p) => s + p.additions, 0)}
            </span>{" "}
            <span className="text-(--tmd-diff-removed)">
              −{patches.reduce((s, p) => s + p.deletions, 0)}
            </span>
          </span>
        )}
        <span className="flex-1" />
        {batch.state === "pending" && (
          <button
            type="button"
            disabled={busy}
            className="flex h-6 items-center gap-1 rounded border border-(--tmd-diff-inserted)/40 px-2 text-[11px] text-(--tmd-diff-inserted) hover:bg-(--tmd-diff-inserted)/10 disabled:opacity-40"
            title="标记本批已审阅(纯标记,不影响任何文件)"
            onClick={() => void doApprove()}
          >
            <Check size={10} aria-hidden /> 通过
          </button>
        )}
        {(batch.state === "pending" || batch.state === "approved") && revertable.length > 0 && (
          <button
            type="button"
            disabled={busy}
            className="flex h-6 items-center gap-1 rounded border border-[rgba(167,139,250,.4)] px-2 text-[11px] text-[#a78bfa] hover:bg-[#a78bfa]/10 disabled:opacity-40"
            onClick={() => setConfirmPath("all")}
          >
            <RotateCcw size={10} aria-hidden /> 回退整批({revertable.length})
          </button>
        )}
      </div>

      {confirmPath && (
        <div className="flex flex-none items-center gap-3 border-b border-(--tmd-border-strong) bg-(--tmd-bg-popover) px-3 py-1.5 text-[11px]">
          <span className="text-(--tmd-fg-muted)">
            确认回退{confirmPath === "all" ? `整批(${revertable.length} 文件)` : confirmPath}?
            恢复点自动留存。
          </span>
          <button
            type="button"
            className="rounded border border-(--tmd-border) px-2 py-0.5 text-(--tmd-fg-muted) hover:bg-(--tmd-bg-hover)"
            onClick={() => setConfirmPath(null)}
          >
            取消
          </button>
          <button
            type="button"
            disabled={busy}
            className="rounded border border-[rgba(167,139,250,.5)] px-2 py-0.5 text-[#a78bfa] hover:bg-[#a78bfa]/10 disabled:opacity-40"
            onClick={() => void doRevert(confirmPath === "all" ? undefined : [confirmPath])}
          >
            确认回退
          </button>
        </div>
      )}

      {/* 审阅单 */}
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
        {!patches ? (
          <div className="flex items-center justify-center gap-2 pt-10 text-(--tmd-fg-faint)">
            <Loader2 size={13} className="animate-spin" aria-hidden /> 生成批 diff…
          </div>
        ) : (
          <>
            {/* 账本随批固化的元信息:引擎/模型/思考 + 精确时刻 + 轮耗时(空段隐藏) */}
            <div className="mb-2 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[11px] text-(--tmd-fg-faint)">
              <span className="flex-none">用户消息</span>
              {batch.engine && (
                <span className="flex-none rounded border border-(--tmd-border) bg-(--tmd-bg-elevated) px-1 text-[10px] leading-[16px] text-(--tmd-fg-muted)">
                  {batch.engine}
                </span>
              )}
              {batch.model && (
                <span className="flex-none font-mono text-(--tmd-fg-muted)">{batch.model}</span>
              )}
              {batch.thinking && (
                <span className="flex-none">
                  思考 <span className="font-mono text-(--tmd-fg-muted)">{batch.thinking}</span>
                </span>
              )}
              <span className="flex-none">
                {formatAbsolute(batch.ts)}
                <span className="ml-1.5">({formatRelativeTime(batch.ts)})</span>
              </span>
              {batch.tsEnd != null && batch.tsEnd > batch.ts && (
                <span className="flex-none">耗时 {formatDuration(batch.tsEnd - batch.ts)}</span>
              )}
            </div>
            <div className="whitespace-pre-wrap break-words rounded-r border-l-2 border-(--tmd-accent) bg-(--tmd-bg-hover) px-3.5 py-2.5 text-[13px] leading-relaxed text-(--tmd-fg)">
              {batch.prompt}
            </div>

            <div className="mb-2 mt-5 text-[11px] text-(--tmd-fg-faint)">
              AI 修改的文件({batch.files.length}) —— 点击分区头折叠;hover 可单文件回退
            </div>
            {patches.length === 0 && (
              <div className="rounded border border-dashed border-(--tmd-border) p-4 text-center text-[11px] text-(--tmd-fg-faint)">
                本批文件当前与批后像无差异(可能已回退或已提交)
              </div>
            )}
            {batch.files.map((f) => (
              <FileSection
                key={f.path}
                path={f.path}
                status={f.status}
                stale={f.stale}
                reverted={f.reverted}
                canRevert={batch.state === "pending" && f.live === "same"}
                patch={patches.find((p) => p.path === f.path) ?? null}
                flashed={flash === f.path}
                busy={busy}
                onRevert={() => setConfirmPath(f.path)}
              />
            ))}
          </>
        )}
      </div>
    </div>
  );
}

function FileSection({
  path,
  status,
  stale,
  reverted,
  canRevert,
  patch,
  flashed,
  busy,
  onRevert,
}: {
  path: string;
  status: string;
  stale: boolean;
  reverted: boolean;
  canRevert: boolean;
  patch: CkptPatch | null;
  flashed: boolean;
  busy: boolean;
  onRevert: () => void;
}) {
  const [open, setOpen] = useState(true);
  const segs = path.split("/");
  const name = segs.pop() ?? path;
  const dir = segs.length ? segs.join("/") + "/" : "";
  const chipCls =
    status === "A"
      ? "bg-(--tmd-diff-inserted)/15 text-(--tmd-diff-inserted)"
      : status === "D"
        ? "bg-(--tmd-diff-removed)/15 text-(--tmd-diff-removed)"
        : "bg-(--tmd-git-modified)/15 text-(--tmd-git-modified)";
  const lines = useMemo(() => patch?.patch.split("\n") ?? [], [patch]);
  return (
    <div
      data-file={path}
      className={`mb-2 overflow-hidden rounded border ${flashed ? "border-(--tmd-accent)" : "border-(--tmd-border)"}`}
    >
      <div className="group flex h-[30px] items-center gap-2 bg-(--tmd-bg-elevated) px-2.5 hover:bg-(--tmd-bg-hover)">
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
          onClick={() => setOpen((v) => !v)}
        >
          <ChevronRight
            size={12}
            aria-hidden
            className={`flex-none text-(--tmd-fg-faint) transition-transform ${open ? "rotate-90" : ""}`}
          />
          <span className={`grid h-[15px] w-[15px] flex-none place-items-center rounded text-[10px] font-bold ${chipCls}`}>
            {status}
          </span>
          <span className="min-w-0 truncate font-mono text-[11px]">
            <b className="font-medium text-(--tmd-fg)">{name}</b>{" "}
            <span className="text-(--tmd-fg-faint)">{dir}</span>
          </span>
          {reverted && (
            <span className="flex-none rounded border border-dashed border-[#a78bfa] px-1 text-[10px] leading-[14px] text-[#a78bfa]">
              已退
            </span>
          )}
          {stale && (
            <span
              className="flex-none rounded border border-dashed border-(--tmd-fg-faint) px-1 text-[10px] leading-[14px] text-(--tmd-fg-faint)"
              title="工作区内容已偏离本批后像,不可回退,仅可对照"
            >
              内容已变
            </span>
          )}
          {patch && (
            <span className="flex-none font-mono text-[10px]">
              <span className="text-(--tmd-diff-inserted)">+{patch.additions}</span>{" "}
              <span className="text-(--tmd-diff-removed)">−{patch.deletions}</span>
            </span>
          )}
        </button>
        {canRevert && (
          <button
            type="button"
            disabled={busy}
            className="hidden h-5 flex-none items-center gap-1 rounded border border-(--tmd-border) px-1.5 text-[10px] text-(--tmd-fg-subtle) hover:border-[rgba(167,139,250,.5)] hover:text-[#a78bfa] group-hover:flex disabled:opacity-40"
            onClick={onRevert}
          >
            <RotateCcw size={10} aria-hidden /> 只回退此文件
          </button>
        )}
      </div>
      {open && patch && (
        <pre className="overflow-x-auto bg-(--tmd-bg-base) p-2.5 font-mono text-[11px] leading-[1.6]">
          {lines.map((line, i) => {
            const cls = line.startsWith("@@")
              ? "text-(--tmd-accent)/75"
              : line.startsWith("+")
                ? "bg-(--tmd-diff-inserted)/10 text-(--tmd-diff-inserted)"
                : line.startsWith("-")
                  ? "bg-(--tmd-diff-removed)/10 text-(--tmd-diff-removed)"
                  : "text-(--tmd-fg-subtle)";
            return (
              <span key={i} className={`${cls} block whitespace-pre`}>
                {line || " "}
              </span>
            );
          })}
        </pre>
      )}
    </div>
  );
}

function Center({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full items-center justify-center px-6 text-center text-xs text-(--tmd-fg-faint)">
      {children}
    </div>
  );
}
