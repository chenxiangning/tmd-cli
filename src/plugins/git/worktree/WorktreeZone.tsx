/**
 * Git 面板「工作树」常驻区(2026-09-26 worktree 关联管理方案 B):
 * 主仓 / 当前 / 其他 三态卡 = 路径 + 分支 + 脏净增删 + 动作(打开/终端/移除);
 * 现有 WorktreeManageDialog 降级为「+ 新建」入口(panelStore 桥预填)。
 * 数据 = git_worktree_list(active cwd),挂载与 cwd 变化拉取,移除后本地重拉;脏净统计走 git_status 懒加载(每树一次,随卡)。
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowsClockwise, Plus, TerminalWindow, Trash, TreeStructure } from "@phosphor-icons/react";
import { Spinner } from "@kernel/Spinner";
import { ipc, type WorktreeEntry } from "@kernel/ipc";
import { t } from "@kernel/i18n";
import { bumpGitRefresh, useGitPanelState } from "../panelStore";
import { listWorktrees, normalizeRoot, removeWorktreeWithCleanup, spawnTerminalAt, openWorktreeWorkspace } from "./worktreeOps";

/** 单树脏净摘要(git_status files 聚合;加载中 = null;dirty < 0 = 读失败显 —)。 */
interface DirtSummary {
  dirty: number;
  plus: number;
  minus: number;
}

function DirtBadge({ cwd }: { cwd: string }) {
  const [s, setS] = useState<DirtSummary | null>(null);
  useEffect(() => {
    let alive = true;
    ipc
      .gitStatus(cwd)
      .then((st) => {
        if (!alive) return;
        /* 形状防御(与 files/gitDecorate 同源同闸):status files 缺形按空处理,
         * 不让贡献组件三崩熔断整个 Git 面板挂点。 */
        const files = Array.isArray(st?.files) ? st.files : [];
        const plus = files.filter((f) => f.status.includes("A") || f.status.includes("M")).length;
        const minus = files.filter((f) => f.status.includes("D")).length;
        setS({ dirty: files.length, plus, minus });
      })
      .catch(() => alive && setS({ dirty: -1, plus: 0, minus: 0 }));
    return () => {
      alive = false;
    };
  }, [cwd]);
  if (!s) return <Spinner size="0.625rem" className="text-(--tmd-fg-faint)" />;
  if (s.dirty < 0) return <span className="text-meta text-(--tmd-fg-faint)">—</span>;
  if (s.dirty === 0) return <span className="text-meta text-(--tmd-fg-faint)">{t("干净")}</span>;
  return (
    <span className="font-mono text-meta text-(--tmd-warn)">
      ● {s.dirty}
      {s.plus > 0 && <span className="ml-1 text-(--tmd-fg-faint)">+{s.plus}</span>}
      {s.minus > 0 && <span className="ml-1 text-(--tmd-fg-faint)">-{s.minus}</span>}
    </span>
  );
}

