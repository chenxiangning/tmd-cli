/**
 * worktree 会话弹层的拆件:引擎选择行 / 非 git 仓占位 / 创建区(状态行+按钮对)。
 * 独立文件只为 300 行铁则(纯展示,无状态)。
 */

import type { ReactNode } from "react";
import { t } from "@kernel/i18n";

/** 引擎选择行(radiogroup;默认引擎预选由调用方决定)。 */
export function EnginePicker({
  candidates,
  picked,
  onPick,
}: {
  candidates: { id: string; name: string; renderIcon?: (size: number) => ReactNode }[];
  picked: string;
  onPick: (id: string) => void;
}) {
  return (
    <div>
      <div className="mb-1 text-xs text-(--tmd-fg-faint)">{t("引擎")}</div>
      <div className="flex flex-wrap gap-1" role="radiogroup" aria-label={t("引擎")}>
        {candidates.map((p) => (
          <button
            key={p.id}
            type="button"
            role="radio"
            aria-checked={picked === p.id}
            onClick={() => onPick(p.id)}
            className={`flex items-center gap-1 rounded-md border px-2 py-1 text-xs ${
              picked === p.id
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
  );
}

/** 分支基段:新建/检出双态 + 分支名输入/下拉 + 错误与冲突提示(纯展示)。 */
export function BranchBaseForm({
  newBranch,
  setNewBranch,
  base,
  setBase,
  baseErr,
  dirErr,
  conflict,
  finalBranch,
  existingBranch,
  setExistingBranch,
  selectableBranches,
}: {
  newBranch: boolean;
  setNewBranch: (v: boolean) => void;
  base: string;
  setBase: (v: string) => void;
  baseErr: string | null;
  dirErr: string | null;
  conflict: boolean;
  finalBranch: string;
  existingBranch: string;
  setExistingBranch: (v: string) => void;
  selectableBranches: string[];
}) {
  return (
    <>
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
          {!baseErr && dirErr && <div className="text-xs text-(--tmd-danger, #e5484d)">{t(dirErr)}</div>}
          {conflict && (
            <div className="text-xs text-(--tmd-warn)">
              {t("分支已存在,将创建 {branch}", { branch: finalBranch })}
            </div>
          )}
        </>
      ) : (
        <>
          <select
            value={existingBranch}
            onChange={(e) => setExistingBranch(e.target.value)}
            className="rounded-md border border-(--tmd-border) bg-(--tmd-bg-input) px-2 py-1 text-xs text-(--tmd-fg) outline-none"
            aria-label={t("选择已有分支")}
          >
            <option value="">{t("选择已有分支…")}</option>
            {selectableBranches.map((b) => (
              <option key={b} value={b}>
                {b}
              </option>
            ))}
          </select>
          {selectableBranches.length === 0 && (
            <div className="text-xs text-(--tmd-warn)">
              {t("没有可检出的分支(已被其他 worktree 占用的分支不可检出)")}
            </div>
          )}
        </>
      )}
    </>
  );
}

/** 非 git 仓占位:说明 + 取消(替代裸报错)。 */
export function NotGitBody({ repoCwd, onCancel }: { repoCwd: string; onCancel: () => void }) {
  return (
    <>
      <div className="text-xs text-(--tmd-fg)">
        {t("{dir} 不是 git 仓库,无法创建 worktree。", { dir: repoCwd })}
      </div>
      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md border border-(--tmd-border) px-2.5 py-1 text-xs text-(--tmd-fg-faint) hover:text-(--tmd-fg)"
        >
          {t("取消")}
        </button>
      </div>
    </>
  );
}

/** 创建区:状态/错误行 + 取消/创建按钮对。 */
export function CreateBody({
  error, done, busy, canCreate, onCancel, onCreate,
}: {
  error: string;
  done: boolean;
  busy: boolean;
  canCreate: boolean;
  onCancel: () => void;
  onCreate: () => void;
}) {
  return (
    <>
      <div className="text-xs text-(--tmd-fg-faint)">
        {t("主仓 node_modules 存在时以符号链接复用,新树免重装依赖。")}
      </div>
      {error && <div className="text-xs text-(--tmd-danger, #e5484d)">{error}</div>}
      {done && <div className="text-xs text-(--tmd-fg-faint)">{t("已创建并起会话")}</div>}
      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md border border-(--tmd-border) px-2.5 py-1 text-xs text-(--tmd-fg-faint) hover:text-(--tmd-fg)"
        >
          {t("取消")}
        </button>
        <button
          type="button"
          onClick={onCreate}
          disabled={!canCreate}
          className="rounded-md bg-(--tmd-accent) px-2.5 py-1 text-xs font-medium text-(--tmd-accent-fg) disabled:opacity-50"
        >
          {busy ? t("创建中…") : t("创建并起会话")}
        </button>
      </div>
    </>
  );
}
