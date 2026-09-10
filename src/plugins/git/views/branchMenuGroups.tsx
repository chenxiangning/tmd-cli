/**
 * 分支右键菜单的菜单项组 —— 全 11 项语义(顺序/禁用规则同 codemoss)。
 * 自 BranchContextMenu.tsx 拆出(no-high-complexity 降分支):分组成五个
 * fragment 组件,共同禁用态收敛进 historyOpState/upstreamBlocked 纯函数。
 */

import { t } from "@kernel/i18n";
import {
  CloudArrowDown,
  DownloadSimple,
  FileText,
  Folders,
  GitBranch,
  GitMerge,
  Pencil,
  Plus,
  ArrowClockwise,
  Repeat,
  Trash,
  UploadSimple,
} from "@phosphor-icons/react";
import type { GitBranchInfo } from "@kernel/ipc";
import type { BranchMenuActions } from "./BranchContextMenu";

/** 菜单项组的共用语境(禁用规则与动作转发)。 */
export interface MenuCtx {
  branch: GitBranchInfo;
  currentName: string | undefined;
  isRemote: boolean;
  isCurrent: boolean;
  hasUpstream: boolean;
  hasCurrent: boolean;
  busy: boolean;
  actions: BranchMenuActions;
  onClose: () => void;
}

/** 菜单行构造(无捕获纯函数)。 */
function item(
  label: string,
  icon: React.ReactNode,
  onPick: () => void,
  extra?: { danger?: boolean; disabled?: boolean; title?: string },
) {
  return (
    <button
      type="button"
      disabled={extra?.disabled}
      title={extra?.title}
      className={`wsmenu-item disabled:opacity-40 disabled:cursor-default${
        extra?.danger ? " is-danger" : ""
      }`}
      onClick={onPick}
    >
      <span className="wsmenu-item-icon">{icon}</span>
      <span className="wsmenu-item-label">{label}</span>
    </button>
  );
}

/** 菜单项统一动作:先关菜单再转发动作(与拆分前逐项一致)。 */
function pick(ctx: MenuCtx, run: (b: GitBranchInfo) => void): () => void {
  return () => {
    ctx.onClose();
    run(ctx.branch);
  };
}

/** 变基/合并/签出并变基的共同禁用态:当前分支、远程分支、无当前分支、busy。 */
function historyOpState(ctx: MenuCtx): { disabled: boolean; title: string | undefined } {
  return {
    disabled: ctx.busy || ctx.isCurrent || ctx.isRemote || !ctx.hasCurrent,
    title: ctx.isCurrent
      ? t("当前分支不可用该操作")
      : ctx.isRemote
        ? t("仅本地分支可用")
        : !ctx.hasCurrent
          ? t("未检测到当前分支")
          : undefined,
  };
}

/** 本地分支无 upstream 时更新/获取不可用。 */
function upstreamBlocked(ctx: MenuCtx): boolean {
  return !ctx.isRemote && !ctx.hasUpstream;
}

/** 签出/从 X 新建分支/签出并变基。 */
function CheckoutGroup({ ctx }: { ctx: MenuCtx }) {
  return (
    <>
      {ctx.isRemote
        ? item(t("检出到本地"), <GitBranch size="0.8125rem" />, pick(ctx, ctx.actions.checkout))
        : item(t("切换"), <GitBranch size="0.8125rem" />, pick(ctx, ctx.actions.checkout), {
            disabled: ctx.isCurrent || ctx.busy,
            title: ctx.isCurrent ? t("已是当前分支") : undefined,
          })}
      {item(t("从 {branch} 新建分支...", { branch: ctx.branch.name }), <Plus size="0.8125rem" />, pick(ctx, ctx.actions.createFrom), { disabled: ctx.busy })}
      {item(
        t("签出并变基到 {branch}", { branch: ctx.currentName ?? "?" }),
        <Repeat size="0.8125rem" />,
        pick(ctx, ctx.actions.checkoutRebase),
        historyOpState(ctx),
      )}
    </>
  );
}

