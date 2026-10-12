/**
 * 本地导入弹窗 ── 目标三选(引擎多选 / 公约位 + claude symlink 勾选)。
 * 落位走 importPlan 预检:源即落位目录(导入扫描源再次导回自家)免复制记档;
 * 同名已存在且非源整体报错(既定流程:「已安装」删除后再导),不做半落位。
 * 确认 = fsCopyTree 逐目标复制 + symlink 补链 + upsertSkillRecord(关联层)。
 * 平铺形已在 ImportView 入口禁用。骨架 = kernel DialogShell/OpToggle/
 * DialogActions 共享原语(全仓弹窗同形制)。
 */
import { useState } from "react";
import { DownloadSimple, LinkSimple, ShareNetwork } from "@phosphor-icons/react";
import { t } from "@kernel/i18n";
import { DialogActions, DialogShell, OpToggle } from "@kernel/DialogShell";
import { upsertSkillRecord } from "@plugins/cli-shared/skillRegistry";
import { ENGINE_LABELS, INSTALL_ENGINES, SHARED_SKILLS_REL, type HubSkill } from "@plugins/cli-shared/skillSources";
import { ipc } from "@kernel/ipc";
import { planImportTargets } from "./importPlan";

interface TargetOption {
  key: string;
  label: string;
  rel: string;
}

