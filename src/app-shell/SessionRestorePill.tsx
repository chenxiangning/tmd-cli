/**
 * 重启现场恢复进度 pill —— 订阅 kernel/sessionRestore 的进度快照,复用
 * wm-toast 固定条(与转录批量导出同款:进度态常驻 + 可取消),完成即自隐。
 * 失败不在此呈现:单 key 失败静默 skip(与保留律/hygiene 同气质)。
 */

import { t } from "@kernel/i18n";
import { skipSessionRestore, useSessionRestoreProgress } from "@kernel/sessionRestore";

export function SessionRestorePill() {
  const progress = useSessionRestoreProgress();
  if (!progress.active) return null;
  return (
    <div className="wm-toast" role="status">
      <span className="wm-toast-text">
        {t("正在恢复上次会话 {done}/{total}", { done: progress.done, total: progress.total })}
      </span>
      <button type="button" className="wm-toast-cancel" onClick={skipSessionRestore}>
        {t("跳过本次恢复")}
      </button>
    </div>
  );
}
