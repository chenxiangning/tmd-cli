/**
 * WebAccessSection —— 「Web 访问」设置卡:启动/停止桥、token URL + 二维码、
 * 桥状态展示。LAN 一层 token(M1);外网卡与设备配对随 M2 增补。
 * web 端(isWeb)隐藏面控按钮(桥的启停是桌面职责);浏览器会话的权限
 * 与本机等权(token 即凭据),风险提示随 M2 外网卡弹窗一并给出。
 */

import { useCallback, useEffect, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { Globe, Copy, ArrowsClockwise } from "@phosphor-icons/react";
import { webAccessStatus, type WebAccessInfo } from "@kernel/ipc";
import { isWeb } from "@kernel/transport";
import { updateSettings, useSettingsState } from "@kernel/settings";
import { t } from "@kernel/i18n";

export function WebAccessSection() {
  const [info, setInfo] = useState<WebAccessInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const { settings } = useSettingsState();
  const enabled = settings.webAccessEnabled === true;

  const refresh = useCallback(async () => {
    try {
      setInfo(await webAccessStatus());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  /* 开关即写设置;后端 config_write_settings 钩子负责起停桥,轮询刷新状态回显。 */
  const setEnabled = (on: boolean) => {
    setBusy(true);
    try {
      updateSettings({ webAccessEnabled: on });
      setError(null);
    } finally {
      setBusy(false);
      setTimeout(() => void refresh(), 600);
    }
  };
  const copy = async () => {
    if (!info) return;
    await navigator.clipboard.writeText(info.url);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="flex flex-col gap-3 p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Globe size="1rem" aria-hidden />
          {t("内网 Web 访问")}
        </div>
        <label className="flex cursor-pointer items-center gap-2 text-xs">
          <input
            type="checkbox"
            checked={enabled}
            disabled={busy || isWeb}
            onChange={(e) => setEnabled(e.target.checked)}
          />
          {enabled ? t("已开启") : t("已关闭")}
        </label>
      </div>
      <div className="text-xs text-[var(--tmd-fg-muted)]">
        {t("同一 Wi-Fi 下的手机/平板浏览器打开下方地址即可访问本机会话。地址含一次性 token,每次启动都会重新生成,不要转发给他人。")}
      </div>
      {error && (
        <div className="rounded border border-[var(--tmd-error)]/40 bg-[var(--tmd-error)]/10 px-2.5 py-1.5 text-xs text-[var(--tmd-error)]">
          {error}
        </div>
      )}
      {info && (
        <div className="flex items-start gap-4">
          <div className="rounded-lg bg-white p-2">
            <QRCodeSVG value={info.url} size={112} level="M" />
          </div>
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <div className="flex items-center gap-1.5">
              <code className="min-w-0 flex-1 truncate rounded border border-[var(--tmd-border)] bg-[var(--tmd-bg-sunken)] px-2 py-1 text-xs">
                {info.url}
              </code>
              <button
                type="button"
                className="rounded border border-[var(--tmd-border)] p-1 hover:bg-[var(--tmd-bg-hover)]"
                onClick={copy}
                title={copied ? t("已复制") : t("复制地址")}
              >
                <Copy size="0.875rem" aria-hidden />
              </button>
            </div>
            <div className="text-xs text-[var(--tmd-fg-muted)]">
              {t("端口")} {info.port} · LAN {info.lanIp}
            </div>
          </div>
        </div>
      )}
      {isWeb && (
        <div className="flex items-center gap-1.5 text-xs text-[var(--tmd-fg-muted)]">
          <ArrowsClockwise size="0.75rem" aria-hidden />
          {t("当前正通过 Web 访问查看(权限与本机相同)")}
        </div>
      )}
    </div>
  );
}
