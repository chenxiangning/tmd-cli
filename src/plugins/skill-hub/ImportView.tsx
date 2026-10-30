/**
 * 本地导入视图(v2 闭环)── 十家 CLI 目录发现层作导入源:按引擎分组列出,
 * 每条「导入」进弹窗选落位(引擎多选 / 公约位 + claude symlink)→ fsCopyTree
 * 复制落位 + 写安装记录 → 已安装视图可见、composer 可级联。
 * 已是安装记录同名的源标「已导入」灰置(重新导入走删除后再导)。
 * 2026-10-18 增磁盘导入:GitHub 下载的技能源码(目录 / zip)经原生选择器
 * 进入(importFromDisk.ts 发现层),以「磁盘导入」分组置顶,落位复用同弹窗。
 */

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { errTextDisplay } from "@kernel/errText";
import { Archive, DownloadSimple, FolderOpen } from "@phosphor-icons/react";
import { t } from "@kernel/i18n";
import { ipc, pickDirectory, pickFile } from "@kernel/ipc";
import { Empty } from "@kernel/Empty";
import { Spinner } from "@kernel/Spinner";
import { useSkillRegistry } from "@plugins/cli-shared/skillRegistry";
import { ENGINE_LABELS, type HubSkill } from "@plugins/cli-shared/skillSources";
import { ensureSkillScanLoaded, refreshSkillScan, useSkillScan } from "./skillStore";
import { discoverDirSkills, extractZipForImport } from "./importFromDisk";
import { GithubImportDialog } from "./GithubImportDialog";
import { ImportSourceCard } from "./ImportSourceCard";
import { ImportDialog } from "./ImportDialog";
import { SkillPreviewDrawer } from "./SkillPreviewDrawer";

