/**
 * worktree 管理弹窗 ── 列表 / 新建(新分支基于 HEAD 或检出已有分支)/ 移除 / 清理悬空。
 * 新建成功即 addWorkspace:worktree 目录进侧栏,会话由用户在工作区自开。
 * 视觉走 remoteDialogs 同款 portal + fixed 模态。
 */

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowsClockwise, Plus, Trash } from "@phosphor-icons/react";
import { ipc } from "@kernel/ipc";
import type { WorktreeEntry } from "@kernel/ipc";
import { t } from "@kernel/i18n";
import { addWorkspace, getWorkspaces, removeWorkspace } from "@kernel/workspace";
import { branchForWorktree, dirNameFromBranch, validateDirName, worktreePathFor } from "./dirName";
import { bumpGitRefresh } from "../panelStore";

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

  /* Esc 关闭:同 GitConfirmDialog 纪律(git 插件弹窗全员有 Esc)。 */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

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
      await ipc.gitWorktreeRemove(cwd, entry.path, false);
      setConfirmPath(null);
      /* 创建时联动 addWorkspace 的对称面:同 root 的工作区一并摘除,
       * 侧栏不再残留死目录卡片(不影响该 worktree 下的历史会话记录)。 */
      const ws = getWorkspaces().find((w) => w.root === entry.path);
      if (ws) removeWorkspace(ws.id);
      /* 分支尾巴清理:安全删(-d 语义,未合并被拒)。被其他 worktree 检出的
       * 分支跳过(动它会弄残那棵树);删不掉的如实说明已保留。 */
      let branchNote = "";
      const branchShared = list?.some((e) => e !== entry && e.branch === entry.branch && !e.bare);
      if (entry.branch && !branchShared) {
        try {
          await ipc.gitDeleteBranch(cwd, entry.branch, false);
          branchNote = t("(分支 {branch} 已删除)", { branch: entry.branch });
        } catch {
          branchNote = t("(分支 {branch} 未合并,已保留)", { branch: entry.branch });
        }
      }
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
      <div className="flex max-h-[80vh] w-[520px] flex-col gap-3 overflow-auto rounded-xl border border-(--tmd-border) bg-(--tmd-bg-panel) p-4 shadow-2xl">
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
          {(list ?? []).map((entry) => (
            <div
              key={entry.path}
              className="flex items-center gap-2 rounded-md border border-(--tmd-border)/60 px-2 py-1.5"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 text-xs text-(--tmd-fg)">
                  <span className="truncate font-medium">{entry.path}</span>
                  {entry.bare && <span className="text-[0.625rem] text-(--tmd-fg-faint)">{t("(bare)")}</span>}
                  {entry.locked && <span className="text-[0.625rem] text-(--tmd-warn)">{t("已锁")}</span>}
                  {entry.prunable && <span className="text-[0.625rem] text-(--tmd-warn)">{t("可清理")}</span>}
                </div>
                <div className="truncate text-[0.6875rem] text-(--tmd-fg-faint)">
                  {entry.detached ? t("(detached)") : entry.branch || entry.head}
                </div>
              </div>
              {!entry.bare && entry.path !== cwd && (
                confirmPath === entry.path ? (
                  <button
                    type="button"
                    onClick={() => void remove(entry)}
                    disabled={busy === `rm:${entry.path}`}
                    className="shrink-0 rounded-md bg-(--tmd-danger, #e5484d) px-2 py-1 text-xs text-white disabled:opacity-50"
                  >
                    {t("确认移除")}
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => setConfirmPath(entry.path)}
                    className="shrink-0 rounded-md border border-(--tmd-border) p-1 text-(--tmd-fg-faint) hover:text-(--tmd-fg)"
                    aria-label={t("移除 worktree")}
                  >
                    <Trash size="0.75rem" aria-hidden />
                  </button>
                )
              )}
            </div>
          ))}
          {list?.length === 0 && (
            <div className="py-2 text-center text-xs text-(--tmd-fg-faint)">{t("无 worktree")}</div>
          )}
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
