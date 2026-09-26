/**
 * 分支视图动作装配(自 BranchView 拆出:文件规模铁则)。
 * confirmSwitch = 切换/检出统一入口(脏树提供「暂存并切换」次选);
 * menuActions = 右键全动作。全部经 run 包装(转圈/错误/通知/刷新),
 * 文案与确认弹窗口径与 BranchView 主体一致;此处零渲染。
 */

import { t } from "@kernel/i18n";
import { ipc, type GitBranchInfo, type GitRemoteOpReport } from "@kernel/ipc";
import { setSmartSwitchOrigin, requestRemoteDialog } from "../panelStore";
import type { BranchMenuActions } from "./BranchContextMenu";
import type { GitConfirmState } from "./GitConfirmDialog";
import type { BranchNameDialogState } from "./BranchNameDialog";
import type { BranchCompareRequest } from "./BranchCompareModal";

/** localNameOf 同款(远程名剥首段);BranchView 亦用,刻意双份免跨文件牵连。 */
function localNameOf(remoteBranch: string): string {
  return remoteBranch.replace(/^[^/]+\//, "");
}

export function useBranchActions(opts: {
  cwd: string;
  dirty: boolean;
  currentName: string | undefined;
  run: (action: () => Promise<unknown>, okNotice?: string | ((res: unknown) => string)) => void;
  setConfirm: (d: GitConfirmState) => void;
  setNameDialog: (d: BranchNameDialogState) => void;
  setCompare: (r: BranchCompareRequest) => void;
}): { menuActions: BranchMenuActions; confirmSwitch: (b: GitBranchInfo) => void } {
  const { cwd, dirty, currentName, run, setConfirm, setNameDialog, setCompare } = opts;
  const confirmSwitch = (b: GitBranchInfo) => {
    const target = b.isRemote ? localNameOf(b.name) : b.name;
    const isRemote = b.isRemote;
    setConfirm({
      title: isRemote
        ? t("检出 {source} 为本地分支 {target}?", { source: b.name, target })
        : t("切换到分支 {branch}?", { branch: b.name }),
      detail: dirty
        ? t("工作区有未提交变动:「切换」会尝试直接携带(冲突将被拒绝);「暂存并切换」先入 stash、切换后自动恢复。")
        : undefined,
      confirmLabel: isRemote ? t("检出") : t("切换"),
      onConfirm: () =>
        run(
          () => (isRemote ? ipc.gitCheckoutRemote(cwd, b.name) : ipc.gitCheckout(cwd, b.name)),
          isRemote
            ? t("已检出到本地分支 {branch}", { branch: target })
            : t("已切换到 {branch}", { branch: b.name }),
        ),
      alt: dirty
        ? {
            label: isRemote ? t("暂存并检出") : t("暂存并切换"),
            onConfirm: () => {
              if (currentName) setSmartSwitchOrigin(cwd, currentName);
              run(
                () => ipc.gitSmartCheckout(cwd, b.name, isRemote),
                isRemote
                  ? t("已检出到本地分支 {branch}(改动已恢复)", { branch: target })
                  : t("已切换到 {branch}(改动已恢复)", { branch: b.name }),
              );
            },
          }
        : undefined,
    });
  };

  const menuActions: BranchMenuActions = {
    checkout: confirmSwitch,
    createFrom: (b) =>
      setNameDialog({
        title: t("新建分支"),
        source: b.name,
        sourceLabel: t("基于分支:"),
        inputLabel: t("新分支名"),
        placeholder: t("新分支名..."),
        submitLabel: t("创建"),
        onSubmit: (name) =>
          run(
            () => ipc.gitCreateBranch(cwd, name, b.name),
            t("已基于 {base} 创建 {name}", { base: b.name, name }),
          ),
      }),
    checkoutRebase: (b) => {
      if (!currentName) return;
      setConfirm({
        title: t("签出并变基"),
        detail: t("确认签出 {branch} 并变基到 {onto} 吗?冲突时仓库留在变基中间态,可在幕布终端 continue/abort。", { branch: b.name, onto: currentName }),
        confirmLabel: t("签出并变基"),
        onConfirm: () => {
          const onto = currentName;
          run(
            () => ipc.gitCheckout(cwd, b.name).then(() => ipc.gitRebaseBranch(cwd, onto)),
            t("已签出 {branch} 并变基到 {onto}", { branch: b.name, onto }),
          );
        },
      });
    },
    compareWithCurrent: (b) => setCompare({ mode: "compare", target: b.name }),
    diffWithWorktree: (b) => setCompare({ mode: "worktree", branch: b.name }),
    rebaseCurrentOnto: (b) => {
      if (!currentName) return;
      setConfirm({
        title: t("当前分支变基"),
        detail: t("确认将当前分支 {current} 变基到 {branch} 吗?冲突时仓库留在变基中间态,可在幕布终端 continue/abort。", { current: currentName, branch: b.name }),
        confirmLabel: t("变基"),
        onConfirm: () =>
          run(
            () => ipc.gitRebaseBranch(cwd, b.name),
            t("已将 {current} 变基到 {branch}", { current: currentName, branch: b.name }),
          ),
      });
    },
    mergeIntoCurrent: (b) =>
      setConfirm({
        title: t("合并分支"),
        detail: t("确认将 {branch} 合并到当前分支吗?冲突时仓库留在合并中间态,可在幕布终端处理。", {
          branch: b.name,
        }),
        confirmLabel: t("合并"),
        onConfirm: () =>
          run(
            () => ipc.gitMergeBranch(cwd, b.name),
            t("已合并 {branch} 到 {current}", { branch: b.name, current: currentName ?? t("当前分支") }),
          ),
      }),
    pull: (b) =>
      run(() => ipc.gitPullPush(cwd, "pull", b.name), (r) =>
        (r as GitRemoteOpReport).upToDate
          ? t("{branch} 已是最新", { branch: b.name })
          : b.name === currentName
            ? t("已更新 {branch}", { branch: b.name })
            : t("已 fast-forward {branch}", { branch: b.name }),
      ),
    fetch: (b) =>
      run(() => ipc.gitPullPush(cwd, "fetch", b.name), (r) =>
        (r as GitRemoteOpReport).upToDate
          ? t("{branch} 的远端引用已是最新", { branch: b.name })
          : t("已获取 {branch} 的远端引用", { branch: b.name }),
      ),
    push: () => requestRemoteDialog("push"),
    rename: (b) =>
      setNameDialog({
        title: t("重命名分支"),
        source: b.name,
        sourceLabel: t("原分支名:"),
        inputLabel: t("新分支名"),
        initial: b.name,
        placeholder: t("请输入新的分支名称"),
        submitLabel: t("重命名"),
        onSubmit: (name) =>
          run(
            () => ipc.gitRenameBranch(cwd, b.name, name),
            t("已重命名 {from} 为 {to}", { from: b.name, to: name }),
          ),
      }),
    remove: (b) =>
      setConfirm({
        title: t("删除分支 {branch}?", { branch: b.name }),
        detail: t("未合并到当前分支的删除会被拒绝;强行删除请用行内删除按钮连点两次。"),
        confirmLabel: t("删除"),
        danger: true,
        onConfirm: () =>
          run(() => ipc.gitDeleteBranch(cwd, b.name, false), t("已删除 {branch}", { branch: b.name })),
      }),
  };
  return { menuActions, confirmSwitch };
}
