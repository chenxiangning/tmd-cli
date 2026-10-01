/**
 * 已安装视图(v2.2)── 安装记录制渲染:来源徽标(商店/本地导入)+ 落位目标
 * 摘要 + 模糊搜索 + 删除(记录 + 落位目录入回收站,二次确认)+ 商店版本比对
 * 「可更新」徽标与「更新」钮(重跑下载安装链,探测见 installedUpdates.ts)。
 * 数据源 skillRegistry(0 起步);十家目录发现留在本地导入视图。2026-10-01
 * 用户裁定:已装不合并磁盘扫描,维持记录制(公约位安装以 tmd 记录为准)。
 */

import { useMemo, useState } from "react";
import { ArrowClockwise, Eye, Trash } from "@phosphor-icons/react";
import { ipc } from "@kernel/ipc";
import { t } from "@kernel/i18n";
import {
  removeSkillRecord,
  useSkillRegistry,
  type InstalledSkillRecord,
} from "@plugins/cli-shared/skillRegistry";
import { refreshSkillScan } from "./skillStore";
import { SHARED_SKILLS_REL } from "@plugins/cli-shared/skillSources";
import { SkillPreviewDrawer } from "./SkillPreviewDrawer";
import { InstallDialog } from "./InstallDialog";
import { resolveSkillMetaFile, type HubSkill } from "./skillScan";
import type { ClawHubCard } from "./clawhubNormalize";
import { useSkillUpdates } from "./installedUpdates";

function matches(rec: InstalledSkillRecord, q: string): boolean {
  if (!q) return true;
  const needle = q.toLowerCase();
  return (
    rec.name.toLowerCase().includes(needle) ||
    (rec.description ?? "").toLowerCase().includes(needle)
  );
}

/** 删除 = 记录移除 + 各落位目录移入系统回收站(flat 目标不存在 = 跳过)。 */
async function deleteInstalled(rec: InstalledSkillRecord): Promise<string | null> {
  const home = await ipc.configHomeDir().catch(() => null);
  await removeSkillRecord(rec.name);
  if (!home) return null;
  /* eslint-disable react-doctor/async-await-in-loop -- 逐落位目录入回收站,数量个位数,
     catch 兜底缺失目录;并行 trash 无收益。 */
  for (const rel of rec.targets) {
    await ipc.fsTrashEntry(`${home}/${rel}/${rec.name}`).catch(() => undefined);
  }
  /* eslint-enable react-doctor/async-await-in-loop */
  await refreshSkillScan();
  return null;
}

/** 详情定位:targets 依序找第一个有元数据文件的落位(多落位是同一份拷贝,
 * 无一命中回落首个落位目录,抽屉自会显示「无元数据文件」提示)。 */
async function recordPreviewSkill(rec: InstalledSkillRecord): Promise<HubSkill> {
  const home = await ipc.configHomeDir().catch(() => "");
  const base = {
    name: rec.name,
    description: rec.description ?? "",
    flat: false,
    badge: "user" as const,
    engine: "shared",
  };
  /* eslint-disable react-doctor/async-await-in-loop -- 逐落位探测元数据,个位数次,
     catch 兜底在 resolveSkillMetaFile 内;并行探测无收益。 */
  for (const rel of rec.targets) {
    const skill: HubSkill = { ...base, dir: `${home}/${rel}/${rec.name}`, metaFile: null };
    const meta = await resolveSkillMetaFile(skill);
    if (meta) return { ...skill, metaFile: meta };
  }
  /* eslint-enable react-doctor/async-await-in-loop */
  return { ...base, dir: `${home}/${rec.targets[0] ?? ""}/${rec.name}`, metaFile: null };
}

