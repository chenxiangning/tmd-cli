/**
 * 看板扫描失败错误条 —— 「N 引擎扫描失败 + 重试」(boardData 记失败引擎集,
 * 扫描失败不伪装成空板;role=alert 可感知)。重试 = 触发 BoardTab 的 refreshTick。
 */
import { ArrowClockwise } from "@phosphor-icons/react";
import { t } from "@kernel/i18n";

export function ScanErrorBar({
  failedEngines,
  onRetry,
}: {
  /** 失败引擎显示名(去重;title 悬停列出)。 */
  failedEngines: string[];
  onRetry: () => void;
}) {
  if (failedEngines.length === 0) return null;
  return (
    <div className="sb-scan-error" role="alert" title={failedEngines.join(", ")}>
      <span>{t("{n} 个引擎扫描失败", { n: failedEngines.length })}</span>
      <button type="button" className="sb-scan-retry" onClick={onRetry}>
        <ArrowClockwise size="0.75rem" aria-hidden />
        {t("重试")}
      </button>
    </div>
  );
}
