/**
 * AI 配置首页(E-01)——「AI配置管理」面板的统一落地导航。
 *
 * 只导航、不复制管理表单:渲染数据全部来自 ./aiConfigNav 纯逻辑(组件文件
 * 不导出非组件铁则);各能力按插件启停状态禁用并解释(停用 = 设置
 * disabledPlugins,重启生效口径)。
 */

import { useMemo } from "react";
import { Brain, CaretRight, ClipboardText, GearSix, Notebook, PlugsConnected, Pulse, PuzzlePiece, Robot } from "@phosphor-icons/react";
import { useSettingsState } from "@kernel/settings";
import { t } from "@kernel/i18n";
import { buildAiConfigNav, type AiConfigEntry } from "./aiConfigNav";

const CARD_CLS =
  "flex w-full items-start gap-2 rounded-lg border border-(--tmd-border) bg-(--tmd-bg-elevated) px-2.5 py-2 text-left transition-colors hover:border-(--tmd-accent) disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:border-(--tmd-border)";
const DESC_CLS = "mt-0.5 text-meta leading-relaxed text-(--tmd-fg-faint)";
const DISABLED_REASON_CLS = "mt-0.5 text-meta text-(--tmd-warn)";

const ENTRY_ICONS: Record<AiConfigEntry["id"], React.ReactNode> = {
  engines: <GearSix size="0.875rem" aria-hidden />,
  skills: <PuzzlePiece size="0.875rem" aria-hidden />,
  mcp: <PlugsConnected size="0.875rem" aria-hidden />,
  "magic-context": <Brain size="0.875rem" aria-hidden />,
  assets: <Robot size="0.875rem" aria-hidden />,
};

function NavCard({ entry, offReason }: { entry: AiConfigEntry; offReason: string }) {
  return (
    <div>
      <button type="button" className={CARD_CLS} onClick={entry.onClick} disabled={entry.disabled}>
        <span className="mt-px flex-none text-(--tmd-fg-muted)">{ENTRY_ICONS[entry.id]}</span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1 text-xs font-medium text-(--tmd-fg)">
            <span className="truncate">{entry.title}</span>
            <CaretRight size="0.7rem" aria-hidden className="ml-auto shrink-0 text-(--tmd-fg-faint)" />
          </span>
          <span className={`${DESC_CLS} block`}>{entry.desc}</span>
        </span>
      </button>
      {entry.disabled && <div className={`${DISABLED_REASON_CLS} px-0.5`}>{offReason}</div>}
    </div>
  );
}

/** 统一入口本体;onShowFiles/onShowLint 回本面板文件/体检视图(记忆与规则)。 */
export function AiConfigHome({ onShowFiles, onShowLint }: { onShowFiles: () => void; onShowLint: () => void }) {
  const { settings } = useSettingsState();
  const nav = useMemo(
    () => buildAiConfigNav(settings.disabledPlugins, { onShowFiles, onShowLint }),
    [settings.disabledPlugins, onShowFiles, onShowLint],
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-1.5 pb-2 pt-1.5" data-icon-decor="memory">
      <div className="px-0.5 pb-0.5 text-meta leading-relaxed text-(--tmd-fg-faint)">
        {t("AI 能力的统一入口:以下卡片直达各自的真实管理面,不在此处复制配置表单。")}
      </div>

      {nav.entries.map((entry) => (
        <NavCard key={entry.id} entry={entry} offReason={nav.offReason} />
      ))}

      {/* 记忆与规则 = 本面板的原生视图,双按钮直达(文件/体检)。 */}
      <div className="flex gap-1.5">
        <button type="button" className={`${CARD_CLS} flex-1 justify-center py-1.5 text-meta`} onClick={nav.onShowFiles}>
          <Notebook size="0.875rem" aria-hidden className="mr-1 text-(--tmd-fg-muted)" />
          {t("记忆文件")}
        </button>
        <button type="button" className={`${CARD_CLS} flex-1 justify-center py-1.5 text-meta`} onClick={nav.onShowLint}>
          <Pulse size="0.875rem" aria-hidden className="mr-1 text-(--tmd-fg-muted)" />
          {t("规则体检")}
        </button>
      </div>

      {/* E-04:预设随工作区走,只给说明导航,不在全局复制 CRUD。 */}
      <div className="rounded-lg border border-(--tmd-border) bg-(--tmd-bg-elevated) px-2.5 py-2">
        <div className="flex items-center gap-1 text-xs font-medium text-(--tmd-fg)">
          <ClipboardText size="0.875rem" aria-hidden className="text-(--tmd-fg-muted)" />
          {nav.presetNote.title}
        </div>
        <div className={DESC_CLS}>{nav.presetNote.desc}</div>
      </div>
    </div>
  );
}