export function InstalledView({ onGotoImport }: { onGotoImport?: () => void }) {
  const { records, loaded } = useSkillRegistry();
  const updates = useSkillUpdates(records);
  const [query, setQuery] = useState("");
  const [pendingDelete, setPendingDelete] = useState<InstalledSkillRecord | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [preview, setPreview] = useState<HubSkill | null>(null);
  const [updating, setUpdating] = useState<ClawHubCard | null>(null);

  const visible = useMemo(
    () => records.filter((r) => matches(r, query)),
    [records, query],
  );

  const openPreview = (rec: InstalledSkillRecord): void => {
    void recordPreviewSkill(rec).then(setPreview);
  };

  const confirmDelete = async (): Promise<void> => {
    if (!pendingDelete) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await deleteInstalled(pendingDelete);
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : String(err));
      return;
    } finally {
      setDeleting(false);
    }
    setPendingDelete(null);
  };

  return (
    <div className="relative flex h-full min-h-0">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-2 border-b border-(--tmd-border) px-3 py-2">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("搜索已安装技能…")}
            className="w-56 rounded border border-(--tmd-border) bg-(--tmd-bg-input) px-2 py-1 text-xs outline-none focus:border-(--tmd-accent)"
          />
        </div>
        <div className="min-h-0 flex-1 overflow-auto px-3 py-2" data-skill-installed>
          {!loaded ? (
            <div className="py-4 text-center text-xs text-(--tmd-fg-faint)">{t("正在读取安装记录…")}</div>
          ) : records.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-8">
              <div className="text-xs text-(--tmd-fg-faint)">{t("尚未安装;从技能商店安装或本地导入")}</div>
              {onGotoImport && (
                <button
                  type="button"
                  onClick={onGotoImport}
                  className="rounded border border-(--tmd-border) px-2.5 py-1 text-xs hover:bg-(--tmd-bg-hover)"
                >
                  {t("去本地导入")}
                </button>
              )}
            </div>
          ) : visible.length === 0 ? (
            <div className="py-4 text-center text-xs text-(--tmd-fg-faint)">{t("无匹配技能")}</div>
          ) : (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-2">
              {visible.map((rec) => {
                const updateCard = updates.get(rec.name) ?? null;
                return (
                  <div
                    key={rec.name}
                    className="flex flex-col gap-1 rounded-md border border-(--tmd-border) bg-(--tmd-bg-base) p-2.5"
                    data-skill-card={rec.name}
                  >
                    <div className="flex items-start gap-2">
                      <span className="min-w-0 flex-1 truncate text-xs font-medium" title={rec.name}>
                        {rec.name}
                      </span>
                      {updateCard && (
                        <span
                          className="shrink-0 self-center rounded bg-(--tmd-accent-soft) px-1.5 py-0.5 text-[10px] text-(--tmd-fg)"
                          title={`${rec.version ?? ""} → ${updateCard.latestVersion ?? ""}`}
                          data-skill-updatable={rec.name}
                        >
                          {t("可更新")}
                        </span>
                      )}
                      <span
                        className={`shrink-0 self-center rounded px-1.5 py-0.5 text-[10px] ${
                          rec.source === "store"
                            ? "bg-(--tmd-accent-soft) text-(--tmd-fg)"
                            : "bg-(--tmd-bg-sunken) text-(--tmd-fg-muted)"
                        }`}
                      >
                        {rec.source === "store" ? t("商店安装") : t("本地导入")}
                      </span>
                    </div>
                    {rec.description ? (
                      <div className="line-clamp-2 text-[11px] leading-snug text-(--tmd-fg-muted)">
                        {rec.description}
                      </div>
                    ) : (
                      <div className="text-[11px] leading-snug text-(--tmd-fg-faint)">{t("无描述")}</div>
                    )}
                    <div className="text-[10px] text-(--tmd-fg-faint)" title={rec.targets.join("\n")}>
                      {t("落位")}:{rec.targets.map((r) => (r === SHARED_SKILLS_REL ? t("公约位") : r)).join(" · ")}
                    </div>
                    <div className="flex items-center justify-end gap-1">
                      {updateCard && (
                        <button
                          type="button"
                          onClick={() => setUpdating(updateCard)}
                          className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-(--tmd-fg-muted) hover:bg-(--tmd-bg-hover) hover:text-(--tmd-accent)"
                          data-skill-update={rec.name}
                        >
                          <ArrowClockwise size={12} aria-hidden="true" />
                          {t("更新")}
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => openPreview(rec)}
                        className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-(--tmd-fg-muted) hover:bg-(--tmd-bg-hover)"
                        data-skill-detail={rec.name}
                      >
                        <Eye size={12} aria-hidden="true" />
                        {t("详情")}
                      </button>
                      <button
                        type="button"
                        onClick={() => setPendingDelete(rec)}
                        className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-(--tmd-fg-muted) hover:bg-(--tmd-bg-hover) hover:text-(--tmd-err)"
                        data-skill-delete={rec.name}
                      >
                        <Trash size={12} aria-hidden="true" />
                        {t("删除")}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {pendingDelete && (
        <DeleteConfirmDialog
          rec={pendingDelete}
          deleting={deleting}
          error={deleteError}
          onCancel={() => setPendingDelete(null)}
          onConfirm={() => void confirmDelete()}
        />
      )}
      {preview && <SkillPreviewDrawer skill={preview} onClose={() => setPreview(null)} />}
      {updating && (
        <InstallDialog
          card={updating}
          onClose={() => setUpdating(null)}
          onInstalled={() => void refreshSkillScan()}
        />
      )}
    </div>
  );
}

/** 删除确认:公约位目标多家共用的提示沿用;失败保留弹窗显错。 */
function DeleteConfirmDialog(props: {
  rec: InstalledSkillRecord;
  deleting: boolean;
  error: string | null;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const { rec } = props;
  const shared = rec.targets.includes(SHARED_SKILLS_REL);
  return (
    <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/30">
      <div className="w-80 rounded-md border border-(--tmd-border) bg-(--tmd-bg-elevated) p-4 shadow-xl" data-skill-delete-confirm>
        <div className="mb-2 text-xs font-medium">{t("删除技能「{name}」?", { name: rec.name })}</div>
        <div className="mb-1 text-[11px] text-(--tmd-fg-muted)">
          {t("落位")}:{rec.targets.join(" · ")}
        </div>
        {shared && (
          <div className="mb-1 text-[11px] text-(--tmd-err)">
            {t("公约位技能多家引擎共用,删除后全部失效")}
          </div>
        )}
        {props.error && (
          <div className="mb-2 break-all text-[11px] text-(--tmd-err)">{props.error}</div>
        )}
        <div className="mb-3 text-[11px] text-(--tmd-fg-faint)">
          {t("移入系统回收站,可从废纸篓恢复;安装记录同步移除")}
        </div>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={props.onCancel}
            className="rounded border border-(--tmd-border) px-2.5 py-1 text-xs hover:bg-(--tmd-bg-hover)"
          >
            {t("取消")}
          </button>
          <button
            type="button"
            onClick={props.onConfirm}
            disabled={props.deleting}
            className="rounded bg-(--tmd-err) px-2.5 py-1 text-xs text-white disabled:opacity-50"
          >
            {props.deleting ? t("删除中…") : t("删除")}
          </button>
        </div>
      </div>
    </div>
  );
}