/** 卡动作簇(自 TreeCard 拆出降复杂度):主仓无动作;当前树不可打开/移除。 */
function TreeActions({
  entry,
  isMain,
  isCurrent,
  confirming,
  busy,
  onStartConfirm,
  onConfirmRemove,
}: {
  entry: WorktreeEntry;
  isMain: boolean;
  isCurrent: boolean;
  confirming: boolean;
  busy: boolean;
  onStartConfirm: () => void;
  onConfirmRemove: () => void;
}) {
  if (isMain) return <span />;
  if (entry.prunable || isCurrent) return <span />;
  if (confirming) {
    return (
      <button
        type="button"
        disabled={busy}
        onClick={onConfirmRemove}
        className="shrink-0 rounded bg-(--tmd-danger, #e5484d) px-1.5 py-0.5 text-meta text-white disabled:opacity-50"
      >
        {t("确认移除")}
      </button>
    );
  }
  return (
    <span
      /* 动作钮冒泡会连带触发整卡切换,此处截断(键盘 Enter/Space 同理)。 */
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
      className={`flex shrink-0 items-center gap-1 transition-opacity ${
        confirming ? "" : "opacity-0 group-hover:opacity-100 focus-within:opacity-100"
      }`}
    >
      <button
        type="button"
        title={t("打开为工作区")}
        aria-label={t("打开为工作区")}
        onClick={() => openWorktreeWorkspace(entry.path)}
        className="rounded p-1 text-(--tmd-fg-faint) hover:bg-(--tmd-bg-hover) hover:text-(--tmd-fg)"
      >
        <ArrowsClockwise size="0.75rem" data-decor-from="git-worktree" aria-hidden />
      </button>
      <button
        type="button"
        title={t("在此树开终端")}
        aria-label={t("在此树开终端")}
        onClick={() => void spawnTerminalAt(entry.path)}
        className="rounded p-1 text-(--tmd-fg-faint) hover:bg-(--tmd-bg-hover) hover:text-(--tmd-fg)"
      >
        <TerminalWindow size="0.75rem" data-decor-from="git-worktree" aria-hidden />
      </button>
      <button
        type="button"
        title={t("移除 worktree")}
        aria-label={t("移除 worktree")}
        onClick={onStartConfirm}
        className="rounded p-1 text-(--tmd-fg-faint) hover:bg-(--tmd-bg-hover) hover:text-(--tmd-fg)"
      >
        <Trash size="0.75rem" data-decor-from="git-worktree" aria-hidden />
      </button>
    </span>
  );
}

/** 整卡交互属性(react-doctor 复杂度分档):当前树无切换语义;其余卡可点(click)可键盘(Enter/Space),role/tabIndex 补齐可达性。 */
function cardInteractProps(isCurrent: boolean, open: () => void) {
  if (isCurrent) return {};
  return {
    role: "button",
    tabIndex: 0,
    onClick: open,
    onKeyDown: (e: { key: string; preventDefault: () => void }) => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(); }
    },
  };
}

