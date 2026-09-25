/**
 * 一键部署失败时的手动兜底折叠区(WebSelfHostCard 拆件,守 300 行铁则):
 * 导出部署包(relay_selfhost_pack)+ 三条命令,与 pack 内 README 逐字一致。
 */

import { useState } from "react";
import { DownloadSimple } from "@phosphor-icons/react";
import { pickSavePath, relaySelfhostPack } from "@kernel/ipc";
import { t } from "@kernel/i18n";
import { isWeb } from "@kernel/transport";

/** 手动兜底的三条命令(与 pack 内 README 逐字一致;parent 定稿)。 */
const MANUAL_CMDS: string[] = [
  "scp -r tmd-relay-selfhost/* root@<IP>:/opt/tmd-relay/",
  "mv /opt/tmd-relay/tmd-relay.service /etc/systemd/system/ && systemctl daemon-reload && systemctl enable --now tmd-relay",
  "curl -sk https://<IP>/healthz",
];

export function ManualDeployDetails({
  host,
  busy,
  onDone,
  onError,
}: {
  host: string;
  busy: boolean;
  onDone: (msg: string) => void;
  onError: (msg: string) => void;
}) {
  const [exporting, setExporting] = useState(false);

  const exportPack = async () => {
    setExporting(true);
    try {
      const path = await pickSavePath(t("保存自建中继部署包"), "tmd-relay-selfhost.zip");
      if (path) {
        const saved = await relaySelfhostPack(path, host.trim());
        onDone(t("已导出部署包:") + saved);
      }
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setExporting(false);
    }
  };

  return (
    <details className="rounded border border-[var(--tmd-border)] bg-[var(--tmd-surface-1)] px-2.5 py-1.5 text-xs">
      <summary className="cursor-pointer select-none font-medium text-[var(--tmd-fg)]">
        {t("手动部署指导(一键失败时的兜底)")}
      </summary>
      <div className="mt-1.5 flex flex-col gap-1.5 text-[var(--tmd-fg-muted)]">
        <div>
          {t("前置要求:")}
          {t("服务器有公网可达 IP;装好 Node.js ≥ 18;用 root(或免密 sudo)部署;云安全组放行 80 与 443 端口。")}
        </div>
        <button
          type="button"
          className="flex w-fit items-center gap-1 rounded border border-[var(--tmd-border)] px-2 py-1 text-xs hover:bg-[var(--tmd-bg-hover)] disabled:opacity-50"
          onClick={() => void exportPack()}
          disabled={busy || exporting || isWeb || host.trim() === ""}
        >
          <DownloadSimple size="0.75rem" aria-hidden />
          {t("导出部署包")}
        </button>
        <div>{t("解包后按序执行(把包目录整个传到服务器,再起服务、验活):")}</div>
        <pre className="overflow-x-auto whitespace-pre-wrap break-all rounded bg-[var(--tmd-bg-sunken)] p-2 font-mono text-[var(--tmd-fg)]">
          {MANUAL_CMDS.map((c, i) => `${i + 1}) ${c}`).join("\n")}
        </pre>
        <div>
          {t("第 3 条在桌面执行:回 no agent = 服务活着、正等桌面拨号;连接中继后回 agent connected。")}
        </div>
      </div>
    </details>
  );
}
