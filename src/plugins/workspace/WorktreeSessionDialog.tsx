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
import { t } from "@kernel/i18n";
import { host } from "@kernel/host";
import { branchForWorktree, dirNameFromBranch, validateDirName, worktreePathFor } from "@plugins/git/worktree/dirName";
import { defaultEngineCandidates, resolveDefaultEngine } from "@plugins/workbench/defaultEngine";
import { finalBranchName, recordWtSession } from "./worktreeSession";

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

  useEffect(() => {
    let alive = true;
    void ipc
      .gitWorktreeList(repoCwd)
      .then((list) => alive && setEntries(list))
      .catch((e) => alive && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      alive = false;
    };
  }, [repoCwd]);

  const { takenBranches, finalBranch, conflict, baseErr, wtPath, canCreate } = deriveWtForm(
    repoCwd, entries, newBranch, base, existingBranch, busy, done,
  );

  return {
    entries, existingBranch, setExistingBranch, newBranch, setNewBranch,
    base, setBase, busy, setBusy, error, setError, done, setDone,
    finalBranch, conflict, baseErr, wtPath, canCreate, takenBranches,
  };
}

export function WorktreeSessionDialog({
  repoCwd,
  workspaceId,
  profileId,
  title,
  onClose,
}: {
  /** 仓库根(会话 cwd):worktree 父目录与 node_modules 复用源都由此推导。 */
  repoCwd: string;
  workspaceId: string;
  /** 引擎预填(会话右键路径 = 原会话引擎);缺省 = 弹层内引擎选择行(工作区右键路径)。 */
  profileId?: string;
  /** 原会话标题:分支基名 slug 预填 + 新会话标题沿用。 */
  title: string;
  onClose: () => void;
}) {
  /* 引擎选择(仅未预填时):默认引擎回落首个候选;生产行(dsh)排除同 GenSettings。 */
  const candidates = defaultEngineCandidates();
  const [pickedProfile, setPickedProfile] = useState(() => {
    if (profileId) return profileId;
    const def = resolveDefaultEngine();
    if (def && candidates.some((p) => p.id === def.profileId)) return def.profileId;
    return candidates[0]?.id ?? "";
  });
  const engineId = profileId ?? pickedProfile;
  const form = useWtSessionForm(repoCwd, title);
  const {
    busy, done, error, setError, setBusy, setDone, canCreate, wtPath, finalBranch, newBranch,
    setNewBranch, base, setBase, existingBranch, setExistingBranch, conflict, baseErr,
    takenBranches,
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
      /* 走 kernel 统一生成面:identityTrack/事件广播/侧栏装配全在里面;
       * 直调 ipc.sessionSpawn 会绕过装配(侧栏不可见、审批/时间线全盲)。 */
      const spawned = await host.spawnRawSession(
        engineId,
        { command: host.getCliProfile(engineId)?.command ?? "", args: host.getCliProfile(engineId)?.args ?? [], cwd: wtPath, title },
        workspaceId,
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
      } catch {
        /* 回滚失败也如实告知入口。 */
      }
      setError(
        rolledBack
          ? msg
          : `${msg}(已残留 worktree ${wtPath},可在 git 面板 worktree 管理中移除后重试)`,
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
        {!profileId && (
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
        <div className="text-xs text-(--tmd-fg-faint)">
          {t("目录:{dir}", { dir: wtPath ?? "…" })}
        </div>

        <label className="flex items-center gap-2 text-xs text-(--tmd-fg)">
          <input type="radio" name="wt-base" checked={newBranch} onChange={() => setNewBranch(true)} />
          {t("新建分支(基于当前 HEAD)")}
        </label>
        <label className="flex items-center gap-2 text-xs text-(--tmd-fg)">
          <input type="radio" name="wt-base" checked={!newBranch} onChange={() => setNewBranch(false)} />
          {t("检出已有分支")}
        </label>

        {newBranch ? (
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
        )}

        <div className="text-xs text-(--tmd-fg-faint)">
          {t("主仓 node_modules 存在时以符号链接复用,新树免重装依赖。")}
        </div>

        {error && <div className="text-xs text-(--tmd-danger, #e5484d)">{error}</div>}
        {done && <div className="text-xs text-(--tmd-fg-faint)">{t("已创建并起会话")}</div>}

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={closeGuarded}
            className="rounded-md border border-(--tmd-border) px-2.5 py-1 text-xs text-(--tmd-fg-faint) hover:text-(--tmd-fg)"
          >
            {t("取消")}
          </button>
          <button
            type="button"
            onClick={() => void create()}
            disabled={!canCreate}
            className="rounded-md bg-(--tmd-accent) px-2.5 py-1 text-xs font-medium text-(--tmd-accent-fg) disabled:opacity-50"
          >
            {busy ? t("创建中…") : t("创建并起会话")}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
