/** 配置表单保存生命周期:单飞、卸载隔离、成功反馈定时器清理。 */
import { useEffect, useRef, useState } from "react";
import { errTextDisplay } from "@kernel/errText";
import { t } from "@kernel/i18n";

export function useConfigSave(
  onSaved: (nextRaw: string) => Promise<void>,
  onSuccess: (nextRaw: string) => void,
) {
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const savingRef = useRef(false);
  const aliveRef = useRef(true);
  const toastTimerRef = useRef<number | null>(null);

  const clearToastTimer = () => {
    if (toastTimerRef.current !== null) window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = null;
  };
  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
      clearToastTimer();
    };
  }, []);

  const save = async (nextRaw: string) => {
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setSaveError(null);
    try {
      await onSaved(nextRaw);
      if (!aliveRef.current) return;
      onSuccess(nextRaw);
      clearToastTimer();
      setToast(t("已保存到磁盘(首次写入前已留 .bak-tmd 备份)"));
      const timer = window.setTimeout(() => {
        if (toastTimerRef.current !== timer) return;
        toastTimerRef.current = null;
        if (aliveRef.current) setToast(null);
      }, 2600);
      toastTimerRef.current = timer;
    } catch (e) {
      if (!aliveRef.current) return;
      clearToastTimer();
      setToast(null);
      setSaveError(t("保存失败:{msg}", { msg: errTextDisplay(e) }));
    } finally {
      savingRef.current = false;
      if (aliveRef.current) setSaving(false);
    }
  };

  return { saving, toast, saveError, clearSaveError: () => setSaveError(null), save };
}
