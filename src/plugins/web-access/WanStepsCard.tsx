/**
 * 外网 tab 共用「使用流程」卡(Cloudflare / 自建服务器两 pane 同构,消重复 JSX)。
 */

import { t } from "@kernel/i18n";

export interface WanStep {
  title: string;
  detail: string;
}

export function WanStepsCard({ steps }: { steps: WanStep[] }) {
  return (
    <div className="rounded border border-[var(--tmd-border)] bg-[var(--tmd-surface-1)] px-3 py-2">
      <div className="mb-1.5 text-xs font-medium text-[var(--tmd-fg)]">
        {t("使用流程")}
      </div>
      <ol className="flex flex-col gap-1.5">
        {steps.map((s) => (
          <li key={s.title} className="text-xs leading-relaxed">
            <span className="font-medium text-[var(--tmd-fg)]">{t(s.title)}</span>
            <span className="ml-1.5 text-[var(--tmd-fg-muted)]">{t(s.detail)}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}
