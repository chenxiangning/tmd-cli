/**
 * 商店卡片 —— 名称/来源徽标/描述/工具数 + 安装按钮(打开 InstallDraftModal)。
 * 纯展示;草稿有无的判定交给弹窗(installDraft/manualDraft 任一可装,
 * 双无 = 按钮置灰提示手动)。
 */
import { DownloadSimple } from "@phosphor-icons/react";
import { t } from "@kernel/i18n";
import type { RegistryCard } from "./registryNormalize";

const SOURCE_LABEL: Record<RegistryCard["source"], string> = {
  official: "official",
  smithery: "smithery",
  glama: "glama",
};

export function StoreCard({ card, onInstall }: { card: RegistryCard; onInstall: () => void }) {
  const installable = Boolean(card.installDraft || card.manualDraft);
  return (
    <div className="mcphub-card">
      <div className="flex items-center gap-2">
        <span className="mcphub-badge">{SOURCE_LABEL[card.source]}</span>
        <span className="min-w-0 truncate font-medium text-(--tmd-fg)">{card.name}</span>
        {card.toolsCount !== undefined && (
          <span className="flex-none text-meta text-(--tmd-fg-faint) tabular-nums">
            {t("{n} 个工具", { n: card.toolsCount })}
          </span>
        )}
        <button
          type="button"
          className="mcphub-accent-btn ml-auto flex-none"
          disabled={!installable}
          title={installable ? t("打开安装草稿(填空后写入目标引擎)") : t("此卡片需手动配置(无可生成草稿)")}
          onClick={onInstall}
        >
          <DownloadSimple size="0.75rem" aria-hidden />
          {t("安装")}
        </button>
      </div>
      {card.description && (
        <div className="mt-1 line-clamp-2 text-meta text-(--tmd-fg-faint)">
          {card.description}
        </div>
      )}
      {card.url && (
        <a
          href={card.url}
          target="_blank"
          rel="noreferrer"
          className="mt-0.5 inline-block max-w-full truncate text-meta text-(--tmd-accent) hover:underline"
        >
          {card.url}
        </a>
      )}
    </div>
  );
}
