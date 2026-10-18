/**
 * 「在新 worktree 中起会话」弹层(workspace 域,会话卡右键入口)。
 * 复用 git 插件 dirName 推导(路径约定与 WorktreeManageDialog 一致):
 * 分支基名 slug 预填 → 冲突自动 -2/-3 → git_worktree_add → node_modules
 * 符号链接(主仓有则复用,免重装)→ sessionSpawn(cwd = 新树)→ 记关联 map。
 */

import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useEscClose } from "@kernel/DialogShell";
import { useFocusTrap } from "@kernel/useFocusTrap";
import { ipc, type WorktreeEntry } from "@kernel/ipc";
import { addWorkspace, removeWorkspace } from "@kernel/workspace";
import { t } from "@kernel/i18n";
import { host } from "@kernel/host";
import { branchForWorktree, dirNameFromBranch, validateDirName, worktreePathFor } from "@plugins/git/worktree/dirName";
import { defaultEngineCandidates, resolveDefaultEngine } from "@plugins/workbench/defaultEngine";
import { finalBranchName, recordWtSession } from "./worktreeSession";
import { CreateBody, NotGitBody } from "./WorktreeDialogBodies";

/** 派生纯函数(自 hook 拆出:分支密集段离开 React 函数;语义不变)。 */
function deriveWtForm(
  repoCwd: string,
  entries: WorktreeEntry[] | null,
  newBranch: boolean,
  base: string,
  existingBranch: string,
  busy: boolean,
  done: boolean,
) {
  const takenBranches = new Set((entries ?? []).map((e) => e.branch).filter(Boolean));
  const finalBranch = newBranch ? finalBranchName(base.trim(), takenBranches) : existingBranch;
  const bareBranch = newBranch ? branchForWorktree(base.trim()) : "";
  const conflict = newBranch && base.trim() !== "" && takenBranches.has(bareBranch);
  const baseErr = newBranch
    ? base.trim() === ""
      ? t("分支名不能为空")
      : /\s/.test(base.trim())
        ? t("分支名不能含空格")
        : null
    : null;
  const dirName = dirNameFromBranch(finalBranch);
  const dirErr = validateDirName(dirName);
  const wtPath = dirErr ? null : worktreePathFor(repoCwd, dirName);
  const canCreate = !busy && !done && !baseErr && !dirErr && !!wtPath && (newBranch || existingBranch !== "");
  return { takenBranches, finalBranch, conflict, baseErr, wtPath, canCreate };
}

/** 表单态 + 派生(自组件拆出,react-doctor 复杂度;语义不变)。 */
function useWtSessionForm(repoCwd: string, title: string) {
  const [entries, setEntries] = useState<WorktreeEntry[] | null>(null);
  const [existingBranch, setExistingBranch] = useState("");
  /* newBranch = 基于当前 HEAD 新建分支(默认);false = 检出已有分支。 */
  const [newBranch, setNewBranch] = useState(true);
  const [base, setBase] = useState(() => dirNameFromBranch(title));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  /** 非 git 仓:gitWorktreeList 直接失败 → 前置拦截,创建区整体替换为说明(不裸奔报错)。 */
  const [notGit, setNotGit] = useState(false);

  useEffect(() => {
    let alive = true;
    void ipc
      .gitWorktreeList(repoCwd)
      .then((list) => alive && setEntries(list))
      .catch(() => alive && setNotGit(true));
    return () => {
      alive = false;
    };
  }, [repoCwd]);

  const { takenBranches, finalBranch, conflict, baseErr, wtPath, canCreate } = deriveWtForm(
    repoCwd, entries, newBranch, base, existingBranch, busy, done,
  );

  return {
    entries, existingBranch, setExistingBranch, newBranch, setNewBranch,
    base, setBase, busy, setBusy, error, setError, done, setDone, notGit,
    finalBranch, conflict, baseErr, wtPath, canCreate, takenBranches,
  };
}

