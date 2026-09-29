/**
 * 商店卡 ── ClawHub 卡片:名称/摘要/topics/统计/已装徽标 + 安装入口。
 */

import { DownloadSimple, Star } from "@phosphor-icons/react";
import { t } from "@kernel/i18n";
import type { ClawHubCard } from "./clawhubNormalize";

function formatCount(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k`;
  return String(n);
}

export function StoreCard({
  card,
  installed,
  onInstall,
}: {
  card: ClawHubCard;
  installed: boolean;
  onInstall: (card: ClawHubCard) => void;
}) {
  return (
    <div
      className="flex flex-col gap-1 rounded-md border border-(--tmd-border) bg-(--tmd-bg-base) p-2.5"
      data-store-card={card.slug}
    >
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-xs font-medium" title={card.displayName}>
              {card.displayName}
            </span>
            {card.latestVersion && (
              <span className="shrink-0 text-[10px] text-(--tmd-fg-faint)">v{card.latestVersion}</span>
            )}
          </div>
          {card.ownerHandle && (
            <div className="truncate text-[10px] text-(--tmd-fg-faint)">@{card.ownerHandle}</div>
          )}
        </div>
      </div>
      <div className="line-clamp-2 text-[11px] leading-snug text-(--tmd-fg-muted)">
        {card.summary || t("无描述")}
      </div>
      <div className="mt-1 flex flex-wrap gap-1">
        {card.topics.map((topic) => (
          <span
            key={topic}
            className="rounded border border-(--tmd-border) bg-(--tmd-bg-sunken) px-1.5 py-px text-[10px] text-(--tmd-fg-muted)"
          >
            {topic}
          </span>
        ))}
      </div>
      <div className="mt-auto flex items-center justify-between pt-1">
        <div className="flex items-center gap-2 text-[10px] text-(--tmd-fg-faint)">
          <span className="flex items-center gap-0.5">
            <DownloadSimple size={11} aria-hidden="true" />
            {formatCount(card.downloads)}
          </span>
          <span className="flex items-center gap-0.5">
            <Star size={11} aria-hidden="true" />
            {formatCount(card.stars)}
          </span>
        </div>
        {installed ? (
          <span
            className="cursor-default rounded border border-(--tmd-border) px-2 py-0.5 text-[11px] text-(--tmd-fg-faint)"
            data-store-installed={card.slug}
          >
            {t("已安装")}
          </span>
        ) : (
          <button
            type="button"
            onClick={() => onInstall(card)}
            className="rounded border border-(--tmd-border) px-2 py-0.5 text-[11px] hover:bg-(--tmd-bg-hover)"
            data-store-install={card.slug}
          >
            {t("安装")}
          </button>
        )}
      </div>
    </div>
  );
}
