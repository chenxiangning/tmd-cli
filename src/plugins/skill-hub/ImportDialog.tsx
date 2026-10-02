/**
 * 本地导入弹窗 ── 目标三选(引擎多选 / 公约位 + claude symlink 勾选),
 * 确认 = fsCopyTree 逐目标复制 + symlink 补链 + upsertSkillRecord(关联层)。
 * 平铺形已在 ImportView 入口禁用;同名已存在的目标列冲突可勾覆盖(trash 旧目录)。
 */
import { useEffect, useState } from "react";
import { X } from "@phosphor-icons/react";
import { t } from "@kernel/i18n";
import { useEscClose } from "@kernel/DialogShell";
import { upsertSkillRecord } from "@plugins/cli-shared/skillRegistry";
import { ENGINE_LABELS, INSTALL_ENGINES, SHARED_SKILLS_REL, type HubSkill } from "@plugins/cli-shared/skillSources";
import { ipc } from "@kernel/ipc";

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
  const [done, setDone] = useState(false);

  useEscClose(onClose, busy); /* Esc 关闭;导入中锁定,完成态仍可 Esc 收场 */

  useEffect(() => {
    void (async () => {
      /* 无:预留(冲突探测按落位时逐目标处理,不预扫) */
    })();
  }, [skill]);

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
    const targets: string[] = []; /* 提到 try 外:catch 里做半落位如实告知 */
    try {
      const home = await ipc.configHomeDir();
      if (shared) {
        await ipc.fsCreateDir(`${home}/${SHARED_SKILLS_REL}`).catch(() => undefined);
        await ipc.fsCopyTree(skill.dir, `${home}/${SHARED_SKILLS_REL}/${skill.name}`);
        targets.push(SHARED_SKILLS_REL);
        if (claudeSymlink) {
          try {
            await ipc.skillSymlink(
              `${home}/${SHARED_SKILLS_REL}/${skill.name}`,
              `${home}/.claude/skills/${skill.name}`,
            );
            targets.push(".claude/skills");
          } catch (e) {
            setSymlinkNote(e instanceof Error ? e.message : String(e));
          }
        }
      }
      /* eslint-disable react-doctor/async-await-in-loop -- 逐目标串行复制与 install.ts
         同形态(失败定位到目标;并行复制多目标无收益,目录 IO 本身串行化)。 */
      const relByKey = new Map(engineTargets.map((o) => [o.key, o.rel]));
      for (const key of engines) {
        const rel = relByKey.get(key);
        if (!rel) continue;
        await ipc.fsCreateDir(`${home}/${rel}`).catch(() => undefined);
        await ipc.fsCopyTree(skill.dir, `${home}/${rel}/${skill.name}`);
        targets.push(rel);
      }
      /* eslint-enable react-doctor/async-await-in-loop */
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
    <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/40" role="presentation">
      <dialog
        open
        aria-label={t("导入技能")}
        className="relative m-0 flex max-h-[85%] w-[460px] flex-col overflow-auto rounded-md border border-(--tmd-border) bg-(--tmd-bg-popover) p-4 text-left shadow-(--tmd-shadow-modal)"
        data-import-dialog={skill.name}
      >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void go();
        }}
      >
        <div className="mb-2 flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium">{skill.name}</div>
            <div className="text-xs text-(--tmd-fg-faint)">{t("来源:{dir}", { dir: skill.dir })}</div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="rounded p-1 text-(--tmd-fg-muted) hover:bg-(--tmd-bg-hover) disabled:opacity-40"
            aria-label={t("关闭")}
          >
            <X size="0.875rem" aria-hidden="true" />
          </button>
        </div>

        <div className="mb-2 text-xs text-(--tmd-fg-muted)">
          {t("导入 = 复制一份到所选目录 + 记入已安装(对话框级联的依据)")}
        </div>

        <label className="mb-1 flex items-start gap-2">
          <input
            type="checkbox"
            checked={shared}
            onChange={(e) => setShared(e.target.checked)}
            disabled={busy || done}
            className="mt-0.5"
          />
          <span>
            {t("公约位 ~/.agents/skills(一份多家用)")}
            <span className="block text-meta text-(--tmd-fg-faint)">
              {t("codex/omp/pi/kimi/grok/qoder/opencode/dsh 原生读取此目录")}
            </span>
          </span>
        </label>
        <label className="mb-2 ml-6 flex items-start gap-2">
          <input
            type="checkbox"
            checked={claudeSymlink}
            onChange={(e) => setClaudeSymlink(e.target.checked)}
            disabled={!shared || busy || done}
            className="mt-0.5"
          />
          <span>
            {t("同步建 symlink 进 ~/.claude/skills(Claude 官方支持)")}
            <span className="block text-meta text-(--tmd-fg-faint)">{t("失败不阻断,仅提示")}</span>
          </span>
        </label>

        <div className="mb-1 text-xs font-medium">{t("或直装到引擎目录")}</div>
        <div className="mb-3 flex flex-wrap gap-x-3 gap-y-1">
          {engineTargets.map((opt) => (
            <label key={opt.key} className="flex items-center gap-1 text-xs">
              <input
                type="checkbox"
                checked={engines.has(opt.key)}
                onChange={(e) => {
                  const next = new Set(engines);
                  if (e.target.checked) next.add(opt.key);
                  else next.delete(opt.key);
                  setEngines(next);
                }}
                disabled={busy || done}
              />
              {opt.label}
            </label>
          ))}
        </div>

        {error && <div className="mb-2 break-all text-xs text-(--tmd-err)">{error}</div>}
        {symlinkNote && (
          <div className="mb-2 break-all text-xs text-(--tmd-fg-faint)">
            {t("claude 补链失败(不影响导入)")}:{symlinkNote}
          </div>
        )}
        {done && (
          <div className="mb-2 text-xs text-(--tmd-accent)">{t("导入完成,已入「已安装」;对话框 $ 触发即可级联")}</div>
        )}

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="rounded border border-(--tmd-border) px-2.5 py-1 text-xs hover:bg-(--tmd-bg-hover) disabled:opacity-40"
          >
            {t("关闭")}
          </button>
          <button
            type="submit"
            disabled={busy || done}
            className="rounded bg-(--tmd-accent) px-2.5 py-1 text-xs text-(--tmd-accent-fg) disabled:opacity-50"
          >
            {busy ? t("导入中…") : t("导入")}
          </button>
        </div>
      </form>
      </dialog>
    </div>
  );
}
