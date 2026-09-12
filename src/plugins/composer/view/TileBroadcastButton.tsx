/**
 * 平铺广播开关 —— composer.inputRail 贡献:仅「平铺显示」态出现。
 *
 * 开 = 后续 composer 正常发送(⌘/Ctrl+Enter 或发送键)改走广播路径,题面一次性
 * 喂给平铺全部幕布;关 = 原单发路线。实际分支在 useComposerSend(经
 * broadcastModeRef 活读,零额外渲染开销);本组件只管开关态 + 左下滑出提示。
 * 平铺关闭时本按钮不渲染,发送路径因 tile/目标数守卫自动回落单发(开关不重置,
 * 再平铺即恢复广播)。
 */

import { useEffect, useRef, useState } from "react";
import { BroadcastIcon } from "@phosphor-icons/react";
import { useSessionTabs } from "@kernel/sessionTabs";
import { t } from "@kernel/i18n";
import { broadcastModeRef } from "./broadcastMode";

export function TileBroadcastButton() {
  const { tile } = useSessionTabs();
  const [on, setOn] = useState(broadcastModeRef.current);
  const [toast, setToast] = useState(false);
  const timer = useRef<number | null>(null);
  useEffect(() => () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
  }, []);
  if (!tile) return null;

  function toggle() {
    const next = !broadcastModeRef.current;
    broadcastModeRef.current = next;
    setOn(next);
    if (next) {
      setToast(true);
      if (timer.current !== null) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setToast(false), 2200);
    } else {
      setToast(false);
    }
  }

  return (
    <>
      <button
        type="button"
        className={`composer-broadcast-btn${on ? " is-on" : ""}`}
        title={t("广播开关:开启后发送进平铺全部幕布")}
        aria-label={t("广播开关:开启后发送进平铺全部幕布")}
        aria-pressed={on}
        onClick={toggle}
      >
        <BroadcastIcon size="0.875rem" />
      </button>
      {toast && (
        <div className="composer-broadcast-toast" role="status">
          {t("广播已开启:发送将进入平铺全部幕布")}
        </div>
      )}
    </>
  );
}
