/**
 * worktree 会话弹层的两段 body:非 git 仓占位 / 创建区(状态行+按钮对)。
 * 独立文件只为 300 行铁则(纯展示,无状态)。
 */

import { t } from "@kernel/i18n";

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