export function ImportView() {
  const { groups, loading, error } = useSkillScan();
  const { records } = useSkillRegistry();
  const [importing, setImporting] = useState<HubSkill | null>(null);
  const [query, setQuery] = useState("");
  const [preview, setPreview] = useState<HubSkill | null>(null);
  const [picked, setPicked] = useState<{ label: string; skills: HubSkill[] } | null>(null);
  const [diskBusy, setDiskBusy] = useState(false);
  const [diskError, setDiskError] = useState<string | null>(null);
  const [ghOpen, setGhOpen] = useState(false);
  const tempZipDirRef = useRef<string | null>(null);
  const importedNames = useMemo(() => new Set(records.map((r) => r.name)), [records]);
  useEffect(() => {
    void ensureSkillScanLoaded();
    /* zip 导入的解压临时目录随视图卸载清理(缺失幂等;失败留缓存无害)。 */
    return () => {
      if (tempZipDirRef.current) void ipc.fsRemovePath(tempZipDirRef.current).catch(() => undefined);
    };
  }, []);

  const loadPicked = async (dir: string, label: string): Promise<void> => {
    setDiskBusy(true);
    setDiskError(null);
    try {
      const skills = await discoverDirSkills(dir);
      if (skills.length === 0) {
        setDiskError(t("未在所选位置发现技能(需要含 SKILL.md/skill.json 的目录)"));
        setPicked(null);
      } else {
        setPicked({ label, skills });
      }
    } finally {
      setDiskBusy(false);
    }
  };

  const importFromDiskDir = async (): Promise<void> => {
    const dir = await pickDirectory(t("选择技能目录(含 SKILL.md)"));
    if (dir) await loadPicked(dir, dir.replace(/\/+$/, "").split("/").pop() ?? dir);
  };

  const importFromDiskZip = async (): Promise<void> => {
    const file = await pickFile(t("选择技能 zip 包"));
    if (!file) return;
    if (!file.toLowerCase().endsWith(".zip")) {
      setDiskError(t("只支持 .zip 包"));
      return;
    }
    setDiskBusy(true);
    setDiskError(null);
    try {
      if (tempZipDirRef.current) await ipc.fsRemovePath(tempZipDirRef.current).catch(() => undefined);
      const temp = await extractZipForImport(file);
      tempZipDirRef.current = temp;
      await loadPicked(temp, file.replace(/\/+$/, "").split("/").pop() ?? file);
    } catch (e) {
      setDiskError(`${t("zip 解压失败")}:${errTextDisplay(e)}`);
    } finally {
      setDiskBusy(false);
    }
  };

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

  /* 磁盘导入控件(主工具栏与本机无目录的空态共用;空态用户只能靠它进入)。 */
  const diskButtons = (
    <div className="ml-auto flex items-center gap-1.5">
      <button
        type="button"
        onClick={() => void importFromDiskDir()}
        disabled={diskBusy}
        className="flex items-center gap-1 rounded border border-(--tmd-border) px-2 py-1 text-xs hover:bg-(--tmd-bg-hover) disabled:opacity-40"
        data-disk-import-dir
      >
        <FolderOpen size="0.875rem" aria-hidden />
        {t("从文件夹导入技能…")}
      </button>
      <button
        type="button"
        onClick={() => void importFromDiskZip()}
        disabled={diskBusy}
        className="flex items-center gap-1 rounded border border-(--tmd-border) px-2 py-1 text-xs hover:bg-(--tmd-bg-hover) disabled:opacity-40"
        data-disk-import-zip
      >
        <Archive size="0.875rem" aria-hidden />
        {t("从 zip 导入…")}
      </button>
      <button
        type="button"
        onClick={() => setGhOpen(true)}
        disabled={diskBusy}
        className="flex items-center gap-1 rounded border border-(--tmd-border) px-2 py-1 text-xs hover:bg-(--tmd-bg-hover) disabled:opacity-40"
        data-disk-import-gh
      >
        <DownloadSimple size="0.875rem" aria-hidden />
        {t("从 GitHub 导入…")}
      </button>
    </div>
  );
  const ghDialog = ghOpen ? (
    <GithubImportDialog
      onClose={() => setGhOpen(false)}
      onLoaded={(res) => {
        tempZipDirRef.current = res.root;
        setGhOpen(false);
        void loadPicked(res.dir, res.label);
      }}
    />
  ) : null;
  const diskErrorBar = diskError ? (
    <div
      className="border-b border-(--tmd-border) px-3 py-1.5 text-xs text-(--tmd-err)"
      role="alert"
      data-disk-import-error
    >
      {diskError}
    </div>
  ) : null;
  const pickedSection = picked ? (
    <section className="border-b border-(--tmd-border) px-3 py-2" data-disk-import>
      <div className="mb-2 flex items-center gap-2 text-xs text-(--tmd-fg-muted)">
        <span className="font-medium">{t("磁盘导入:{label}", { label: picked.label })}</span>
        <span className="rounded-full bg-(--tmd-accent-soft) px-1.5 py-px text-meta tabular-nums text-(--tmd-fg)">
          {picked.skills.length}
        </span>
      </div>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-2">
        {picked.skills.map((s) => (
          <ImportSourceCard
            key={s.dir}
            skill={s}
            imported={importedNames.has(s.name)}
            onImport={() => setImporting(s)}
            onPreview={() => setPreview(s)}
          />
        ))}
      </div>
    </section>
  ) : null;

  /* 弹窗/抽屉渲染在分支之外:导入成功 → refreshSkillScan 重扫期间 loading
   * 翻真,若分支切换会整体卸载 ImportDialog(进行态/完成态被重置)。 */
  let body: ReactNode;
  if (loading && groups.length === 0) {
    body = (
      <div className="py-4 text-center text-xs text-(--tmd-fg-faint)">
        <Spinner /> {t("加载中…")}
      </div>
    );
  } else if (error) {
    /* 可重试取数失败 = 持久条 + 重试钮(R6 错误契约;扫描即取数) */
    body = (
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
  } else if (groups.length === 0) {
    body = (
      <>
        <div className="flex items-center border-b border-(--tmd-border) px-3 py-2">{diskButtons}</div>
        {diskErrorBar}
        <div className="min-h-0 flex-1 overflow-auto px-3 py-2">
          {pickedSection}
          {!picked && <Empty icon={<FolderOpen aria-hidden />}>{t("本机未发现任何 CLI 技能目录")}</Empty>}
        </div>
      </>
    );
  } else {
    body = (
      <>
        <div className="flex items-center gap-2 border-b border-(--tmd-border) px-3 py-2">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("搜索本机技能…")}
            className="w-56 rounded border border-(--tmd-border) bg-(--tmd-bg-input) px-2 py-1 text-xs outline-none focus:border-(--tmd-accent)"
            data-import-search
          />
          {diskButtons}
        </div>
        {diskErrorBar}
        <div className="min-h-0 flex-1 overflow-auto px-3 py-2" data-skill-import>
          {pickedSection}
          {visible.length === 0 && !picked ? (
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
        </div>
      </>
    );
  }
  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      {body}
      {ghDialog}
      {preview && <SkillPreviewDrawer skill={preview} onClose={() => setPreview(null)} />}
      {importing && (
        <ImportDialog
          skill={importing}
          onClose={() => setImporting(null)}
          onImported={() => void refreshSkillScan()}
        />
      )}
    </div>
  );
}
