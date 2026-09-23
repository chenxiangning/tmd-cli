/**
 * 主机连接位(单顶栏方案,spec 2026-09-23-mobile-session-compact):
 * 芯片 = 连接点 + 主机名截断,点开 = 底部 sheet(端点钉选/重试/重新配对);
 * 断连 banner 独立导出,顶栏下方渲染(强告警不折叠)。
 * 取代旧 HostBar 双条堆叠,省 ~40px 竖向空间。
 */
import { useState } from "react";
import { t } from "@kernel/i18n";
import { useMobile } from "./shared";
import { endpointCandidates } from "./shared";
import { loadChannelPin, saveChannelPin } from "./creds";
import { forceRemoteReconnect } from "@kernel/transport";

function stripScheme(s: string): string {
  return s.replace(/^wss?:\/\//, "");
}

export function HostChip() {
  const { creds, connected, onRePair } = useMobile();
  const [sheet, setSheet] = useState(false);
  const pin = loadChannelPin();
  const urls = endpointCandidates(creds);
  return (
    <>
      <button
        type="button"
        className="host-chip"
        aria-label={t("连接选项")}
        onClick={() => setSheet(true)}
      >
        <span className={`sdot${connected ? " run" : " err"}`} />
        <span className="hn">{creds.hostName}</span>
        <span className="cv">▾</span>
      </button>
      {sheet && (
        <div className="sheet-scrim" onClick={() => setSheet(false)}>
          <button
            type="button"
            aria-label={t("关闭")}
            style={{ position: "absolute", inset: 0, cursor: "default", background: "none", border: "none" }}
            onClick={() => setSheet(false)}
          />
          <div className="sheet" onClick={(e) => e.stopPropagation()}>
            <div className="sheet-h">{t("连接")}</div>
            <div className="sheet-label">{t("通道")}</div>
            <div className="sheet-opts">
              <button
                type="button"
                className={`sheet-opt${pin === "auto" ? " on" : ""}`}
                onClick={() => {
                  saveChannelPin("auto");
                  forceRemoteReconnect();
                  setSheet(false);
                }}
              >
                <span className="tick">{pin === "auto" ? "✓" : ""}</span>
                {t("自动(按序竞速)")}
              </button>
              {urls.map((u) => (
                <button
                  key={u}
                  type="button"
                  className={`sheet-opt${pin === u ? " on" : ""}`}
                  onClick={() => {
                    saveChannelPin(u);
                    forceRemoteReconnect();
                    setSheet(false);
                  }}
                >
                  <span className="tick">{pin === u ? "✓" : ""}</span>
                  <span className="min-w-0 flex-1 truncate">{stripScheme(u)}</span>
                </button>
              ))}
            </div>
            <div className="sheet-opts">
              <button
                type="button"
                className="sheet-opt"
                onClick={() => {
                  forceRemoteReconnect();
                  setSheet(false);
                }}
              >
                <span className="tick" />
                {t("重试连接")}
              </button>
              <button
                type="button"
                className="sheet-opt"
                style={{ color: "var(--err)" }}
                onClick={() => {
                  setSheet(false);
                  onRePair();
                }}
              >
                <span className="tick" />
                {t("重新配对(扫码)")}
              </button>
            </div>
            {!connected && <div className="sheet-fine">{t("重连中…")}</div>}
          </div>
        </div>
      )}
    </>
  );
}

/** 断连 banner(transport 事件驱动;连接恢复自动消失)。 */
export function ConnBanner() {
  const { connected } = useMobile();
  if (connected) return null;
  return (
    <div className="banner">
      <span className="dot" />
      {t("连接已断开 · 正在重连")}
      <button type="button" onClick={() => forceRemoteReconnect()}>
        {t("重试")}
      </button>
    </div>
  );
}
