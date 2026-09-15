/**
 * 外网中继连接卡:中继 URL/key 输入、连接/断开、状态点+tooltip 承载错误。
 * 连接时自动带起 LAN 桥(relay 只经 127.0.0.1 桥进出,自身不开端口)。
 */

import { useCallback, useEffect, useState } from "react";
import { ArrowsClockwiseIcon as ArrowsClockwise, LinkSimpleIcon as LinkSimple } from "@phosphor-icons/react";
import { onWebRelay, webRelayStart, webRelayStatus, webRelayStop, type RelayInfo } from "@kernel/ipc";
import { isWeb } from "@kernel/transport";
import { updateSettings, useSettingsState } from "@kernel/settings";
import { t } from "@kernel/i18n";

export function WebRelayCard() {
  const { settings } = useSettingsState();
  const [url, setUrl] = useState(settings.webRelayUrl);
  const [key, setKey] = useState(settings.webRelayKey);
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

  useEffect(() => {
    void refresh();
    /* 中继状态事件驱动刷新(事件 payload 恒 Null,只作信号)。 */
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
      updateSettings({ webRelayUrl: url, webRelayKey: key, webRelayOn: true });
      setInfo(await webRelayStart(url, key));
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
      updateSettings({ webRelayOn: false });
      await webRelayStop();
      setInfo(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const statusDot = info?.connected ? "🟢" : info ? "🟡" : "⚪";
  const statusText = info?.connected
    ? t("已连接")
    : info?.error
      ? info.error
      : info
        ? t("连接中…")
        : t("未连接");

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
        onChange={(e) => setUrl(e.target.value)}
        autoComplete="off"
        disabled={busy || isWeb}
      />
      <input
        type="password"
        className="rounded border border-[var(--tmd-border)] bg-transparent px-2 py-1 text-xs"
        placeholder={t("中继密钥(部署时自动铸造,或自行设强密码)")}
        value={key}
        onChange={(e) => setKey(e.target.value)}
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
            onClick={disconnect}
            disabled={busy || isWeb}
          >
            {t("断开")}
          </button>
        ) : (
          <button
            type="button"
            className="flex items-center gap-1 rounded border border-[var(--tmd-border)] px-2 py-1 text-xs hover:bg-[var(--tmd-bg-hover)] disabled:opacity-50"
            onClick={connect}
            disabled={busy || isWeb || !url.trim() || !key.trim()}
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
