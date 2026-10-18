/**
 * 「在新 worktree 中起会话」弹层(workspace 域,工作区右键菜单入口;
 * 来源工作区(WSL/SSH)不走本链,见 SessionMenu)。
 * 复用 git 插件 dirName 推导(路径约定与 WorktreeManageDialog 一致):
 * 分支基名 slug 预填 → 冲突自动 -2/-3 → git_worktree_add → node_modules
 * 符号链接(主仓有则复用,免重装)→ sessionSpawn(cwd = 新树)→ 记关联 map。
 */

import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useEscClose } from "@kernel/DialogShell";
import { useFocusTrap } from "@kernel/useFocusTrap";
import { ipc, type WorktreeEntry } from "@kernel/ipc";
import { t } from "@kernel/i18n";
import { branchForWorktree, dirNameFromBranch, validateDirName, worktreePathFor } from "@plugins/git/worktree/dirName";
import { defaultEngineCandidates, resolveDefaultEngine } from "@plugins/workbench/defaultEngine";
import { finalBranchName } from "./worktreeSession";
import { BranchBaseForm, CreateBody, NotGitBody, EnginePicker } from "./WorktreeDialogBodies";
import { runWorktreeCreate, wtCreateOutcomeMessage } from "./worktreeCreate";

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
  return { takenBranches, finalBranch, conflict, baseErr, dirErr, wtPath, canCreate };
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
  /** 本地分支全集(「检出已有分支」的选项集):已被任一 worktree 占用的分支
   *  git 拒绝检出,须从选项里剔除(与 WorktreeManageDialog 同源 gitBranches)。 */
  const [localBranches, setLocalBranches] = useState<string[]>([]);

  useEffect(() => {
    let alive = true;
    void Promise.allSettled([ipc.gitWorktreeList(repoCwd), ipc.gitBranches(repoCwd)]).then(
      ([wt, br]) => {
        if (!alive) return;
        if (wt.status === "fulfilled") setEntries(wt.value);
        else setNotGit(true); /* 非 git 仓:创建区整体替换为说明(不裸奔报错)。 */
        if (br.status === "fulfilled") setLocalBranches(br.value.local.map((b) => b.name));
        /* 分支列举失败只影响「检出已有分支」,不遮表单。 */
      },
    );
    return () => {
      alive = false;
    };
  }, [repoCwd]);

  const { takenBranches, finalBranch, conflict, baseErr, wtPath, canCreate, dirErr } = deriveWtForm(
    repoCwd, entries, newBranch, base, existingBranch, busy, done,
  );

  return {
    entries, existingBranch, setExistingBranch, newBranch, setNewBranch,
    base, setBase, busy, setBusy, error, setError, done, setDone, notGit,
    finalBranch, conflict, baseErr, wtPath, canCreate, takenBranches, localBranches, dirErr,
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
    takenBranches, notGit, localBranches, dirErr,
  } = form;
  /* 可检出 = 本地分支剔除已被 worktree 占用的(git 拒绝二次检出,选项必败集不放)。 */
  const selectableBranches = localBranches.filter((b) => !takenBranches.has(b));
  /** 引擎候选为空(全部引擎插件关闭)时禁创建,防空 command spawn。 */
  const canCreateWithEngine = canCreate && pickedProfile !== "";

  const closeGuarded = useCallback((): void => {
    if (busy) return; /* 创建中禁关:防 fire-and-forget 残留。 */
    onClose();
  }, [busy, onClose]);
  useEscClose(closeGuarded);
  const dialogRef = useFocusTrap(true);

  const create = async (): Promise<void> => {
    if (!canCreateWithEngine || !wtPath) return;
    setBusy(true);
    setError("");
    const r = await runWorktreeCreate({ repoCwd, wtPath, finalBranch, newBranch, engineId, title });
    if (r.ok) {
      setDone(true);
      onClose();
      return;
    }
    setError(wtCreateOutcomeMessage(r));
    setBusy(false);
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
          <EnginePicker candidates={candidates} picked={engineId} onPick={setPickedProfile} />
        )}
        {!notGit && (
          <div className="text-xs text-(--tmd-fg-faint)">
            {t("目录:{dir}", { dir: wtPath ?? "…" })}
          </div>
        )}

        {!notGit && (
          <BranchBaseForm
            newBranch={newBranch} setNewBranch={setNewBranch}
            base={base} setBase={setBase} baseErr={baseErr} dirErr={dirErr}
            conflict={conflict} finalBranch={finalBranch}
            existingBranch={existingBranch} setExistingBranch={setExistingBranch}
            selectableBranches={selectableBranches}
          />
        )}

        {notGit ? (
          <NotGitBody repoCwd={repoCwd} onCancel={closeGuarded} />
        ) : (
          <CreateBody
            error={error} done={done} busy={busy} canCreate={canCreateWithEngine}
            onCancel={closeGuarded} onCreate={() => void create()}
          />
        )}
      </div>
    </div>,
    document.body,
  );
}
