/**
 * 增强入口 —— composer.inputRail 贡献(order 50,排 assets 唤醒双图标与平铺广播后):
 * 点击取输入框草稿弹并排对照对话框;草稿为空不响应(与 mossx 同语义)。
 */

import { useMemo, useState } from "react";
import { SparkleIcon } from "@phosphor-icons/react";
import { t } from "@kernel/i18n";
import { composerDraftRef } from "@kernel/composerExt";
import { useWorkspaces } from "@kernel/workspace";
import { EnhanceDialog } from "./EnhanceDialog";

export function EnhanceButton() {
  const [open, setOpen] = useState(false);
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
        onClick={() => {
          if ((composerDraftRef.current?.() ?? "").trim()) setOpen(true);
        }}
        className="flex h-[22px] w-[22px] items-center justify-center rounded-md border border-(--tmd-border) bg-(--tmd-bg-elevated) p-0 text-(--tmd-fg-faint) transition-colors hover:border-(--tmd-accent) hover:text-(--tmd-accent)"
      >
        <SparkleIcon size="0.875rem" />
      </button>
      {open && <EnhanceDialog cwd={cwd} initialDraft={composerDraftRef.current?.() ?? ""} onClose={() => setOpen(false)} />}
    </>
  );
}
