/**
 * 主机连接位(单顶栏方案,spec 2026-09-23-mobile-session-compact):
 * 芯片 = 连接点 + 主机名截断,点开 = 底部 sheet(连接状态三行 + 通道钉选 +
 * 断开/重连/重新配对);断连 banner 独立导出,顶栏下方渲染(强告警不折叠)。
 * 状态源 = transport 三态(connected/paused/活动端点)+ hello 版本;
 * 内网/外网按端点 host 判定(私有网段/localhost = 内网,中继域名 = 外网)。
 */
import React from "react";
import { t } from "@kernel/i18n";
import { useMobile, endpointCandidates, endpointKind } from "./shared";
import { loadChannelPin, saveChannelPin } from "./creds";
import {
  activeRemoteEndpoint,
  configureRemoteEndpoint,
  forceRemoteReconnect,
  remoteDisconnect,
  serverVersion,
} from "@kernel/transport";

function stripScheme(s: string): string {
  return s.replace(/^wss?:\/\//, "");
}

/** 通道行标题:内网/外网 + 地址。 */
function channelLabel(url: string): string {
  return `${t(endpointKind(url) === "lan" ? "内网" : "外网")} ${stripScheme(url)}`;
}

/** 状态三行:已连接/重连中/已断开(手动) + 当前通道 + 桌面版本。 */
function StatusPanel(props: {
  hostName: string;
  connected: boolean;
  paused: boolean;
  version: string | null;
}) {
  const { hostName, connected, paused, version } = props;
  const status = connected
    ? { text: t("已连接"), cls: "run" }
    : paused
      ? { text: t("已断开(手动)"), cls: "idle" }
      : { text: t("重连中…"), cls: "err" };
  const active = activeRemoteEndpoint();
  const pin = loadChannelPin();
  return (
    <>
      <div className="sheet-label">{t("状态")}</div>
      <div className="conn-status">
        <div className="cs-row">
          <span className={`sdot ${status.cls}`} />
          <span className="cs-k">{status.text}</span>
          <span className="cs-v">{hostName}</span>
        </div>
        <div className="cs-row">
          <span className="sdot" />
          <span className="cs-k">{t("通道")}</span>
          <span className="cs-v">
            {connected && active
              ? channelLabel(active)
              : pin === "auto"
                ? t("自动(按序竞速)")
                : stripScheme(pin)}
          </span>
        </div>
        <div className="cs-row">
          <span className="sdot" />
          <span className="cs-k">{t("桌面版本")}</span>
          <span className="cs-v">{version ?? (connected ? t("读取中…") : "—")}</span>
        </div>
      </div>
      <div className="sheet-fine">
        {t("内网通道要求手机与电脑在同一局域网;外网通道经中继转发,离开局域网后自动可用。")}
      </div>
    </>
  );
}

/** 通道选择:自动(候选序竞速) + 全部端点(钉选后其它候选不消失)。 */
function ChannelPanel(props: {
  urls: string[];
  active: string | null;
  connected: boolean;
  onPick: (v: string) => void;
}) {
  const pin = loadChannelPin();
  return (
    <>
      <div className="sheet-label">{t("通道")}</div>
      <div className="sheet-opts">
        <button
          type="button"
          className={`sheet-opt${pin === "auto" ? " on" : ""}`}
          onClick={() => props.onPick("auto")}
        >
          <span className="tick">{pin === "auto" ? "✓" : ""}</span>
          {t("自动(按序竞速)")}
        </button>
        {props.urls.map((u) => (
          <button
            key={u}
            type="button"
            className={`sheet-opt${pin === u ? " on" : ""}`}
            onClick={() => props.onPick(u)}
          >
            <span className="tick">{pin === u ? "✓" : ""}</span>
            <span className="min-w-0 flex-1 truncate">{channelLabel(u)}</span>
            {props.connected && props.active === u && <span className="chip b">{t("当前")}</span>}
          </button>
        ))}
      </div>
    </>
  );
}

export function HostChip() {
  const { creds, connected, paused, onRePair } = useMobile();
  const [sheet, setSheet] = React.useState(false);
  const [version, setVersion] = React.useState<string | null>(null);
  /* 选择器列全部端点(钉选后另一通道不得消失);候选序只管竞速。 */
  const urls = creds.urls?.length ? creds.urls : [creds.wsUrl];
  const openSheet = () => {
    setSheet(true);
    /* 版本随开随拉(hello 已缓存则即时返回);事件驱动,不挂 effect。 */
    void serverVersion().then(setVersion).catch(() => setVersion(null));
  };
  const pickChannel = (v: string) => {
    saveChannelPin(v);
    /* 换端点立即生效:重配桥(清手动断开)并强制重拨;auto = 全候选表
     * (桥按连续失败轮换,不再重钉死首项——评审二轮 P1-2)。 */
    if (v === "auto") {
      const list = endpointCandidates(creds);
      configureRemoteEndpoint({ wsUrl: list[0], urls: list, deviceId: creds.deviceId, token: creds.token });
    } else {
      configureRemoteEndpoint({ wsUrl: v, deviceId: creds.deviceId, token: creds.token });
    }
    forceRemoteReconnect();
    setSheet(false);
  };
  return (
    <>
      <button
        type="button"
        className="host-chip"
        aria-label={t("连接选项")}
        onClick={openSheet}
      >
        <span className={`sdot${connected ? " run" : paused ? " idle" : " err"}`} />
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
            <StatusPanel
              hostName={creds.hostName}
              connected={connected}
              paused={paused}
              version={version}
            />
            <ChannelPanel
              urls={urls}
              active={activeRemoteEndpoint()}
              connected={connected}
              onPick={pickChannel}
            />
            <div className="sheet-opts">
              {connected ? (
                <button
                  type="button"
                  className="sheet-opt"
                  onClick={() => {
                    remoteDisconnect();
                    setSheet(false);
                  }}
                >
                  <span className="tick" />
                  {t("断开连接")}
                </button>
              ) : (
                <button
                  type="button"
                  className="sheet-opt"
                  onClick={() => {
                    forceRemoteReconnect();
                    setSheet(false);
                  }}
                >
                  <span className="tick" />
                  {paused ? t("重新连接") : t("重试连接")}
                </button>
              )}
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
            <div className="sheet-fine">
              {paused
                ? t("已手动断开:不会自动重连,点「重新连接」恢复。")
                : t("断开=暂停自动重连(如临时省电);桌面撤销或踢除设备需重新扫码配对。")}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

/** 断连 banner(transport 事件驱动;手动断开不催,连接恢复自动消失)。 */
export function ConnBanner() {
  const { connected, paused } = useMobile();
  if (connected) return null;
  return (
    <div className="banner">
      <span className="dot" />
      {paused ? t("已手动断开连接") : t("连接已断开 · 正在重连")}
      <button type="button" onClick={() => forceRemoteReconnect()}>
        {t("重试")}
      </button>
    </div>
  );
}