export function WorktreeSessionDialog({
  repoCwd,
  title,
  onClose,
}: {
  /** 仓库根(会话 cwd):worktree 父目录与 node_modules 复用源都由此推导。 */
  repoCwd: string;
  /** 原会话标题:分支基名 slug 预填 + 新会话标题沿用。 */
  title: string;
  onClose: () => void;
}) {
  /* 引擎选择:默认引擎回落首个候选;生产行(dsh)排除同 GenSettings。 */
  const candidates = defaultEngineCandidates();
  const [pickedProfile, setPickedProfile] = useState(() => {
    const def = resolveDefaultEngine();
    if (def && candidates.some((p) => p.id === def.profileId)) return def.profileId;
    return candidates[0]?.id ?? "";
  });
  const engineId = pickedProfile;
  const form = useWtSessionForm(repoCwd, title);
  const {
    busy, done, error, setError, setBusy, setDone, canCreate, wtPath, finalBranch, newBranch,
    setNewBranch, base, setBase, existingBranch, setExistingBranch, conflict, baseErr,
    takenBranches, notGit,
  } = form;

  const closeGuarded = useCallback((): void => {
    if (busy) return; /* 创建中禁关:防 fire-and-forget 残留。 */
    onClose();
  }, [busy, onClose]);
  useEscClose(closeGuarded);
  const dialogRef = useFocusTrap(true);

  const create = async (): Promise<void> => {
    if (!canCreate || !wtPath) return;
    setBusy(true);
    setError("");
    /** 新工作区(addWorkspace 产出);spawn 失败回滚时对称移除,不留悬空行。 */
    let ws: ReturnType<typeof addWorkspace> | null = null;
    try {
      await ipc.gitWorktreeAdd(repoCwd, wtPath, finalBranch, newBranch);
      /* 主仓有 node_modules → 符号链接复用。失败不阻断(依赖可后补装),
       * 吞掉保后续 spawn 与映射落盘。 */
      const nm = `${repoCwd.replace(/[\\/]+$/, "")}/node_modules`;
      try {
        await ipc.fsListDir(nm).then(
          () => ipc.fsSymlinkDir(nm, `${wtPath}/node_modules`),
          () => undefined,
        );
      } catch {
        console.warn("[wt-session] node_modules 符号链接失败(不阻断)", wtPath);
      }
      /* 沿用既有心智:worktree = 独立工作区(WorktreeManageDialog 同款 addWorkspace),
       * 侧栏出现新工作区行;会话在新工作区里起(identityTrack 全装配)。 */
      ws = addWorkspace(wtPath);
      const spawned = await host.spawnRawSession(
        engineId,
        {
          command: host.getCliProfile(engineId)?.command ?? "",
          args: host.getCliProfile(engineId)?.args ?? [],
          cwd: wtPath,
          title,
        },
        ws.id,
        { activate: true, identityTrack: true },
      );
      recordWtSession(spawned.id, { branch: finalBranch, wtPath, root: repoCwd });
      setDone(true);
      onClose();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      /* worktree_add 已成功而后续失败:best-effort 回滚残留树,并指明手工入口。 */
      let rolledBack = false;
      try {
        await ipc.gitWorktreeRemove(repoCwd, wtPath, true);
        rolledBack = true;
        if (ws) removeWorkspace(ws.id); /* 对称清理:不留指向已删目录的悬空工作区。 */
      } catch {
        /* 回滚失败也如实告知入口。 */
      }
      setError(
        rolledBack
          ? t("创建失败,已回滚:{msg}", { msg: msg })
          : t("创建失败:{msg}(可重试;残留树可在 git 面板 worktree 管理中移除)", { msg: msg }),
      );
      setBusy(false);
    }
  };

  return createPortal(
    <div
      role="presentation"
      className="fixed inset-0 z-[1201] flex items-start justify-center bg-black/45 pt-[14vh]"
      data-icon-decor="dialog"
      onClick={(e) => e.target === e.currentTarget && closeGuarded()}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={t("在新 worktree 中起会话")}
        className="flex w-[440px] flex-col gap-3 rounded-xl border border-(--tmd-border) bg-(--tmd-bg-panel) p-4 shadow-(--tmd-shadow-modal)"
      >
        <div className="text-sm font-medium text-(--tmd-fg)">{t("在新 worktree 中起会话")}</div>
        {!notGit && (
          <div>
            <div className="mb-1 text-xs text-(--tmd-fg-faint)">{t("引擎")}</div>
            <div className="flex flex-wrap gap-1" role="radiogroup" aria-label={t("引擎")}>
              {candidates.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  role="radio"
                  aria-checked={engineId === p.id}
                  onClick={() => setPickedProfile(p.id)}
                  className={`flex items-center gap-1 rounded-md border px-2 py-1 text-xs ${
                    engineId === p.id
                      ? "border-(--tmd-accent) text-(--tmd-fg)"
                      : "border-(--tmd-border) text-(--tmd-fg-faint) hover:text-(--tmd-fg)"
                  }`}
                >
                  {p.renderIcon?.(12)}
                  <span>{p.name}</span>
                </button>
              ))}
            </div>
          </div>
        )}
        {!notGit && (
          <div className="text-xs text-(--tmd-fg-faint)">
            {t("目录:{dir}", { dir: wtPath ?? "…" })}
          </div>
        )}

        {!notGit && (
        <label className="flex items-center gap-2 text-xs text-(--tmd-fg)">
          <input type="radio" name="wt-base" checked={newBranch} onChange={() => setNewBranch(true)} />
          {t("新建分支(基于当前 HEAD)")}
        </label>
        )}
        {!notGit && (
        <label className="flex items-center gap-2 text-xs text-(--tmd-fg)">
          <input type="radio" name="wt-base" checked={!newBranch} onChange={() => setNewBranch(false)} />
          {t("检出已有分支")}
        </label>
        )}

        {!notGit &&
          (newBranch ? (
          <>
            <input
              value={base}
              autoFocus
              onChange={(e) => setBase(e.target.value)}
              placeholder={t("分支名(按会话标题预填)")}
              className="rounded-md border border-(--tmd-border) bg-(--tmd-bg-input) px-2 py-1 text-xs text-(--tmd-fg) outline-none focus:border-(--tmd-accent)"
              aria-label={t("分支名")}
            />
            {baseErr && <div className="text-xs text-(--tmd-danger, #e5484d)">{baseErr}</div>}
            {conflict && (
              <div className="text-xs text-(--tmd-warn)">
                {t("分支已存在,将创建 {branch}", { branch: finalBranch })}
              </div>
            )}
          </>
        ) : (
          <select
            value={existingBranch}
            onChange={(e) => setExistingBranch(e.target.value)}
            className="rounded-md border border-(--tmd-border) bg-(--tmd-bg-input) px-2 py-1 text-xs text-(--tmd-fg) outline-none"
            aria-label={t("选择已有分支")}
          >
            <option value="">{t("选择已有分支…")}</option>
            {[...takenBranches].map((b) => (
              <option key={b} value={b}>
                {b}
              </option>
            ))}
          </select>
          ))}

        {notGit ? (
          <NotGitBody repoCwd={repoCwd} onCancel={closeGuarded} />
        ) : (
          <CreateBody
            error={error} done={done} busy={busy} canCreate={canCreate}
            onCancel={closeGuarded} onCreate={() => void create()}
          />
        )}
      </div>
    </div>,
    document.body,
  );
}
