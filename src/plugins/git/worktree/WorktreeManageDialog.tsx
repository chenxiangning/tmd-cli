/**
 * worktree 管理弹窗 ── 列表 / 新建(新分支基于 HEAD 或检出已有分支)/ 移除 / 清理悬空。
 * 新建成功即 addWorkspace:worktree 目录进侧栏,会话由用户在工作区自开。
 * 视觉走 remoteDialogs 同款 portal + fixed 模态;弹层焦点圈闭(dialog 语义)。
 * 列表拆至 WorktreeList.tsx(加载骨架/空态/两段式移除),焦点圈闭拆至 dialogA11y.ts。
 */

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowsClockwise, Plus } from "@phosphor-icons/react";
import { useEscClose } from "@kernel/DialogShell";
import { ipc, type WorktreeEntry } from "@kernel/ipc";
import { t } from "@kernel/i18n";
import { addWorkspace } from "@kernel/workspace";
import { branchForWorktree, dirNameFromBranch, validateDirName, worktreePathFor } from "./dirName";
import { removeWorktreeWithCleanup } from "./worktreeOps";
import { useFocusTrap } from "@kernel/useFocusTrap";
import { WorktreeList } from "./WorktreeList";
import { bumpGitRefresh } from "../panelStore";
import "./locales"; /* 域词典随插件自带:import 即注册 */

