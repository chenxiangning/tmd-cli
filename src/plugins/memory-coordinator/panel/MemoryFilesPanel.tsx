/**
 * 跨引擎原生记忆文件面板 —— 方案 A 工作台重构:配置 / 文件 / 体检 / 记录四级视图。
 *
 * home = AI 配置统一落地导航(AiConfigHome);files = 记忆文件(MemoryFilesView);
 * lint = 内嵌 LintView(自带返回);history = 扫描/应用记录紧凑列表,点击进中央报告 tab。
 */

import { useEffect, useState } from "react";
import { ClockCounterClockwise, FileText, House, Notebook, Pulse } from "@phosphor-icons/react";
import { host, useHost } from "@kernel/host";
import { useWorkspaces } from "@kernel/workspace";
import { t } from "@kernel/i18n";
import { LintView } from "../lint/LintView";
import { openLintReport } from "../lint/lintController";
import { loadStore } from "../lint/lintStore";
import { AiConfigHome } from "./AiConfigHome";
import { MemoryFilesView } from "./MemoryFilesView";

/* E-01:home = AI 配置统一落地导航(AiConfigHome);files/lint/history = 原生记忆文件/规则体检。 */
type PanelView = "home" | "files" | "lint" | "history";

const NAV_CLS = (active: boolean) =>
  `flex flex-1 items-center justify-center gap-1 rounded-md px-1 py-1.5 text-meta transition-colors ${
    active ? "bg-(--tmd-accent)/10 font-medium text-(--tmd-accent)" : "text-(--tmd-fg-muted) hover:text-(--tmd-fg)"
  }`;

const ACTION_CLS =
  "flex-none rounded border border-(--tmd-border) px-2 py-0.5 text-meta text-(--tmd-fg-muted) transition-colors hover:border-(--tmd-accent) hover:text-(--tmd-accent) disabled:opacity-50";

/** 记录视图:扫描/应用记录紧凑列表(详情在中央报告 tab)。 */
function HistorySide({ onOpenReport }: { onOpenReport: () => void }) {
  const [scans, setScans] = useState<number | null>(null);
  const [applies, setApplies] = useState<number>(0);
  useEffect(() => {
    void loadStore().then((d) => {
      setScans(d.scanHistory.length);
      setApplies(d.applyJournal.length);
    });
  }, []);
  return (
    <div className="px-1 py-1.5 text-meta leading-relaxed text-(--tmd-fg-muted)">
      <div className="flex items-center gap-2">
        <span>{t("扫描记录")}</span>
        <span className="ml-auto text-(--tmd-fg-faint)">{scans ?? "…"}</span>
      </div>
      <div className="mt-1 flex items-center gap-2">
        <span>{t("应用记录")}</span>
        <span className="ml-auto text-(--tmd-fg-faint)">{applies}</span>
      </div>
      <button type="button" onClick={onOpenReport} className={`${ACTION_CLS} mt-2 inline-flex items-center gap-1`}>
        <FileText aria-hidden />
        {t("在中央区打开完整报告")}
      </button>
      <p className="mt-2 text-(--tmd-fg-faint)">{t("扫描记录保留口径与统计;应用记录保留每次保存前后内容,可回看可撤销。")}</p>
    </div>
  );
}

export function MemoryFilesPanel() {
  useHost(); /* profile 注册面变化(插件启停)重渲 */
  const profiles = host.getCliProfiles();
  const { list, activeId } = useWorkspaces();
  const cwd = list.find((w) => w.id === activeId)?.root ?? null;
  const [view, setView] = useState<PanelView>("home");

  return (
    <div className="flex h-full min-h-0 flex-col" data-icon-decor="memory">
      {/* 主导航:配置(AI 配置统一落地)/ 文件 / 体检 / 记录 */}
      <div className="flex flex-none items-center gap-1.5 px-1.5 pt-1.5">
        <nav className="flex flex-1 gap-0.5 rounded-lg bg-(--tmd-bg-subtle) p-0.5" aria-label={t("AI配置管理")}>
          <button type="button" aria-pressed={view === "home"} onClick={() => setView("home")} className={NAV_CLS(view === "home")}>
            <House aria-hidden />
            {t("AI 配置")}
          </button>
          <button type="button" aria-pressed={view === "files"} onClick={() => setView("files")} className={NAV_CLS(view === "files")}>
            <Notebook aria-hidden />
            {t("文件")}
          </button>
          <button type="button" aria-pressed={view === "lint"} onClick={() => setView("lint")} className={NAV_CLS(view === "lint")}>
            <Pulse aria-hidden />
            {t("体检")}
          </button>
          <button type="button" aria-pressed={view === "history"} onClick={() => setView("history")} className={NAV_CLS(view === "history")}>
            <ClockCounterClockwise aria-hidden />
            {t("记录")}
          </button>
        </nav>
      </div>

      {view === "home" ? (
        <AiConfigHome onShowFiles={() => setView("files")} onShowLint={() => setView("lint")} />
      ) : view === "files" ? (
        <MemoryFilesView profiles={profiles} cwd={cwd} />
      ) : view === "lint" ? (
        <LintView cwd={cwd} workspaceId={activeId ?? null} onBack={() => setView("files")} />
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <HistorySide onOpenReport={() => openLintReport()} />
        </div>
      )}
    </div>
  );
}
