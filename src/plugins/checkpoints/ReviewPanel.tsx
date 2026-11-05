/** ReviewPanel —— 右栏「处理」宿主(D-01):等待(Ask)/ 变更(checkpoints)双域。
 *  默认域 = 变更(2026-11-05 定稿:点开处理面板先看变更/时间线,等待是事件
 *  驱动入口——有审批时经通知/行灯进入,无需默认占位);Ask 域仅 approval-inbox
 *  插件启用时渲染(settings.disabledPlugins 驱动,禁用不留死钮);双域 keepAlive
 *  隐藏切换(先例 CheckpointsPanel 内部三视图),切域不丢应答草稿/时间线展开态。
 *  通知中心不并入(D-02 独立保留)。 */
import { useState } from "react";
import { BellRinging, GitDiff } from "@phosphor-icons/react";
import { t } from "@kernel/i18n";
import { useSettingsState } from "@kernel/settings";
import { CheckpointsPanel } from "./CheckpointsPanel";
import { ApprovalInboxPanel } from "@plugins/approval-inbox/panel";

function segCls(on: boolean): string {
  return `flex items-center gap-1 rounded px-1.5 text-xs leading-normal ${
    on ? "bg-(--tmd-bg-hover) font-semibold text-(--tmd-fg)" : "text-(--tmd-fg-faint) hover:text-(--tmd-fg)"
  }`;
}

export function ReviewPanel() {
  const { settings } = useSettingsState();
  const askOn = !settings.disabledPlugins.includes("approval-inbox");
  const [domain, setDomain] = useState<"ask" | "ckpt">("ckpt");
  /* 运行期禁用 approval-inbox(改 settings 热生效)时,回落到变更(同为默认域)。 */
  const shown = domain === "ask" && !askOn ? "ckpt" : domain;

  return (
    <div className="flex h-full flex-col bg-(--tmd-bg-base)" data-icon-decor="checkpoints">
      <div className="flex h-[30px] flex-none items-center gap-0.5 border-b border-(--tmd-border) bg-(--tmd-bg-elevated) px-2.5">
        {askOn && (
          <button type="button" className={segCls(shown === "ask")} onClick={() => setDomain("ask")}>
            <BellRinging size="0.6875rem" aria-hidden />
            {t("等待")}
          </button>
        )}
        <button type="button" className={segCls(shown === "ckpt")} onClick={() => setDomain("ckpt")}>
          <GitDiff size="0.6875rem" aria-hidden />
          {t("变更")}
        </button>
      </div>

      {askOn ? (
        <div
          className={shown === "ask" ? "flex min-h-0 flex-1 flex-col" : "hidden"}
          aria-hidden={shown !== "ask"}
        >
          <ApprovalInboxPanel />
        </div>
      ) : null}
      <div
        className={shown === "ckpt" ? "flex min-h-0 flex-1 flex-col" : "hidden"}
        aria-hidden={shown !== "ckpt"}
      >
        <CheckpointsPanel />
      </div>
    </div>
  );
}
