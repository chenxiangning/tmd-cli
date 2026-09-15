/**
 * 外网访问风险确认弹窗:首次开启「外网访问」tab 前一次性确认。
 * 文案与 codemoss 对齐(权限与本机完全相同;授权/密钥/用完断 relay)。
 * 确认状态只记本机 localStorage,不跨机同步(是故意的:风险确认是
 * 「这台电脑的操作者」的承诺,不该被中继带到任何一台陌生设备上)。
 */

import { useState } from "react";
import { WarningIcon as Warning } from "@phosphor-icons/react";
import { t } from "@kernel/i18n";

const STORAGE_KEY = "tmd.webWanRiskAccepted";

export function readWanRiskAccepted(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

export function writeWanRiskAccepted(): void {
  try {
    localStorage.setItem(STORAGE_KEY, "1");
  } catch {
    /* localStorage 不可写时等同每次询问 —— 更严,放行 */
  }
}

interface Props {
  onAccept: () => void;
  onReject: () => void;
}

export function WebWanRiskDialog({ onAccept, onReject }: Props) {
  const [leaving, setLeaving] = useState(false);
  const accept = () => {
    setLeaving(true);
    writeWanRiskAccepted();
    onAccept();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-md rounded-lg border border-[var(--tmd-border)] bg-[var(--tmd-bg)] p-4 shadow-xl">
        <div className="mb-2 flex items-center gap-2 text-base font-semibold text-[var(--tmd-error)]">
          <Warning size="1rem" weight="fill" aria-hidden />
          {t("外网访问:请先了解风险")}
        </div>
        <div className="mb-3 text-sm text-[var(--tmd-fg)]">
          {t("开启后,任何知道你中继地址和密钥的人都能读写文件、运行终端命令、消耗 API 额度 —— 权限与本机完全相同。")}
        </div>
        <div className="mb-4 rounded border border-[var(--tmd-border)] bg-[var(--tmd-bg-muted)] p-2.5 text-xs text-[var(--tmd-fg-muted)]">
          <div className="mb-1 font-medium text-[var(--tmd-fg)]">{t("安全约定:")}</div>
          <ul className="list-inside list-disc space-y-0.5">
            <li>{t("只授权自己的设备")}</li>
            <li>{t("不转发中继地址或密钥")}</li>
            <li>{t("用完即断开中继")}</li>
            <li>{t("定期删除闲置设备")}</li>
          </ul>
        </div>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            className="rounded border border-[var(--tmd-border)] px-3 py-1.5 text-xs hover:bg-[var(--tmd-bg-hover)]"
            onClick={onReject}
            disabled={leaving}
          >
            {t("取消")}
          </button>
          <button
            type="button"
            className="rounded border border-[var(--tmd-error)] bg-[var(--tmd-error)]/15 px-3 py-1.5 text-xs text-[var(--tmd-error)] hover:bg-[var(--tmd-error)]/25"
            onClick={accept}
            disabled={leaving}
          >
            {t("我已了解并自行承担风险")}
          </button>
        </div>
      </div>
    </div>
  );
}
