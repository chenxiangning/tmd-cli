/**
 * WebAccessSection —— 「Web 访问」设置卡:启动/停止桥、token URL、桥状态展示。
 * LAN 一层 token(M1);外网卡与设备配对随 M2 增补;配对扫码统一收口「设备」tab,
 * 本卡只承载浏览器访问地址。web 端(isWeb)隐藏面控按钮(桥的启停是桌面职责);
 * 浏览器会话的权限与本机等权(token 即凭据),风险提示随 M2 外网卡弹窗一并给出。
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { errTextDisplay } from "@kernel/errText";
import { Globe, Copy, ArrowsClockwise } from "@phosphor-icons/react";
import { webAccessStatus, type WebAccessInfo } from "@kernel/ipc";
import { isWeb, listen } from "@kernel/transport";
import { updateSettings, useSettingsState } from "@kernel/settings";
import { t } from "@kernel/i18n";
import { copyText } from "@kernel/clipboard";

export function WebAccessSection() {
  const [info, setInfo] = useState<WebAccessInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const copyTimerRef = useRef<number | null>(null);
  const copySeqRef = useRef(0);
  const refreshSeqRef = useRef(0);
  const aliveRef = useRef(true);
  const { settings } = useSettingsState();
  const enabled = settings.webAccessEnabled === true;

  const clearCopyTimer = () => {
    if (copyTimerRef.current !== null) window.clearTimeout(copyTimerRef.current);
    copyTimerRef.current = null;
  };
  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
      clearCopyTimer();
    };
  }, []);

  const refresh = useCallback(async () => {
    const seq = ++refreshSeqRef.current;
    try {
      const next = await webAccessStatus();
      if (!aliveRef.current || seq !== refreshSeqRef.current) return;
      /* 地址可能已换:作废旧复制结果与反馈,不能把新地址误报成已复制。 */
      copySeqRef.current += 1;
      clearCopyTimer();
      setCopied(false);
      setInfo(next);
      setError(null);
    } catch (e) {
      if (!aliveRef.current || seq !== refreshSeqRef.current) return;
      /* 状态不明时撤下旧 token 地址,避免用户复制失效凭据。 */
      copySeqRef.current += 1;
      clearCopyTimer();
      setInfo(null);
      setCopied(false);
      setError(errTextDisplay(e));
    }
  }, []);

  useEffect(() => {
    void refresh();
    /* 桥状态事件驱动刷新(Rust 广播 web://access 纯信号,payload 恒不带凭据;
     * 实况经 webAccessStatus 重查 —— WebRelayCard 订阅 onWebRelay 同款先例)。
     * 卸载先于 listen promise 到站时立即退订,防桥内监听永久滞留;
     * 纯 Node 测试环境无 Tauri runtime 时 listen reject,吞掉防未处理拒绝。 */
    let off: (() => void) | null = null;
    let gone = false;
    listen<unknown>("web://access", () => void refresh())
      .then((fn) => {
        if (gone) fn();
        else off = fn;
      })
      .catch(() => undefined);
    return () => {
      gone = true;
      off?.();
    };
  }, [refresh]);

  /* 开关即写设置;后端 config_merge_settings 钩子起停桥后广播 web://access,
   * 由上方订阅事件回刷状态(不再 600ms 盲猜轮询)。 */
  const setEnabled = (on: boolean) => {
    setBusy(true);
    try {
      updateSettings({ webAccessEnabled: on });
      setError(null);
    } finally {
      setBusy(false);
    }
  };
  const copy = async () => {
    if (!info) return;
    const seq = ++copySeqRef.current;
    clearCopyTimer();
    setCopied(false);
    try {
      await copyText(info.url);
      if (!aliveRef.current || seq !== copySeqRef.current) return;
      setError(null);
      setCopied(true);
      const timer = window.setTimeout(() => {
        if (copyTimerRef.current !== timer) return;
        copyTimerRef.current = null;
        if (aliveRef.current) setCopied(false);
      }, 1500);
      copyTimerRef.current = timer;
    } catch (e) {
      if (aliveRef.current && seq === copySeqRef.current) setError(errTextDisplay(e));
    }
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
        <div role="alert" className="rounded border border-[var(--tmd-error)]/40 bg-[var(--tmd-error)]/10 px-2.5 py-1.5 text-xs text-[var(--tmd-error)]">
          {error}
        </div>
      )}
      {info && (
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-1.5">
            <code className="min-w-0 flex-1 truncate rounded border border-[var(--tmd-border)] bg-[var(--tmd-bg-sunken)] px-2 py-1 text-xs">
              {info.url}
            </code>
            <button
              type="button"
              className="rounded border border-[var(--tmd-border)] p-1 hover:bg-[var(--tmd-bg-hover)]"
              onClick={copy}
              aria-label={t("复制地址")}
              title={copied ? t("已复制") : t("复制地址")}
            >
              <Copy size="0.875rem" aria-hidden />
            </button>
          </div>
          {copied && (
            <div role="status" className="text-xs text-[var(--tmd-fg-muted)]">{t("已复制")}</div>
          )}
          <div className="text-xs text-[var(--tmd-fg-muted)]">
            {t("端口")} {info.port} · LAN {info.lanIp}
          </div>
          <div className="text-xs text-[var(--tmd-fg-muted)]">
            {t("手机 app 接入:到「设备」页扫码配对,授权后长期有效。")}
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
