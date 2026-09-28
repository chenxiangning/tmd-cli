/**
 * 已装技能卡 ── 名称/描述/来源徽标 + 预览/删除操作。
 * 引擎归属由 InstalledView 分组头表达,卡内不重复。
 */

import { Eye, Trash } from "@phosphor-icons/react";
import { t } from "@kernel/i18n";
import type { HubSkill } from "./skillScan";

const BADGE_LABELS: Record<HubSkill["badge"], string> = {
  user: "用户级",
  system: "系统",
  shared: "共享",
};

const BADGE_CLASS: Record<HubSkill["badge"], string> = {
  user: "bg-(--tmd-bg-sunken) text-(--tmd-fg-muted)",
  system: "bg-(--tmd-bg-sunken) text-(--tmd-fg-faint)",
  shared: "bg-(--tmd-accent-soft) text-(--tmd-fg)",
};

export function SkillCard({
  skill,
  onPreview,
  onDelete,
}: {
  skill: HubSkill;
  onPreview: (skill: HubSkill) => void;
  onDelete: (skill: HubSkill) => void;
}) {
  return (
    <div
      className="flex flex-col gap-1 rounded-md border border-(--tmd-border) bg-(--tmd-bg-base) p-2.5"
      data-skill-card={skill.name}
    >
      <div className="flex items-start gap-2">
        <button
          type="button"
          onClick={() => onPreview(skill)}
          className="min-w-0 flex-1 truncate text-left text-xs font-medium hover:underline"
          title={skill.name}
        >
          {skill.name}
        </button>
        <span className={`shrink-0 self-center rounded px-1.5 py-0.5 text-[10px] ${BADGE_CLASS[skill.badge]}`}>
          {t(BADGE_LABELS[skill.badge])}
        </span>
      </div>
      {skill.description ? (
        <div className="line-clamp-2 text-[11px] leading-snug text-(--tmd-fg-muted)">
          {skill.description}
        </div>
      ) : (
        <div className="text-[11px] leading-snug text-(--tmd-fg-faint)">{t("无描述")}</div>
      )}
      <div className="flex items-center justify-end gap-1">
        <button
          type="button"
          onClick={() => onPreview(skill)}
          className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-(--tmd-fg-muted) hover:bg-(--tmd-bg-hover)"
        >
          <Eye size={12} aria-hidden="true" />
          {t("预览")}
        </button>
        <button
          type="button"
          onClick={() => onDelete(skill)}
          className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-(--tmd-fg-muted) hover:bg-(--tmd-bg-hover) hover:text-(--tmd-err)"
          data-skill-delete={skill.name}
        >
          <Trash size={12} aria-hidden="true" />
          {t("删除")}
        </button>
      </div>
    </div>
  );
}