/** 与当前分支比较 / 显示与工作树的差异。 */
function CompareGroup({ ctx }: { ctx: MenuCtx }) {
  const needCurrentTitle = t("未检测到当前分支");
  return (
    <>
      {item(
        t("与 {branch} 比较", { branch: ctx.currentName ?? "?" }),
        <FileText size="0.8125rem" />,
        pick(ctx, ctx.actions.compareWithCurrent),
        {
          disabled: ctx.busy || ctx.isCurrent || !ctx.hasCurrent,
          title: ctx.isCurrent ? t("当前分支不可用该操作") : !ctx.hasCurrent ? needCurrentTitle : undefined,
        },
      )}
      {item(t("显示与工作树的差异"), <Folders size="0.8125rem" />, pick(ctx, ctx.actions.diffWithWorktree), { disabled: ctx.busy })}
    </>
  );
}

/** 将当前分支变基到该分支 / 将该分支合并到当前分支。 */
function HistoryOpsGroup({ ctx }: { ctx: MenuCtx }) {
  return (
    <>
      {item(
        t("将 {current} 变基到 {branch}", { current: ctx.currentName ?? "?", branch: ctx.branch.name }),
        <ArrowClockwise size="0.8125rem" />,
        pick(ctx, ctx.actions.rebaseCurrentOnto),
        historyOpState(ctx),
      )}
      {item(
        t("将 {branch} 合并到 {current} 中", { branch: ctx.branch.name, current: ctx.currentName ?? "?" }),
        <GitMerge size="0.8125rem" />,
        pick(ctx, ctx.actions.mergeIntoCurrent),
        historyOpState(ctx),
      )}
    </>
  );
}

/** 更新 / 获取(tmd-cli 超集:单分支引用刷新)/ 推送...(仅当前,开对话框)。 */
function RemoteSyncGroup({ ctx }: { ctx: MenuCtx }) {
  return (
    <>
      {item(t("更新"), <DownloadSimple size="0.8125rem" />, pick(ctx, ctx.actions.pull), {
        disabled: ctx.busy || upstreamBlocked(ctx),
        title: upstreamBlocked(ctx)
          ? t("无 upstream,无法更新")
          : ctx.isCurrent
            ? t("跟随上游与 pull.rebase 配置")
            : t("仅 fast-forward 该分支引用,不切分支"),
      })}
      {item(t("获取"), <CloudArrowDown size="0.8125rem" />, pick(ctx, ctx.actions.fetch), {
        disabled: ctx.busy || upstreamBlocked(ctx),
        title: upstreamBlocked(ctx) ? t("无 upstream") : t("只刷新远端引用,不动本地分支"),
      })}
      {!ctx.isRemote &&
        item(t("推送..."), <UploadSimple size="0.8125rem" />, pick(ctx, ctx.actions.push), {
          disabled: ctx.busy || !ctx.isCurrent,
          title: !ctx.isCurrent ? t("仅当前分支可推送") : t("打开推送对话框(可预览/选目标)"),
        })}
    </>
  );
}

/** 重命名 / 删除(仅本地;删除 danger,未合并由后端拒绝)。 */
function LocalMutateGroup({ ctx }: { ctx: MenuCtx }) {
  if (ctx.isRemote) return null;
  return (
    <>
      {item(t("重命名..."), <Pencil size="0.8125rem" />, pick(ctx, ctx.actions.rename), { disabled: ctx.busy })}
      {item(t("删除"), <Trash size="0.8125rem" />, pick(ctx, ctx.actions.remove), {
        danger: true,
        disabled: ctx.isCurrent || ctx.busy,
        title: ctx.isCurrent ? t("不能删除当前分支") : undefined,
      })}
    </>
  );
}

/** 菜单全项 + 分组分隔(顺序红线:拆分前后逐项一致)。 */
export function BranchMenuItems({ ctx }: { ctx: MenuCtx }) {
  return (
    <>
      <CheckoutGroup ctx={ctx} />
      <div className="wsmenu-divider" />
      <CompareGroup ctx={ctx} />
      <div className="wsmenu-divider" />
      <HistoryOpsGroup ctx={ctx} />
      <div className="wsmenu-divider" />
      <RemoteSyncGroup ctx={ctx} />
      <div className="wsmenu-divider" />
      <LocalMutateGroup ctx={ctx} />
    </>
  );
}
