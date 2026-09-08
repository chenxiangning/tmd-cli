/**
 * FetchDialog —— 获取远端更新(复刻 codemoss fetch 对话框):固定全远端作用域,
 * 无选择 UI;解释区为固定文案;Example 与实际执行一致(tmd-cli 保留 --prune)。
 */

import { t } from "@kernel/i18n";
import { CloudArrowDown } from "@phosphor-icons/react";
import type { GitRemoteRequest } from "@kernel/ipc";
import { DialogActions, GitDialogShell } from "./GitDialogShell";
import { GitOpTokens, OpSectionLabel, type GitOpToken } from "./GitOpTokens";

const EXAMPLE_TOKENS: GitOpToken[] = [
  { kind: "command", value: "git fetch" },
  { kind: "option", value: "--all" },
  { kind: "option", value: "--prune" },
];

export function FetchDialog({
  repoName,
  submitting,
  onClose,
  onRun,
}: {
  repoName?: string;
  submitting: boolean;
  onClose: () => void;
  onRun: (req: GitRemoteRequest, label: string) => void;
}) {
  return (
    <GitDialogShell
      title={t("获取远端更新")}
      icon={<CloudArrowDown className="h-[0.875rem] w-[0.875rem]" aria-hidden />}
      repoName={repoName}
      locked={submitting}
      onClose={onClose}
      footer={
        <DialogActions
          confirmLabel={t("获取")}
          submitting={submitting}
          onConfirm={() => onRun(FETCH_REQUEST, t("获取"))}
          onCancel={onClose}
        />
      }
    >
      {/* hero:作用域 + 副提示 */}
      <div className="mt-3 rounded-md border border-(--tmd-border) bg-(--tmd-bg-elevated) p-3">
        <div className="font-mono text-xs font-semibold text-(--tmd-fg)">fetch -&gt; all remotes</div>
        <div className="mt-1.5 rounded bg-(--tmd-bg-sunken) px-2 py-1 text-xs text-(--tmd-fg-muted)">
          {t("仅更新远端引用元数据")}
        </div>
      </div>

      {/* Intent / Will Happen / Will NOT Happen */}
      <dl className="mt-3 space-y-2 rounded-md border border-(--tmd-border) bg-(--tmd-bg-sunken) p-3">
        <div>
          <dt className="text-xs font-semibold text-(--tmd-fg)">Intent</dt>
          <dd className="mt-0.5 text-xs leading-5 text-(--tmd-fg-muted)">{t("更新远端引用信息用于比对。")}</dd>
        </div>
        <div>
          <dt className="text-xs font-semibold text-(--tmd-fg)">Will Happen</dt>
          <dd className="mt-0.5 text-xs leading-5 text-(--tmd-fg-muted)">{t("将以默认作用域 all remotes 执行 fetch。")}</dd>
        </div>
        <div>
          <dt className="text-xs font-semibold text-(--tmd-fg)">Will NOT Happen</dt>
          <dd className="mt-0.5 text-xs leading-5 text-(--tmd-fg-muted)">{t("不会把变更合并到当前分支。")}</dd>
        </div>
      </dl>

      {/* Example */}
      <div className="mt-3 rounded-md border border-(--tmd-border) p-3">
        <OpSectionLabel>Example</OpSectionLabel>
        <div className="mt-1.5">
          <GitOpTokens tokens={EXAMPLE_TOKENS} />
        </div>
      </div>
    </GitDialogShell>
  );
}

const FETCH_REQUEST: GitRemoteRequest = {
  op: "fetch",
  remote: null,
  branch: null,
  strategy: null,
  noCommit: false,
  noVerify: false,
  forceWithLease: false,
  followTags: false,
  gerrit: null,
};
