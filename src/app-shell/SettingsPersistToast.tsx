/**
 * 设置写盘失败通知 —— 右下角 toast,订阅 kernel settingsPersistFailed。
 *
 * 背景:Tauri 环境 persistNow 写盘失败(磁盘满/杀软锁 tmp)时盘上旧文件仍
 * 完好 → 重启回读旧值,localStorage 兜底永远不生效,用户改动静默丢失。
 * 呈现复用 StartFailureToast 的卡片样式(start-failure-toast.css)。
 */

import { useEffect, useRef, useState } from "react";
import { Warning, Cross } from "@phosphor-icons/react";
import { t } from "@kernel/i18n";
import { onSettingsPersistFailed } from "@kernel/settings";

const NOTICE_TTL_MS = 12_000;

export function SettingsPersistToast() {
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<number | null>(null);

  useEffect(() => {
    const off = onSettingsPersistFailed((error) => {
      setError(error);
      if (timer.current !== null) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setError(null), NOTICE_TTL_MS);
    });
    return () => {
      off();
      if (timer.current !== null) window.clearTimeout(timer.current);
    };
  }, []);

  if (error === null) return null;
  return (
    <div className="sft-stack" role="alert">
      <div className="sft-card">
        <div className="sft-head">
          <Warning size="0.875rem" className="sft-icon" aria-hidden />
          <span className="sft-title">{t("设置保存失败,重启后将丢失本次改动")}</span>
          <button
            type="button"
            className="sft-close"
            aria-label={t("关闭设置保存失败通知")}
            onClick={() => setError(null)}
          >
            <Cross size="0.75rem" aria-hidden />
          </button>
        </div>
        <pre className="sft-reason">{error}</pre>
      </div>
    </div>
  );
}
