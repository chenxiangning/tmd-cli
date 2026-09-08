/**
 * diff 头部控制组 —— 全文查看开关(可选,per-tab 本地态:默认关,
 * 换文件即复位,用户点开才拉全上下文 patch)+ 单栏/双栏 segmented
 * (全局落盘,settings git 域)。复用 settings 的 segmented/segment 类,零新增 CSS。
 */

import { ColumnsIcon, FileTextIcon, RowsIcon } from "@phosphor-icons/react";

import { t } from "@kernel/i18n";
import type { GitDiffMode } from "@kernel/settings";
import { setGitDiffMode, useGitPanelState } from "../panelStore";

const OPTIONS: { id: GitDiffMode; label: string; icon: typeof RowsIcon }[] = [
  { id: "unified", label: "单栏", icon: RowsIcon },
  { id: "split", label: "双栏", icon: ColumnsIcon },
];

export function DiffModeToggle({
  fullView,
  onToggleFullView,
}: {
  /** 提供即渲染「全文查看」开关(per-tab 本地态);缺省不出按钮。 */
  fullView?: boolean;
  onToggleFullView?: () => void;
}) {
  const { diffMode } = useGitPanelState();
  return (
    <div className="flex shrink-0 items-center gap-1.5">
      {onToggleFullView && (
        <div className="segmented shrink-0" role="group" aria-label={t("全文查看")}>
          <button
            type="button"
            aria-pressed={fullView}
            title={t("全文查看")}
            className={`segment ${fullView ? "is-active" : ""}`}
            onClick={onToggleFullView}
          >
            <FileTextIcon className="h-[0.75rem] w-[0.75rem]" />
            {t("全文")}
          </button>
        </div>
      )}
      <div className="segmented shrink-0" role="radiogroup" aria-label={t("diff 展示模式")}>
        {OPTIONS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={diffMode === id}
            title={t(label)}
            className={`segment ${diffMode === id ? "is-active" : ""}`}
            onClick={() => setGitDiffMode(id)}
          >
            <Icon className="h-[0.75rem] w-[0.75rem]" />
            {t(label)}
          </button>
        ))}
      </div>
    </div>
  );
}
