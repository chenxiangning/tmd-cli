/**
 * WebDevicePairCard —— 「设备」tab:已配对手机/平板的配对与管理。
 * 原型 docs/prototypes/mobile-app-pairing.html ① 同构:出码(QR + 配对码 +
 * TTL 倒计时)→ 待授权行(授权/忽略)→ 已授权行(上次活跃/踢除)。
 * 桌面专属:isWeb 态整卡隐藏(配对命令是桌面职责,不进 web dispatch)。
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { DeviceMobile, Copy, Check, Trash, Warning } from "@phosphor-icons/react";
import {
  webPairOffer,
  webDevicesList,
  webDeviceApprove,
  webDeviceRevoke,
  onWebDevices,
  onWebPairConsumed,
  onWebPairAlert,
  type PairOffer,
  type DeviceWire,
} from "@kernel/ipc";
import { isWeb } from "@kernel/transport";
import { t } from "@kernel/i18n";

const TTL_WARN_SECS = 60;

function fmtTtl(secs: number): string {
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function fmtLastSeen(ts: number, now: number): string {
  const d = now - ts;
  if (d < 60) return t("刚刚");
  if (d < 3600) return t("{n} 分钟前", { n: Math.floor(d / 60) });
  if (d < 86400) return t("{n} 小时前", { n: Math.floor(d / 3600) });
  return t("{n} 天前", { n: Math.floor(d / 86400) });
}

export function WebDevicePairCard() {
  const [offer, setOffer] = useState<PairOffer | null>(null);
  const [ttl, setTtl] = useState(0);
  const [devices, setDevices] = useState<DeviceWire[]>([]);
  const [now, setNow] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [alert, setAlert] = useState<string | null>(null);
  const [ignored, setIgnored] = useState<Set<string>>(new Set());
  const alertTimer = useRef<number | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await webDevicesList();
      setDevices(res.devices);
      setNow(res.now);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void refresh();
    const un1 = onWebDevices(() => void refresh());
    const un3 = onWebPairConsumed(() => setOffer(null)); // 手机已消费配对码:收起码区,pending 行接管
    const un2 = onWebPairAlert((ip) => {
      setAlert(t("IP {ip} 连续配对码错误,已暂时拒绝(10 分钟)。", { ip }));
      if (alertTimer.current) window.clearTimeout(alertTimer.current);
      alertTimer.current = window.setTimeout(() => setAlert(null), 6000);
    });
    return () => {
      un1.then((f) => f());
      un2.then((f) => f());
      un3.then((f) => f());
      if (alertTimer.current) window.clearTimeout(alertTimer.current);
    };
  }, [refresh]);

  /* TTL 倒计时:每秒对表,过期自动收码。 */
  useEffect(() => {
    if (!offer) return;
    const tick = () => {
      const left = Math.max(0, Math.floor(offer.expiresAt - Date.now() / 1000));
      setTtl(left);
      if (left === 0) setOffer(null);
    };
    tick();
    const iv = window.setInterval(tick, 1000);
    return () => window.clearInterval(iv);
  }, [offer]);

  const mint = async () => {
    setError(null);
    try {
      setOffer(await webPairOffer());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const copyLink = async () => {
    if (!offer) return;
    await navigator.clipboard.writeText(offer.url);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const approve = async (deviceId: string) => {
    await webDeviceApprove(deviceId);
  };

  const revoke = async (deviceId: string) => {
    await webDeviceRevoke(deviceId);
  };

  if (isWeb) return null;

  const pending = devices.filter((d) => !d.approved && !ignored.has(d.deviceId));
  const approved = devices.filter((d) => d.approved);

  return (
    <div className="flex flex-col gap-3 p-4">
      {/* 添加设备:出码 */}
      <div className="flex items-center gap-2">
        <DeviceMobile size="0.875rem" aria-hidden />
        <span className="text-xs font-semibold">{t("添加设备")}</span>
      </div>
      <p className="text-xs text-[var(--tmd-fg-muted)]">
        {t("手机装好 tmd-cli app 后,扫码或输入配对码完成配对;授权一次长期有效。")}
      </p>

      {!offer ? (
        <button
          type="button"
          onClick={() => void mint()}
          className="self-start rounded-md border border-[var(--tmd-border)] px-3 py-1.5 text-xs font-medium hover:bg-[var(--tmd-hover)]"
        >
          {t("出示配对码")}
        </button>
      ) : (
        <div className="flex items-start gap-3 rounded-lg border border-[var(--tmd-border)] bg-[var(--tmd-panel)] p-3">
          <QRCodeSVG value={offer.url} size={116} />
          <div className="flex min-w-0 flex-col gap-1.5">
            <code className="w-fit rounded-md border border-[var(--tmd-border)] bg-[var(--tmd-base)] px-2 py-0.5 font-mono text-sm font-semibold tracking-[0.3em]">
              {offer.pairCode}
            </code>
            <span
              className={`inline-flex items-center gap-1 text-[0.6875rem] ${ttl <= TTL_WARN_SECS ? "text-[var(--tmd-warn,#a16207)]" : "text-[var(--tmd-fg-muted)]"}`}
            >
              {t("有效期 {ttl}", { ttl: fmtTtl(ttl) })}
            </span>
            <button
              type="button"
              onClick={() => void copyLink()}
              className="inline-flex w-fit items-center gap-1 text-[0.6875rem] text-[var(--tmd-accent,#005fb8)] hover:underline"
            >
              {copied ? <Check size="0.75rem" aria-hidden /> : <Copy size="0.75rem" aria-hidden />}
              {copied ? t("已复制") : t("复制配对链接")}
            </button>
          </div>
        </div>
      )}

      {error && <p className="text-xs text-[var(--tmd-err,#dc2626)]">{error}</p>}
      {alert && (
        <p className="flex items-center gap-1 text-xs text-[var(--tmd-warn,#a16207)]">
          <Warning size="0.75rem" aria-hidden />
          {alert}
        </p>
      )}

      {/* 待授权 */}
      {pending.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <span className="text-[0.6875rem] font-semibold text-[var(--tmd-fg-muted)]">
            {t("待授权")}
          </span>
          {pending.map((d) => (
            <div
              key={d.deviceId}
              className="flex items-center gap-2 rounded-lg border border-dashed border-[var(--tmd-border-strong,#b1b1b1)] bg-[#fffdf6] px-2.5 py-2"
            >
              <span className="min-w-0 flex-1 truncate text-xs font-medium">{d.name}</span>
              <button
                type="button"
                onClick={() => void approve(d.deviceId)}
                className="rounded-md bg-[var(--tmd-accent,#005fb8)] px-2 py-0.5 text-[0.6875rem] font-semibold text-white"
              >
                {t("授权")}
              </button>
              <button
                type="button"
                onClick={() => setIgnored((s) => new Set(s).add(d.deviceId))}
                className="rounded-md border border-[var(--tmd-border)] px-2 py-0.5 text-[0.6875rem]"
              >
                {t("忽略")}
              </button>
            </div>
          ))}
        </div>
      )}

      {/* 已授权 */}
      {approved.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <span className="text-[0.6875rem] font-semibold text-[var(--tmd-fg-muted)]">
            {t("已授权设备")}
          </span>
          {approved.map((d) => (
            <div
              key={d.deviceId}
              className="flex items-center gap-2 rounded-lg border border-[var(--tmd-border)] px-2.5 py-2"
            >
              <span className="min-w-0 flex-1 truncate text-xs font-medium">{d.name}</span>
              <span className="text-[0.6875rem] text-[var(--tmd-fg-muted)]">
                {t("上次活跃 {time}", { time: fmtLastSeen(d.lastSeenAt, now) })}
              </span>
              <button
                type="button"
                onClick={() => void revoke(d.deviceId)}
                className="inline-flex items-center gap-1 rounded-md border border-[rgba(220,38,38,0.4)] px-2 py-0.5 text-[0.6875rem] text-[var(--tmd-err,#dc2626)]"
                title={t("撤销后手机立即掉线,需重新配对")}
              >
                <Trash size="0.75rem" aria-hidden />
                {t("踢除")}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