export function ImportDialog({
  skill,
  onClose,
  onImported,
}: {
  skill: HubSkill;
  onClose: () => void;
  onImported: () => void;
}) {
  /* 引擎目标默认全不勾;公约位默认勾(一份多家用,导入主路径)。 */
  const [engines, setEngines] = useState<ReadonlySet<string>>(new Set());
  const [shared, setShared] = useState(true);
  const [claudeSymlink, setClaudeSymlink] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [symlinkNote, setSymlinkNote] = useState<string | null>(null);
  const [inPlaceNote, setInPlaceNote] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  /* 目录知识单点:rel/顺序全来自 INSTALL_ENGINES,本文件零硬编码(cli-shared 准入)。 */
  const engineTargets: TargetOption[] = INSTALL_ENGINES.map((e) => ({
    key: e.engine,
    label: ENGINE_LABELS[e.engine] ?? e.engine,
    rel: e.rel,
  }));

  const go = async (): Promise<void> => {
    if (busy || done) return;
    if (!shared && engines.size === 0) {
      setError(t("至少选择一个落位目标"));
      return;
    }
    setBusy(true);
    setError(null);
    setSymlinkNote(null);
    setInPlaceNote(null);
    const targets: string[] = []; /* 提到 try 外:catch 里做半落位如实告知 */
    try {
      const home = await ipc.configHomeDir();
      const relByKey = new Map(engineTargets.map((o) => [o.key, o.rel]));
      const wantedSet = new Set<string>();
      if (shared) wantedSet.add(SHARED_SKILLS_REL);
      for (const key of engines) {
        const rel = relByKey.get(key);
        if (rel) wantedSet.add(rel);
      }
      const wanted = [...wantedSet];
      /* 预检:逐目标列父目录条目(缺目录 = undefined 空位),一次性分类。 */
      const listings = await Promise.all(
        wanted.map((rel) =>
          ipc
            .fsListDir(`${home}/${rel}`)
            .then((entries) => entries.map((e) => e.name))
            .catch(() => undefined),
        ),
      );
      const listing: Record<string, readonly string[] | undefined> = {};
      wanted.forEach((rel, i) => {
        listing[rel] = listings[i];
      });
      const plan = planImportTargets(home, skill.dir, skill.name, wanted, listing);
      if (plan.conflicts.length > 0) {
        setError(
          t("{n} 处落位目录已有同名技能:{targets}(先在「已安装」删除,或改选其他目标)", {
            n: plan.conflicts.length,
            targets: plan.conflicts.join(" · "),
          }),
        );
        return;
      }
      /* eslint-disable react-doctor/async-await-in-loop -- 逐目标串行复制与 install.ts
         同形态(失败定位到目标;并行复制多目标无收益,目录 IO 本身串行化)。 */
      for (const rel of plan.copy) {
        await ipc.fsCreateDir(`${home}/${rel}`).catch(() => undefined);
        await ipc.fsCopyTree(skill.dir, `${home}/${rel}/${skill.name}`);
        targets.push(rel);
      }
      /* eslint-enable react-doctor/async-await-in-loop */
      targets.push(...plan.inPlace);
      if (plan.inPlace.length > 0) {
        setInPlaceNote(t("已在落位,免复制:{targets}", { targets: plan.inPlace.join(" · ") }));
      }
      if (shared && claudeSymlink) {
        const link = `${home}/.claude/skills/${skill.name}`;
        try {
          await ipc.skillSymlink(`${home}/${SHARED_SKILLS_REL}/${skill.name}`, link);
          targets.push(".claude/skills");
        } catch (e) {
          /* 已存在且可达(此前手动补链/导入过)视为已满足;不可达才降级提示。 */
          const usable = await ipc.fsListDir(link).then(() => true).catch(() => false);
          if (usable) targets.push(".claude/skills");
          else setSymlinkNote(e instanceof Error ? e.message : String(e));
        }
      }
      await upsertSkillRecord({
        name: skill.name,
        description: skill.description || undefined,
        source: "import",
        targets,
        createdAt: Date.now(),
      });
      setDone(true);
      onImported();
    } catch (e) {
      const detail = e instanceof Error ? e.message : String(e);
      /* 半落位如实告知(与 install.ts 同语义:不回滚;已复制目录保留,记录未写) */
      setError(
        targets.length > 0
          ? `${detail}。${t("已落位 {n} 处保留但未记入已安装:{targets}", {
              n: targets.length,
              targets: targets.join(" · "),
            })}`
          : detail,
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <DialogShell
      title={t("导入技能")}
      icon={<DownloadSimple size="0.875rem" aria-hidden />}
      width={460}
      locked={busy}
      onClose={onClose}
      footer={
        <DialogActions
          className="mt-4"
          confirmLabel={t("导入")}
          confirmDisabled={done}
          submitting={busy}
          cancelLabel={t("关闭")}
          cancelDisabled={busy}
          onConfirm={() => void go()}
          onCancel={onClose}
        />
      }
    >
      <div data-import-dialog={skill.name}>
        <div className="mt-2 text-sm font-medium">{skill.name}</div>
        <div className="truncate text-xs text-(--tmd-fg-faint)" title={skill.dir}>
          {t("来源:{dir}", { dir: skill.dir })}
        </div>
        <div className="mt-1 text-xs text-(--tmd-fg-muted)">
          {t("导入 = 复制一份到所选目录 + 记入已安装(对话框级联的依据)")}
        </div>

        <div className="mt-3">
          <OpToggle
            active={shared}
            icon={<ShareNetwork size="0.75rem" aria-hidden />}
            label={t("公约位 ~/.agents/skills(一份多家用)")}
            disabled={busy || done}
            onToggle={() => setShared((v) => !v)}
          />
          <div className="mb-1 pl-2 text-meta text-(--tmd-fg-faint)">
            {t("codex/omp/pi/kimi/grok/qoder/opencode/dsh 原生读取此目录")}
          </div>
          <div className="ml-5">
            <OpToggle
              active={claudeSymlink}
              icon={<LinkSimple size="0.75rem" aria-hidden />}
              label={t("同步建 symlink 进 ~/.claude/skills(Claude 官方支持)")}
              disabled={!shared || busy || done}
              onToggle={() => setClaudeSymlink((v) => !v)}
            />
            <div className="pl-2 text-meta text-(--tmd-fg-faint)">{t("失败不阻断,仅提示")}</div>
          </div>
        </div>

        <div className="mt-3 text-xs font-medium text-(--tmd-fg-muted)">{t("或直装到引擎目录")}</div>
        <div className="mt-1 flex flex-wrap gap-1">
          {engineTargets.map((opt) => (
            <OpToggle
              key={opt.key}
              active={engines.has(opt.key)}
              label={opt.label}
              disabled={busy || done}
              onToggle={() => {
                const next = new Set(engines);
                if (next.has(opt.key)) next.delete(opt.key);
                else next.add(opt.key);
                setEngines(next);
              }}
            />
          ))}
        </div>

        {error && <div className="mt-2 break-all text-xs text-(--tmd-err)">{error}</div>}
        {symlinkNote && (
          <div className="mt-2 break-all text-xs text-(--tmd-fg-faint)">
            {t("claude 补链失败(不影响导入)")}:{symlinkNote}
          </div>
        )}
        {inPlaceNote && (
          <div className="mt-2 break-all text-xs text-(--tmd-fg-faint)">{inPlaceNote}</div>
        )}
        {done && (
          <div className="mt-2 text-xs text-(--tmd-accent)">{t("导入完成,已入「已安装」;对话框 $ 触发即可级联")}</div>
        )}
      </div>
    </DialogShell>
  );
}
