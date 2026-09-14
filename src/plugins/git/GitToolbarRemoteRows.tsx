/**
 * GitToolbarRemoteRows —— 视图下拉的远端动作行(自 GitToolbar 拆出,文件规模铁则):
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
import { bumpGitRefresh, requestRemoteDialog, useGitPanelState } from "./panelStore";

/** 菜单分组分隔线(常量 JSX 提模块级,不随渲染重建;GitToolbar 同款)。 */
const MENU_SEPARATOR = <div className="my-1 border-t border-(--tmd-border)" />;

export function RemoteActionRows({ onDone }: { onDone: () => void }) {
  const { remoteMeta } = useGitPanelState();
  const meta = remoteMeta;
  const busy = meta?.busy ?? null;
  const detached = meta?.detached ?? false;
  const hasUpstream = meta?.hasUpstream ?? false;
  const ahead = meta?.ahead ?? 0;
  const behind = meta?.behind ?? 0;
  const item =
    "flex w-full items-center justify-between px-3 py-1.5 text-left text-xs hover:bg-(--tmd-bg-hover) disabled:opacity-50";
  const rows: Array<{
    key: "pr" | "refresh" | "fetch" | "pull" | "push";
    label: string;
    title: string;
    icon: typeof ArrowClockwise;
    disabled: boolean;
    active: boolean;
    accent: boolean;
    count: number;
    run: () => void;
  }> = [
    {
      key: "pr",
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
      key: "refresh",
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
      key: "fetch",
      label: t("获取"),
      title: t("获取远端更新(fetch --all --prune,不动本地分支)"),
      icon: CloudArrowDown,
      disabled: busy !== null || detached,
      active: busy === "fetch",
      accent: false,
      count: 0,
      run: () => requestRemoteDialog("fetch"),
    },
    {
      key: "pull",
      label: t("拉取"),
      title:
        behind > 0
          ? t("拉取远端更新(落后 {n} 个提交)", { n: behind })
          : t("拉取远端更新(对话框内可选远端与分支)"),
      icon: DownloadSimple,
      disabled: busy !== null || detached,
      active: busy === "pull" || behind > 0,
      accent: false,
      count: behind,
      run: () => requestRemoteDialog("pull"),
    },
    {
      key: "push",
      label: t("推送"),
      title:
        ahead > 0
          ? hasUpstream
            ? t("推送 {n} 个提交(对话框内可预览)", { n: ahead })
            : t("推送新分支并建立 upstream")
          : t("推送(对话框内查看预览与选项)"),
      icon: UploadSimple,
      disabled: busy !== null || detached,
      active: busy === "push" || ahead > 0,
      accent: ahead > 0,
      count: ahead,
      run: () => requestRemoteDialog("push"),
    },
  ];
  return (
    <>
      {MENU_SEPARATOR}
      {rows.map((r) => {
        const Icon = r.active && busy === r.key ? CircleNotch : r.icon;
        return (
          <button
            key={r.key}
            type="button"
            className={`${item}${r.active ? " has-state" : ""}${r.accent ? " text-(--tmd-accent)" : ""}`}
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
