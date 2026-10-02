/**
 * 本地导入视图(v2 闭环)── 十家 CLI 目录发现层作导入源:按引擎分组列出,
 * 每条「导入」进弹窗选落位(引擎多选 / 公约位 + claude symlink)→ fsCopyTree
 * 复制落位 + 写安装记录 → 已安装视图可见、composer 可级联。
 * 已是安装记录同名的源标「已导入」灰置(重新导入走删除后再导)。
 */

import { useEffect, useMemo, useState } from "react";
import { DownloadSimple, Eye, FolderOpen } from "@phosphor-icons/react";
import { t } from "@kernel/i18n";
import { Empty } from "@kernel/Empty";
import { Spinner } from "@kernel/Spinner";
import { useSkillRegistry } from "@plugins/cli-shared/skillRegistry";
import { ENGINE_LABELS, type HubSkill } from "@plugins/cli-shared/skillSources";
import { ensureSkillScanLoaded, refreshSkillScan, useSkillScan } from "./skillStore";
import { ImportDialog } from "./ImportDialog";
import { SkillPreviewDrawer } from "./SkillPreviewDrawer";

export function ImportView() {
  const { groups, loading, error } = useSkillScan();
  const { records } = useSkillRegistry();
  const [importing, setImporting] = useState<HubSkill | null>(null);
  const [query, setQuery] = useState("");
  const [preview, setPreview] = useState<HubSkill | null>(null);
  const importedNames = useMemo(() => new Set(records.map((r) => r.name)), [records]);
  useEffect(() => {
    void ensureSkillScanLoaded();
  }, []);

  /* 过滤:技能名/描述命中保留;引擎标签(如 claude)命中保留整组;空组隐藏。 */
  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return groups;
    return groups
      .map((g) => ({
        ...g,
        skills: t(ENGINE_LABELS[g.engine] ?? g.engine).toLowerCase().includes(needle)
          ? g.skills
          : g.skills.filter(
              (s) =>
                s.name.toLowerCase().includes(needle) ||
                s.description.toLowerCase().includes(needle),
            ),
      }))
      .filter((g) => g.skills.length > 0);
  }, [groups, query]);

  if (loading && groups.length === 0) {
    return (
      <div className="py-4 text-center text-xs text-(--tmd-fg-faint)">
        <Spinner /> {t("加载中…")}
      </div>
    );
  }
  if (error) {
    /* 可重试取数失败 = 持久条 + 重试钮(R6 错误契约;扫描即取数) */
    return (
      <div className="flex flex-col items-center gap-2 py-8 text-center" role="alert" data-import-error>
        <div className="text-xs text-(--tmd-err)">{t("扫描失败")}:{error}</div>
        <button
          type="button"
          onClick={() => void refreshSkillScan()}
          className="rounded border border-(--tmd-border) px-2.5 py-1 text-xs hover:bg-(--tmd-bg-hover)"
        >
          {t("重试")}
        </button>
      </div>
    );
  }
  if (groups.length === 0) {
    return (
      <Empty icon={<FolderOpen aria-hidden />}>{t("本机未发现任何 CLI 技能目录")}</Empty>
    );
  }
  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-2 border-b border-(--tmd-border) px-3 py-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("搜索本机技能…")}
          className="w-56 rounded border border-(--tmd-border) bg-(--tmd-bg-input) px-2 py-1 text-xs outline-none focus:border-(--tmd-accent)"
          data-import-search
        />
      </div>
      <div className="min-h-0 flex-1 overflow-auto px-3 py-2" data-skill-import>
        {visible.length === 0 ? (
          <div className="py-4 text-center text-xs text-(--tmd-fg-faint)">{t("无匹配技能")}</div>
        ) : (
          visible.map((g) => (
            <section key={g.engine} className="mb-5" data-skill-group={g.engine}>
              <div className="mb-2 flex items-center gap-2 border-b border-(--tmd-border) pb-1.5 text-xs text-(--tmd-fg-muted)">
                <span className="font-medium">{t(ENGINE_LABELS[g.engine] ?? g.engine)}</span>
                <span className="rounded-full bg-(--tmd-accent-soft) px-1.5 py-px text-meta tabular-nums text-(--tmd-fg)">
                  {g.skills.length}
                </span>
              </div>
              <div className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-2">
                {g.skills.map((s) => (
                  <ImportSourceCard key={s.dir} skill={s} imported={importedNames.has(s.name)} onImport={() => setImporting(s)} onPreview={() => setPreview(s)} />
                ))}
              </div>
            </section>
          ))
        )}
        {importing && (
          <ImportDialog
            skill={importing}
            onClose={() => setImporting(null)}
            onImported={() => void refreshSkillScan()}
          />
        )}
      </div>
      {preview && <SkillPreviewDrawer skill={preview} onClose={() => setPreview(null)} />}
    </div>
  );
}

function ImportSourceCard({ skill, imported, onImport, onPreview }: { skill: HubSkill; imported: boolean; onImport: () => void; onPreview: () => void }) {
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

