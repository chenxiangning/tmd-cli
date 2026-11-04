/**
 * LayoutResetCard —— 「恢复精简布局」(F-04,系统与数据组):
 * 用户主动确认后重置右缘 rail 钉住清单到当前产品默认(面板 pinnedByDefault
 * ∪ rail 动作钉住默认);只写 tmd.filePanel.pinned.v1,其他 localStorage
 * (autopin 留痕/主题/搜索折叠/工作区)零波及。重置语义见 kernel/filePanel。
 */

import { useState } from "react";
import { ArrowCounterClockwise } from "@phosphor-icons/react";
import { t } from "@kernel/i18n";
import { ConfirmDialog } from "@kernel/DialogConfirm";
import { resetPinnedToProductDefaults } from "@kernel/filePanel";

export function LayoutResetCard() {
  const [confirming, setConfirming] = useState(false);
  const [done, setDone] = useState(false);
  return (
    <section className="mb-5">
      <h3 className="mb-1 font-semibold">{t("布局")}</h3>
      <p className="mb-2 text-(--tmd-fg-muted)">
        {t("把右缘 rail 的钉住清单重置为当前产品默认;不影响工作区、主题、搜索折叠等其他设置。")}
      </p>
      {done && (
        <p className="mb-2 text-(--tmd-fg-muted)" role="status">
          {t("已恢复默认钉住。可在右缘 rail 的 ⋯ 菜单重新勾选。")}
        </p>
      )}
      <button
        type="button"
        className="h-6 rounded border border-(--tmd-border) px-2 text-(--tmd-fg-muted) hover:bg-(--tmd-bg-hover)"
        onClick={() => setConfirming(true)}
      >
        <ArrowCounterClockwise size="0.75rem" aria-hidden /> {t("恢复精简布局")}
      </button>
      {confirming && (
        <ConfirmDialog
          title={t("恢复精简布局")}
          message={t("确定要把右缘钉住清单重置为默认吗?只影响钉住外显,不清任何数据。")}
          confirmLabel={t("恢复")}
          icon={<ArrowCounterClockwise size="0.875rem" aria-hidden />}
          onConfirm={() => {
            resetPinnedToProductDefaults();
            setDone(true);
            setConfirming(false);
          }}
          onClose={() => setConfirming(false)}
        />
      )}
    </section>
  );
}