function TreeCard({
  cwd,
  entry,
  isMain,
  isCurrent,
  siblings,
  onChanged,
}: {
  /** git 命令面 cwd = 面板选中仓路径(非被操作树自身)。 */
  cwd: string;
  entry: WorktreeEntry;
  isMain: boolean;
  isCurrent: boolean;
  siblings: readonly WorktreeEntry[];
  onChanged: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");

  const remove = async (): Promise<void> => {
    setBusy(true);
    try {
      const r = await removeWorktreeWithCleanup(cwd, entry, siblings);
      setNote(
        t("已移除 {path}", { path: entry.path }) +
          (r.branchDeleted ? t("(分支 {branch} 已删除)", { branch: entry.branch }) : "") +
          (r.branchKept ? t("(分支 {branch} 未合并,已保留)", { branch: entry.branch }) : ""),
      );
      /* 与弹窗路径同口径:分支三分区/聚合数字随全局刷新重拉(评审 P1)。 */
      bumpGitRefresh();
      onChanged();
    } catch (e) {
      setNote(e instanceof Error ? e.message : String(e));
      setBusy(false);
      return;
    }
    setBusy(false);
  };
  const kindLabel = isMain ? t("主仓") : isCurrent ? t("当前") : entry.prunable ? t("悬空") : "";
  return (
    <div
      {...cardInteractProps(isCurrent, () => void openWorktreeWorkspace(entry.path))}
      title={isCurrent ? t("当前") : t("打开为工作区")}
      className={`group relative overflow-hidden rounded-md border px-2.5 py-2 transition-colors ${
        isCurrent
          ? "border-(--tmd-accent)/50 bg-(--tmd-accent)/10"
          : "cursor-pointer border-(--tmd-border)/60 hover:border-(--tmd-accent)/40 hover:bg-(--tmd-bg-hover)"
      }`}
    >
      {isCurrent && <span aria-hidden className="absolute inset-y-0 left-0 w-0.5 bg-(--tmd-accent)" />}
      <div className="flex min-w-0 items-center gap-1.5">
        {kindLabel && (
          <span
            className={`shrink-0 rounded border px-1 text-meta ${
              isCurrent ? "border-transparent bg-(--tmd-accent) text-white" : "border-(--tmd-border) text-(--tmd-fg-faint)"
            }`}
          >
            {kindLabel}
          </span>
        )}
        <span className="min-w-0 flex-1 truncate font-mono text-xs text-(--tmd-fg)">
          {entry.detached ? t("(detached)") : entry.branch}
        </span>
      </div>
      <div className="mt-1 flex min-w-0 items-center gap-2">
        <span className="min-w-0 flex-1 truncate font-mono text-meta text-(--tmd-fg-faint)" title={entry.path}>
          {entry.path}
        </span>
        {!isMain && !entry.prunable && <DirtBadge cwd={entry.path} />}
        <TreeActions
          entry={entry}
          isMain={isMain}
          isCurrent={isCurrent}
          confirming={confirming}
          busy={busy}
          onStartConfirm={() => setConfirming(true)}
          onConfirmRemove={() => void remove()}
        />
      </div>
      {note && <div className="mt-1 truncate text-meta text-(--tmd-fg-faint)">{note}</div>}
    </div>
  );
}

export function WorktreeZone({ cwd, onCreate }: { cwd: string; onCreate: () => void }) {
  const [entries, setEntries] = useState<WorktreeEntry[] | null>(null);
  const [error, setError] = useState("");
  /* panelStore 全量刷新 nonce:worktree 弹窗(移除/清理/新建)等外部变更
   * 后 bump,本区同步重拉 —— 两处 UI 共用同一数据真相。 */
  const { refreshNonce } = useGitPanelState();

  /* token 防竞速:切仓/刷新与在途请求交错时,迟到旧响应不得覆盖新结果
   * (2026-09-27 评审 P1:旧响应会让卡片动作打到上一仓的树)。 */
  const reqRef = useRef(0);
  const load = useCallback(() => {
    const token = reqRef.current + 1;
    reqRef.current = token;
    listWorktrees(cwd)
      .then((list) => {
        if (reqRef.current === token) {
          setEntries(list);
          setError("");
        }
      })
      .catch((e) => {
        if (reqRef.current === token) setError(e instanceof Error ? e.message : String(e));
      });
  }, [cwd]);
  useEffect(() => {
    load();
  }, [load, refreshNonce]);

  /* 单树仓(仅主仓自己)不占版面:分区只在真有多树时出现。 */
  if (error || !entries || entries.length <= 1) return null;
  const main = entries[0];
  const currentPath = normalizeRoot(cwd);
  return (
    <div className="border-b border-(--tmd-border)/60 px-2 pb-2">
      <div className="flex items-center gap-1.5 py-1.5">
        <TreeStructure size="0.75rem" aria-hidden data-decor-from="git-worktree" className="shrink-0 text-(--tmd-fg-faint)" />
        <span className="text-xs text-(--tmd-fg-faint)">
          {t("工作树 ({n})", { n: entries.length })}
        </span>
        <button
          type="button"
          onClick={onCreate}
          className="ml-auto flex items-center gap-0.5 rounded px-1 py-0.5 text-xs text-(--tmd-accent) hover:bg-(--tmd-bg-hover)"
        >
          <Plus size="0.625rem" aria-hidden data-decor-from="git-worktree" />
          {t("新建工作树")}
        </button>
        <button
          type="button"
          onClick={load}
          title={t("刷新")}
          aria-label={t("刷新")}
          className="rounded p-0.5 text-(--tmd-fg-faint) hover:bg-(--tmd-bg-hover) hover:text-(--tmd-fg)"
        >
          <ArrowsClockwise size="0.625rem" aria-hidden data-decor-from="git-worktree" />
        </button>
      </div>
      <div className="flex flex-col gap-1.5">
        {entries.map((e) => (
          <TreeCard
            key={e.path}
            cwd={cwd}
            entry={e}
            isMain={e === main}
            isCurrent={normalizeRoot(e.path) === currentPath}
            siblings={entries}
            onChanged={load}
          />
        ))}
      </div>
    </div>
  );
}