export function WorktreeManageDialog({
  cwd,
  onClose,
  /** 预填(Git 面板「建树」入口):检出已有分支模式下预选该分支。 */
  initialBranch,
  initialNewBranch,
}: {
  cwd: string;
  onClose: () => void;
  initialBranch?: string;
  initialNewBranch?: boolean;
}) {
  const [list, setList] = useState<WorktreeEntry[] | null>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  /* 新建表单:branch = 新分支名或已有分支名;newBranch 默认开(并行任务最常见)。 */
  const [newBranch, setNewBranch] = useState(initialNewBranch ?? true);
  const [branch, setBranch] = useState(initialBranch ?? "");
  const [dirName, setDirName] = useState(() => (initialBranch ? dirNameFromBranch(initialBranch) : ""));
  const [existingBranches, setExistingBranches] = useState<string[]>([]);
  /* 两段式移除确认:记待确认路径,再点同钮执行。 */
  const [confirmPath, setConfirmPath] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void ipc.gitWorktreeList(cwd)
      .then((list) => {
        if (alive) setList(list);
      })
      .catch((e) => {
        if (alive) fail(e);
      });
    void ipc.gitBranches(cwd)
      .then((res) => {
        if (alive) setExistingBranches(res.local.map((b) => b.name));
      })
      .catch(() => {}); /* 分支列举失败只影响「检出已有分支」,不遮列表 */
    return () => {
      alive = false;
    };
  }, [cwd]);

  useEscClose(onClose);
  /* 弹层焦点圈闭:本弹窗常驻挂载期打开(父级条件渲染),active 恒 true。 */
  const dialogRef = useFocusTrap(true);

  const refresh = (): void => {
    void ipc.gitWorktreeList(cwd).then(setList).catch(fail);
  };

  const fail = (e: unknown): void => {
    setError(e instanceof Error ? e.message : String(e));
  };

  const add = async (): Promise<void> => {
    const nameErr = validateDirName(dirName);
    if (nameErr) {
      setError(t(nameErr));
      return;
    }
    if (!branch.trim()) {
      setError(t("分支名不能为空"));
      return;
    }
    const path = worktreePathFor(cwd, dirName.trim());
    if (!path) {
      setError(t("主仓位于盘根,无法推导 worktree 父目录;请把仓库移到子目录后重试"));
      return;
    }
    /* 新建分支统一 wt/ 前缀(裸名才加;feature/x 这类自带命名空间原样)。 */
    const branchName = newBranch ? branchForWorktree(branch) : branch.trim();
    setBusy("add");
    setError("");
    try {
      await ipc.gitWorktreeAdd(cwd, path, branchName, newBranch);
      addWorkspace(path);
      setNotice(t("已创建并加入工作区:{path}", { path }));
      /* 右栏工作树区/分支列表同步刷新(独立组件,无共享状态)。 */
      bumpGitRefresh();
      refresh();
    } catch (e) {
      fail(e);
    } finally {
      setBusy("");
    }
  };

  const remove = async (entry: WorktreeEntry): Promise<void> => {
    setBusy(`rm:${entry.path}`);
    setError("");
    try {
      /* 共享编排层(与常驻区同一实现):移除 + 同 root 工作区摘除(归一路径
       * 比较 + 分支共享判定齐全)。原内联版路径比较未归一,Windows 下摘不掉
       * 侧栏死卡(2026-09-27 评审)。 */
      const r = await removeWorktreeWithCleanup(cwd, entry, list ?? []);
      setConfirmPath(null);
      const branchNote =
        (r.branchDeleted ? t("(分支 {branch} 已删除)", { branch: entry.branch }) : "") +
        (r.branchKept ? t("(分支 {branch} 未合并,已保留)", { branch: entry.branch }) : "");
      setNotice(t("已移除 {path}", { path: entry.path }) + branchNote);
      bumpGitRefresh();
      refresh();
    } catch (e) {
      fail(e);
    } finally {
      setBusy("");
    }
  };

  const prune = async (): Promise<void> => {
    setBusy("prune");
    setError("");
    try {
      await ipc.gitWorktreePrune(cwd);
      setNotice(t("已清理悬空 worktree 记录"));
      bumpGitRefresh();
      refresh();
    } catch (e) {
      fail(e);
    } finally {
      setBusy("");
    }
  };

  const parent = cwd.replace(/[\\/]+$/, "").replace(/(.*[\\/]).*/, "$1");

  return createPortal(
    <div
      role="presentation"
      className="fixed inset-0 z-[1201] flex items-start justify-center bg-black/45 pt-[12vh]"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={t("Worktree 管理")}
        className="flex max-h-[80vh] w-[520px] flex-col gap-3 overflow-auto rounded-xl border border-(--tmd-border) bg-(--tmd-bg-panel) p-4 shadow-2xl"
      >
        <div className="flex items-center justify-between">
          <div className="text-sm font-medium text-(--tmd-fg)">{t("Worktree 管理")}</div>
          <button
            type="button"
            onClick={() => void prune()}
            disabled={busy === "prune"}
            className="flex items-center gap-1 rounded-md border border-(--tmd-border) px-2 py-1 text-xs text-(--tmd-fg-faint) hover:text-(--tmd-fg) disabled:opacity-50"
          >
            <ArrowsClockwise size="0.75rem" aria-hidden />
            {t("清理悬空")}
          </button>
        </div>

        {error && <div className="text-xs text-(--tmd-danger, #e5484d)">{error}</div>}
        {notice && <div className="text-xs text-(--tmd-fg-faint)">{notice}</div>}

        <div className="flex flex-col gap-1">
          <WorktreeList
            cwd={cwd}
            list={list}
            busy={busy}
            confirmPath={confirmPath}
            setConfirmPath={setConfirmPath}
            onRemove={(entry) => void remove(entry)}
          />
        </div>

        <div className="flex flex-col gap-2 rounded-md border border-(--tmd-border)/60 p-2.5">
          <div className="flex items-center gap-2 text-xs text-(--tmd-fg)">
            <Plus size="0.75rem" aria-hidden />
            {t("新建 worktree")}
          </div>
          <label className="flex items-center gap-2 text-xs text-(--tmd-fg-faint)">
            <input
              type="checkbox"
              checked={newBranch}
              onChange={(e) => {
                setNewBranch(e.target.checked);
                setDirName("");
              }}
            />
            {t("新建分支(基于当前 HEAD);否则检出已有分支")}
          </label>
          {newBranch ? (
            <input
              value={branch}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.nativeEvent.isComposing) void add();
              }}
              onChange={(e) => {
                setBranch(e.target.value);
                setDirName(dirNameFromBranch(e.target.value));
              }}
              placeholder={t("新分支名,如 feature/parallel-task")}
              className="rounded-md border border-(--tmd-border) bg-(--tmd-bg-input) px-2 py-1 text-xs text-(--tmd-fg) outline-none focus:border-(--tmd-accent)"
              aria-label={t("新分支名")}
            />
          ) : (
            <select
              value={branch}
              onChange={(e) => {
                setBranch(e.target.value);
                setDirName(dirNameFromBranch(e.target.value));
              }}
              className="rounded-md border border-(--tmd-border) bg-(--tmd-bg-input) px-2 py-1 text-xs text-(--tmd-fg) outline-none"
              aria-label={t("选择已有分支")}
            >
              <option value="">{t("选择已有分支…")}</option>
              {existingBranches.map((b) => (
                <option key={b} value={b}>
                  {b}
                </option>
              ))}
            </select>
          )}
          <div className="flex items-center gap-2">
            <input
              value={dirName}
              onChange={(e) => setDirName(e.target.value)}
              placeholder={t("目录名(自动推导,可改)")}
              className="w-40 rounded-md border border-(--tmd-border) bg-(--tmd-bg-input) px-2 py-1 text-xs text-(--tmd-fg) outline-none focus:border-(--tmd-accent)"
              aria-label={t("目录名")}
            />
            <span className="min-w-0 flex-1 truncate text-[0.6875rem] text-(--tmd-fg-faint)">
              {dirName.trim() ? `${parent}/${dirName.trim()}` : parent + "/…"}
            </span>
            <button
              type="button"
              onClick={() => void add()}
              disabled={busy === "add"}
              className="shrink-0 rounded-md bg-(--tmd-accent) px-2.5 py-1 text-xs font-medium text-white disabled:opacity-50"
            >
              {busy === "add" ? t("创建中…") : t("创建")}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
