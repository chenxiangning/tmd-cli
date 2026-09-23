/**
 * 外网中继连接卡:中继 URL/key 输入、连接/断开、状态点+tooltip 承载错误。
 * 连接时自动带起 LAN 桥(relay 只经 127.0.0.1 桥进出,自身不开端口)。
 * 组件拆分为状态宿主(WebRelayCard)与呈现体(WebRelayCardBody),拆至本文件;
 * 状态纯函数在 relayStatusModel.ts(only-export-components / no-high-complexity)。
 */

import { useCallback, useEffect, useState } from "react";
import { ArrowsClockwiseIcon as ArrowsClockwise, LinkSimpleIcon as LinkSimple } from "@phosphor-icons/react";
import { onWebRelay, webRelayStart, webRelayStatus, webRelayStop, type RelayInfo } from "@kernel/ipc";
import { isWeb } from "@kernel/transport";
import { updateSettings, useSettingsState } from "@kernel/settings";
import { t } from "@kernel/i18n";
import { relayStatusDot, relayStatusText } from "./relayStatusModel";

interface WebRelayCardBodyProps {
  info: RelayInfo | null;
  error: string | null;
  busy: boolean;
  url: string;
  relayKey: string;
  onUrlChange: (v: string) => void;
  onKeyChange: (v: string) => void;
  onConnect: () => void;
  onDisconnect: () => void;
}

export function WebRelayCardBody({
  info,
  error,
  busy,
  url,
  relayKey,
  onUrlChange,
  onKeyChange,
  onConnect,
  onDisconnect,
}: WebRelayCardBodyProps) {
  const statusDot = relayStatusDot(info);
  const statusText = relayStatusText(info);

  return (
    <div className="flex flex-col gap-2 rounded border border-[var(--tmd-border)] p-3">
      <div className="flex items-center gap-2 text-sm font-medium">
        <LinkSimple size="1rem" aria-hidden />
        {t("连接中继")}
      </div>
      <div className="text-xs text-[var(--tmd-fg-muted)]">
        {t("手机在外网经中继访问本机;中继只认 key 搬字节,桥内仍走 token/设备授权。")}
      </div>
      <input
        type="text"
        className="rounded border border-[var(--tmd-border)] bg-transparent px-2 py-1 text-xs"
        placeholder={t("中继 Worker URL(如 https://tmd-relay.<sub>.workers.dev)")}
        value={url}
        onChange={(e) => onUrlChange(e.target.value)}
        autoComplete="off"
        disabled={busy || isWeb}
      />
      <input
        type="password"
        className="rounded border border-[var(--tmd-border)] bg-transparent px-2 py-1 text-xs"
        placeholder={t("中继密钥(部署时自动铸造,或自行设强密码)")}
        value={relayKey}
        onChange={(e) => onKeyChange(e.target.value)}
        autoComplete="off"
        disabled={busy || isWeb}
      />
      {error && (
        <div className="rounded border border-[var(--tmd-error)]/40 bg-[var(--tmd-error)]/10 px-2.5 py-1.5 text-xs text-[var(--tmd-error)]">
          {error}
        </div>
      )}
      <div className="flex items-center gap-2 text-xs">
        <span title={info?.error ?? undefined}>
          {statusDot} {statusText}
        </span>
        {info && (
          <code className="min-w-0 flex-1 truncate rounded border border-[var(--tmd-border)] bg-[var(--tmd-bg-muted)] px-2 py-0.5">
            {info.url}
          </code>
        )}
      </div>
      <div className="flex gap-2">
        {info ? (
          <button
            type="button"
            className="flex items-center gap-1 rounded border border-[var(--tmd-border)] px-2 py-1 text-xs hover:bg-[var(--tmd-bg-hover)] disabled:opacity-50"
            onClick={onDisconnect}
            disabled={busy || isWeb}
          >
            {t("断开")}
          </button>
        ) : (
          <button
            type="button"
            className="flex items-center gap-1 rounded border border-[var(--tmd-border)] px-2 py-1 text-xs hover:bg-[var(--tmd-bg-hover)] disabled:opacity-50"
            onClick={onConnect}
            disabled={busy || isWeb || !url.trim() || !relayKey.trim()}
          >
            <ArrowsClockwise size="0.75rem" aria-hidden />
            {busy ? t("连接中…") : t("连接中继")}
          </button>
        )}
      </div>
      {isWeb && (
        <div className="flex items-center gap-1.5 text-xs text-[var(--tmd-fg-muted)]">
          <ArrowsClockwise size="0.75rem" aria-hidden />
          {t("当前正通过中继查看(权限与本机相同)")}
        </div>
      )}
    </div>
  );
}

export function WebRelayCard() {
  const { settings } = useSettingsState();
  const [url, setUrl] = useState(settings.webRelayUrl);
  const [relayKey, setRelayKey] = useState(settings.webRelayKey);
  const [info, setInfo] = useState<RelayInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setInfo(await webRelayStatus());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  /* 部署卡铸 key 只写 settings;本卡挂载时一次性拷贝会漏掉同屏部署产物
  (用户看到空 key 栏只能瞎填)。settings 变化即回填;手输不触发 settings
  变化,不会覆盖打字;connect 自写自读同值,幂等。 */
  useEffect(() => {
    setUrl(settings.webRelayUrl);
    setRelayKey(settings.webRelayKey);
  }, [settings.webRelayUrl, settings.webRelayKey]);

  useEffect(() => {
    void refresh();
    /* 中继状态事件驱动刷新(payload 恒 Null,仅作信号;实况经 webRelayStatus 重查)。 */
    let unlisten: (() => void) | null = null;
    onWebRelay((next) => setInfo(next)).then((fn) => {
      unlisten = fn;
    });
    return () => {
      unlisten?.();
    };
  }, [refresh]);

  const connect = async () => {
    setBusy(true);
    setError(null);
    try {
      // 只持久化 URL/key;webRelayOn 由 Rust 侧 web_relay_start 成功后落盘,
      // 避免「start 失败但 webRelayOn:true 已落盘」导致下次启动自动重拨失败 relay。
      updateSettings({ webRelayUrl: url, webRelayKey: relayKey });
      setInfo(await webRelayStart(url, relayKey));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async () => {
    setBusy(true);
    setError(null);
    try {
      // webRelayOn 由 Rust 侧 web_relay_stop 落盘为 false。
      await webRelayStop();
      setInfo(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <WebRelayCardBody
      info={info}
      error={error}
      busy={busy}
      url={url}
      relayKey={relayKey}
      onUrlChange={setUrl}
      onKeyChange={setRelayKey}
      onConnect={connect}
      onDisconnect={disconnect}
    />
  );
}
