/**
 * 自建中继部署历史列表(WebSelfHostCard 消费,拆文件守 300 行铁则)——
 * 一键部署成功后 Rust 落 settings.relayDeployHistory(不含密码/私钥);
 * 点行回填 SSH 表单,× 删单条。空列表不渲染。
 */

import { X } from "@phosphor-icons/react";
import { updateSettings, useSettingsState, type RelayDeployHistoryEntry } from "@kernel/settings";
import { t } from "@kernel/i18n";
import { isWeb } from "@kernel/transport";

export function RelayDeployHistoryList({ onPick }: { onPick: (e: RelayDeployHistoryEntry) => void }) {
  const { settings } = useSettingsState();
  const history = settings.relayDeployHistory;
  if (history.length === 0) return null;

  const remove = (target: RelayDeployHistoryEntry) =>
    updateSettings({
      relayDeployHistory: settings.relayDeployHistory.filter(
        (e) => !(e.host === target.host && e.port === target.port && e.username === target.username),
      ),
    });

  return (
    <div className="flex flex-col gap-1">
      <div className="text-xs text-[var(--tmd-fg-muted)]">{t("部署历史(点一下回填,密码/私钥需重输)")}</div>
      {history.map((e) => (
        <div
          key={`${e.host}:${e.port}:${e.username}`}
          className="flex items-center gap-1.5 rounded border border-[var(--tmd-border)] px-2 py-1 text-xs"
        >
          <button
            type="button"
            className="min-w-0 flex-1 truncate text-left hover:text-[var(--tmd-accent)] disabled:opacity-50"
            disabled={isWeb}
            onClick={() => onPick(e)}
            title={`${e.username}@${e.host}:${e.port}`}
          >
            <span className="font-mono">
              {e.username}@{e.host}
              {e.port !== 22 ? `:${e.port}` : ""}
            </span>
            <span className="ml-1.5 text-[var(--tmd-fg-muted)]">
              {e.authType === "privateKey" ? t("私钥") : t("密码")}
            </span>
          </button>
          <button
            type="button"
            className="shrink-0 text-[var(--tmd-fg-faint)] hover:text-[var(--tmd-error)] disabled:opacity-50"
            disabled={isWeb}
            aria-label={t("删除")}
            title={t("删除")}
            onClick={() => remove(e)}
          >
            <X size="0.75rem" aria-hidden />
          </button>
        </div>
      ))}
    </div>
  );
}
