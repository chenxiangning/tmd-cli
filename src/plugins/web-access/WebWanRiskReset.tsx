/**
 * 设置「安全」区:外网风险确认的重置入口。清掉本机确认标记后,
 * 外网 tab 的风险门(WebWanGate)重新弹出 —— 提示可再看、承诺可重给。
 */

import { useState } from "react";
import { ShieldWarning } from "@phosphor-icons/react";
import { t } from "@kernel/i18n";
import { clearWanRiskAccepted, readWanRiskAccepted } from "./wanRiskAccepted";

export function WebWanRiskReset() {
  const [accepted, setAccepted] = useState(readWanRiskAccepted);

  return (
    <div className="flex flex-col gap-3 p-4">
      <div className="flex items-center gap-2 text-sm font-medium">
        <ShieldWarning size="1rem" aria-hidden />
        {t("外网风险提示")}
      </div>
      <div className="text-xs text-[var(--tmd-fg-muted)]">
        {t(
          "首次进入外网 tab 前的一次性风险确认只记在本机(不随中继同步)。点击下方按钮清除确认记录,外网 tab 将重新弹出风险提示。",
        )}
      </div>
      <div className="text-xs text-[var(--tmd-fg-muted)]">
        {t("当前状态")}:{accepted ? t("已确认") : t("未确认")}
      </div>
      <div>
        <button
          type="button"
          className="rounded border border-[var(--tmd-border)] px-3 py-1.5 text-xs hover:bg-[var(--tmd-bg-hover)] disabled:opacity-50"
          disabled={!accepted}
          onClick={() => {
            clearWanRiskAccepted();
            setAccepted(readWanRiskAccepted());
          }}
        >
          {t("重看外网风险提示")}
        </button>
      </div>
    </div>
  );
}
