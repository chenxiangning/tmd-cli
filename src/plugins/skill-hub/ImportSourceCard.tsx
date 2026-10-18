/**
 * 本地导入来源卡(2026-10-18 自 ImportView 拆出,文件规模铁则)── 名称/
 * 描述/来源路径 + 详情与导入动作;已导入灰置(重新导入 = 先删再导)。
 * 数据面是 cli-shared HubSkill(引擎扫描与磁盘导入共用)。
 */
import { DownloadSimple, Eye } from "@phosphor-icons/react";
import { t } from "@kernel/i18n";
import type { HubSkill } from "@plugins/cli-shared/skillSources";

export function ImportSourceCard({ skill, imported, onImport, onPreview }: { skill: HubSkill; imported: boolean; onImport: () => void; onPreview: () => void }) {
  return (
    <div className="flex flex-col gap-1 rounded-md border border-(--tmd-border) bg-(--tmd-bg-base) p-2.5">
      <div className="min-w-0 truncate text-xs font-medium" title={skill.name}>
        {skill.name}
      </div>
      {skill.description ? (
        <div className="line-clamp-2 text-xs leading-snug text-(--tmd-fg-muted)">{skill.description}</div>
      ) : (
        <div className="text-xs leading-snug text-(--tmd-fg-faint)">{t("无描述")}</div>
      )}
      <div className="text-meta text-(--tmd-fg-faint) truncate" title={skill.dir}>{skill.dir}</div>
      <div className="mt-auto flex items-center justify-end gap-1 pt-1">
        <button
          type="button"
          onClick={onPreview}
          className="flex items-center gap-1 rounded px-1.5 py-0.5 text-xs text-(--tmd-fg-muted) hover:bg-(--tmd-bg-hover)"
          data-skill-detail={skill.name}
        >
          <Eye size="0.75rem" aria-hidden="true" />
          {t("详情")}
        </button>
        {imported ? (
          <span className="cursor-default text-xs text-(--tmd-fg-faint)" title={t("已在安装记录中;重新导入请先在「已安装」删除")}>
            {t("已导入")}
          </span>
        ) : (
          <button
            type="button"
            onClick={onImport}
            disabled={skill.flat}
            title={skill.flat ? t("平铺形(单文件)技能暂不支持跨目录导入") : undefined}
            className="flex items-center gap-1 rounded border border-(--tmd-border) px-2 py-0.5 text-xs hover:bg-(--tmd-bg-hover) disabled:opacity-40"
            data-skill-import-btn={skill.name}
          >
            <DownloadSimple size="0.75rem" aria-hidden="true" />
            {t("导入")}
          </button>
        )}
      </div>
    </div>
  );
}
