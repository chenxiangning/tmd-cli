/**
 * 增强入口 —— composer.inputRail 贡献(order 50,排 assets 唤醒双图标与平铺广播后):
 * 图标与全局快捷键(⌘⌥E,注册见插件入口)同走 enhanceOpen store;对话框在此挂载,
 * 命令路径共享同一渲染点。草稿为空不响应(两路同语义,守卫在 openEnhance)。
 */

import { useMemo } from "react";
import { SparkleIcon } from "@phosphor-icons/react";
import { t } from "@kernel/i18n";
import { composerDraftRef } from "@kernel/composerExt";
import { useWorkspaces } from "@kernel/workspace";
import { EnhanceDialog } from "./EnhanceDialog";
import { closeEnhance, openEnhance, useEnhanceOpen } from "./enhanceOpen";

export function EnhanceButton() {
  const open = useEnhanceOpen();
  const workspaces = useWorkspaces();
  const cwd = useMemo(
    () => workspaces.list.find((w) => w.id === workspaces.activeId)?.root ?? workspaces.list[0]?.root ?? "",
    [workspaces],
  );
  return (
    <>
      <button
        type="button"
        title={t("增强提示词")}
        aria-label={t("增强提示词")}
        onClick={openEnhance}
        className="flex h-[22px] w-[22px] items-center justify-center rounded-md border border-(--tmd-border) bg-(--tmd-bg-elevated) p-0 text-(--tmd-fg-faint) transition-colors hover:border-(--tmd-accent) hover:text-(--tmd-accent)"
      >
        <SparkleIcon size="0.875rem" />
      </button>
      {open && (
        <EnhanceDialog
          cwd={cwd}
          workspaceId={workspaces.activeId ?? null}
          initialDraft={composerDraftRef.current?.() ?? ""}
          onClose={closeEnhance}
        />
      )}
    </>
  );
}
