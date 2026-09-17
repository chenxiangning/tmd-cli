/**
 * 外网中继部署卡:一键部署 relay Worker 到用户自有 Cloudflare 账号,
 * 或导出部署包(zip)自行 wrangler deploy。Token 仅在本次调用内使用,
 * 不持久化、不上传;结果(Worker URL + 新铸 key)自动回填设置并持久化。
 */

import { useState } from "react";
import { CloudArrowUpIcon as CloudArrowUp, DownloadSimpleIcon as DownloadSimple } from "@phosphor-icons/react";
import { relayDeploy, relayDeployPack, pickSavePath } from "@kernel/ipc";
import { updateSettings } from "@kernel/settings";
import { t } from "@kernel/i18n";
import { isWeb } from "@kernel/transport";

export function WebRelayDeployCard() {
  const [token, setToken] = useState("");
  const [accountId, setAccountId] = useState("");
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ url: string; key: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const deploy = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await relayDeploy(token, accountId.trim() || undefined);
      setResult(r);
      /* 只回填部署产物;webRelayOn 留给 web_relay_start 成功后由 Rust 侧落盘
      (与连接卡同款纪律):部署 ≠ 同意外网可达,防 autostart 静默拨通。 */
      updateSettings({ webRelayUrl: r.url, webRelayKey: r.key });
      setToken("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const exportPack = async () => {
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      const path = await pickSavePath(t("保存中继部署包"), "tmd-relay.zip");
      if (!path) return;
      const saved = await relayDeployPack(path, key.trim() || undefined);
      setDone(t("已导出部署包:") + saved);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-2 rounded border border-[var(--tmd-border)] p-3">
      <div className="flex items-center gap-2 text-sm font-medium">
        <CloudArrowUp size="1rem" aria-hidden />
        {t("部署中继(自有 Cloudflare 账号)")}
      </div>
      <div className="text-xs text-[var(--tmd-fg-muted)]">
        {t("中继跑在你自己的 Cloudflare 账号(免费额度足够)。API Token 仅本次部署使用,不保存。")}
      </div>
      <details className="rounded border border-[var(--tmd-border)] bg-[var(--tmd-surface-1)] px-2.5 py-1.5 text-xs">
        <summary className="cursor-pointer select-none font-medium text-[var(--tmd-fg)]">
          {t("Cloudflare API Token 怎么申请?")}
        </summary>
        <ol className="mt-1.5 flex flex-col gap-1 pl-4 text-[var(--tmd-fg-muted)]" style={{ listStyle: "decimal" }}>
          <li>
            {t("开 Cloudflare Dashboard → 右上角头像 → My Profile → 左侧 API Tokens → Create Token")}
          </li>
          <li>
            {t("模板选 Edit Cloudflare Workers(或 Custom:Account 权限勾 Workers Scripts:Edit + Account Settings:Read)")}
          </li>
          <li>
            {t("Account Resources 选你的账号 → Continue → Create Token → 复制粘贴到下面")}
          </li>
          <li>
            {t("Account ID 在 Dashboard 右侧栏(Workers 页)或任意域名 Overview 右下角;用 cfat_ 账户令牌时必填")}
          </li>
        </ol>
        <a
          className="mt-1 inline-block text-[var(--tmd-accent)] underline"
          href="https://dash.cloudflare.com/profile/api-tokens"
          target="_blank"
          rel="noreferrer"
        >
          {t("直达:Cloudflare API Tokens 页面")}
        </a>
      </details>
      <input
        type="password"
        className="rounded border border-[var(--tmd-border)] bg-transparent px-2 py-1 text-xs"
        placeholder={t("Cloudflare API Token (My Profile → API Tokens)")}
        value={token}
        onChange={(e) => setToken(e.target.value)}
        autoComplete="off"
      />
      <input
        type="text"
        className="rounded border border-[var(--tmd-border)] bg-transparent px-2 py-1 text-xs"
        placeholder={t("Account ID(可选,cfat_ 账户令牌必填)")}
        value={accountId}
        onChange={(e) => setAccountId(e.target.value)}
        autoComplete="off"
      />
      <input
        type="password"
        className="rounded border border-[var(--tmd-border)] bg-transparent px-2 py-1 text-xs"
        placeholder={t("中继密钥(留空则导出时铸随机 key 烧入包内)")}
        value={key}
        onChange={(e) => setKey(e.target.value)}
        autoComplete="off"
      />
      {error && (
        <div className="rounded border border-[var(--tmd-error)]/40 bg-[var(--tmd-error)]/10 px-2.5 py-1.5 text-xs text-[var(--tmd-error)]">
          {error}
        </div>
      )}
      {result && (
        <div className="rounded border border-[var(--tmd-success)]/40 bg-[var(--tmd-success)]/10 px-2.5 py-1.5 text-xs text-[var(--tmd-success)]">
          {t("部署完成:")} {result.url}
        </div>
      )}
      {done && (
        <div className="rounded border border-[var(--tmd-success)]/40 bg-[var(--tmd-success)]/10 px-2.5 py-1.5 text-xs text-[var(--tmd-success)]">
          {done}
        </div>
      )}
      <div className="flex gap-2">
        <button
          type="button"
          className="flex items-center gap-1 rounded border border-[var(--tmd-border)] px-2 py-1 text-xs hover:bg-[var(--tmd-bg-hover)] disabled:opacity-50"
          onClick={deploy}
          disabled={busy || isWeb || !token.trim()}
        >
          <CloudArrowUp size="0.75rem" aria-hidden />
          {busy ? t("部署中…") : t("立即部署")}
        </button>
        <button
          type="button"
          className="flex items-center gap-1 rounded border border-[var(--tmd-border)] px-2 py-1 text-xs hover:bg-[var(--tmd-bg-hover)] disabled:opacity-50"
          onClick={exportPack}
          disabled={busy || isWeb}
        >
          <DownloadSimple size="0.75rem" aria-hidden />
          {t("导出部署包")}
        </button>
      </div>
    </div>
  );
}
