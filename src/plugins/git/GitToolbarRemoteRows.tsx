/**
 * GitToolbarRemoteRows —— 远端下拉的动作行(自 GitToolbar 拆出,文件规模铁则):
 * 创建 PR(打开工作流对话框)+ 刷新 / 获取 / 拉取(behind 计数)/ 推送(ahead 计数,accent)。
 * 状态共享走 panelStore(remoteMeta 镜像,由 GitPanelMain 写入)。
 */

import { t } from "@kernel/i18n";
import {
  ArrowClockwise,
  CircleNotch,
  CloudArrowDown,
  DownloadSimple,
  GitPullRequest,
  UploadSimple,
} from "@phosphor-icons/react";
import { bumpGitRefresh, requestRemoteDialog, useGitPanelState, type RemoteDialogOp } from "./panelStore";

interface RemoteRowDeps {
  busy: RemoteDialogOp | null;
  detached: boolean;
  unborn: boolean;
  hasUpstream: boolean;
  ahead: number;
  behind: number;
}

/** 行定义纯工厂(组件外:控制流复杂度不进 React 函数,no-high-complexity)。 */
function remoteRows({ busy, detached, unborn, hasUpstream, ahead, behind }: RemoteRowDeps) {
  const remoteDisable = busy !== null || detached || unborn;
  const unbornHint = t("先创建首个提交");
  return [
    {
      key: "pr" as const,
      label: t("创建 PR"),
      title: t("创建 Pull Request(预检 → 推送 → 建 PR → 可选审批评论)"),
      icon: GitPullRequest,
      disabled: busy !== null || detached,
      active: false,
      accent: false,
      count: 0,
      run: () => requestRemoteDialog("pr"),
    },
    {
      key: "refresh" as const,
      label: t("刷新"),
      title: t("刷新(重扫状态/分支/历史)"),
      icon: ArrowClockwise,
      disabled: false,
      active: false,
      accent: false,
      count: 0,
      run: bumpGitRefresh,
    },
    {
      key: "fetch" as const,
      label: t("获取"),
      title: unborn
        ? unbornHint
        : t("获取远端更新(fetch --all --prune,不动本地分支)"),
      icon: CloudArrowDown,
      disabled: remoteDisable,
      active: busy === "fetch",
      accent: false,
      count: 0,
      run: () => requestRemoteDialog("fetch"),
    },
    {
      key: "pull" as const,
      label: t("拉取"),
      title: unborn
        ? unbornHint
        : behind > 0
          ? t("拉取远端更新(落后 {n} 个提交)", { n: behind })
          : t("拉取远端更新(对话框内可选远端与分支)"),
      icon: DownloadSimple,
      disabled: remoteDisable,
      active: busy === "pull" || behind > 0,
      accent: false,
      count: behind,
      run: () => requestRemoteDialog("pull"),
    },
    {
      key: "push" as const,
      label: t("推送"),
      title: unborn
        ? unbornHint
        : ahead > 0
          ? hasUpstream
            ? t("推送 {n} 个提交(对话框内可预览)", { n: ahead })
            : t("推送新分支并建立 upstream")
          : t("推送(对话框内查看预览与选项)"),
      icon: UploadSimple,
      disabled: remoteDisable,
      active: busy === "push" || ahead > 0,
      accent: ahead > 0,
      count: ahead,
      run: () => requestRemoteDialog("push"),
    },
  ];
}

export function RemoteActionRows({ onDone }: { onDone: () => void }) {
  const { remoteMeta } = useGitPanelState();
  const meta = remoteMeta;
  const busy = meta?.busy ?? null;
  const item =
    "flex w-full items-center justify-between px-3 py-1.5 text-left text-xs hover:bg-(--tmd-bg-hover) disabled:opacity-50";
  const rows = remoteRows({
    busy,
    detached: meta?.detached ?? false,
    unborn: meta?.unborn ?? false,
    hasUpstream: meta?.hasUpstream ?? false,
    ahead: meta?.ahead ?? 0,
    behind: meta?.behind ?? 0,
  });
  return (
    <>
      {rows.map((r) => {
        const Icon = r.active && busy === r.key ? CircleNotch : r.icon;
        return (
          <button
            key={r.key}
            type="button"
            role="menuitem"
            className={`${item}${r.accent ? " text-(--tmd-accent)" : ""}`}
            title={r.title}
            disabled={r.disabled}
            onClick={() => {
              r.run();
              onDone();
            }}
          >
            <span className="flex items-center gap-1.5">
              <Icon
                className={`h-[0.75rem] w-[0.75rem]${busy === r.key ? " animate-spin" : ""}`}
                aria-hidden
              />
              <span>{r.label}</span>
            </span>
            {r.count > 0 && <span>{r.count}</span>}
          </button>
        );
      })}
    </>
  );
}
