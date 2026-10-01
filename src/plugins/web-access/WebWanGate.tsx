/**
 * 外网 tab 门:首次开启前先弹 WebWanRiskDialog 一次性确认(localStorage 记忆,
 * 本机一次性,故意不做跨机同步 —— 风险承诺不该被中继带到陌生设备上)。
 * 接受后渲染传入的 Pane(Cloudflare/自建两 tab 各包一次;确认态全局共享,
 * 只弹一次);「取消」关闭模态退到非模态静态门(tab 仍可达,可再入弹窗)。
 */

import { useState, type ComponentType } from "react";
import { t } from "@kernel/i18n";
import { readWanRiskAccepted } from "./wanRiskAccepted";
import { WebWanRiskDialog } from "./WebWanRiskDialog";

export function WebWanGate({ Pane }: { Pane: ComponentType }) {
  const [accepted, setAccepted] = useState(readWanRiskAccepted);
  const [dismissed, setDismissed] = useState(false);

  if (accepted) {
    return <Pane />;
  }
  if (dismissed) {
    /* 拒绝后的静态门:不弹窗、不渲染中继控件,只留再入风险提示的入口。 */
    return (
      <div className="flex flex-col items-start gap-3 p-6">
        <div className="text-sm font-medium text-[var(--tmd-fg)]">
          {t("外网访问未启用")}
        </div>
        <div className="text-xs text-[var(--tmd-fg-muted)]">
          {t("首次使用前需先阅读并确认外网风险提示;确认前不展示中继配置。")}
        </div>
        <button
          type="button"
          className="rounded border border-[var(--tmd-border)] px-3 py-1.5 text-xs hover:bg-[var(--tmd-bg-hover)]"
          onClick={() => setDismissed(false)}
        >
          {t("查看风险提示")}
        </button>
      </div>
    );
  }
  return (
    <WebWanRiskDialog
      onAccept={() => setAccepted(true)}
      onReject={() => setDismissed(true)}
    />
  );
}
