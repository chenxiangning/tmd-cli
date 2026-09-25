/**
 * RemoteControlBadge —— 有浏览器客户端连着本机桥时,titlebar 左区按钮簇最左常驻
 * 远程控制钮(裸 icon;点击深链设置「Web 访问/设备」tab;计数事件即时翻转,
 * 10s 轮询兜底;无连接即不渲染)。颜色吃图标装饰 --icon-decor-remote-control(web-access.css)。
 */

import { useEffect, useState } from "react";
import { MonitorPlay } from "@phosphor-icons/react";
import "./web-access.css";
import { remoteControlActive, onWebRemoteControl } from "@kernel/ipc";
import { openSettingsPanel } from "@kernel/settings";
import { isWeb } from "@kernel/transport";
import { t } from "@kernel/i18n";

const POLL_MS = 10_000;

export function RemoteControlBadge() {
  const [active, setActive] = useState(false);

  useEffect(() => {
    if (isWeb) return;
    let alive = true;
    const tick = async () => {
      try {
        const count = await remoteControlActive();
        if (alive) setActive(count > 0);
      } catch {
        /* 桥未起/桌面尚未装配:视为无连接。 */
      }
    };
    void tick();
    const timer = setInterval(tick, POLL_MS);
    /* 连接 0↔N 边沿时后端广播计数,即时翻转;轮询只做丢事件兜底。 */
    let offCount: (() => void) | null = null;
    void onWebRemoteControl((count) => {
      if (alive) setActive(count > 0);
    }).then((off) => {
      offCount = off;
      if (!alive) off();
    });
    return () => {
      alive = false;
      clearInterval(timer);
      offCount?.();
    };
  }, []);

  if (!active) return null;
  return (
    <button
      type="button"
      className="titlebar-action remote-control-badge"
      aria-label={t("有浏览器客户端正通过 Web 访问控制本机")}
      title={t("有浏览器客户端正通过 Web 访问控制本机")}
      onClick={() => openSettingsPanel({ section: "web-access", tab: "devices" })}
    >
      <MonitorPlay size="0.875rem" aria-hidden />
    </button>
  );
}

