/**
 * 记忆文件面板 —— 文件视图(E-01 自 MemoryFilesPanel 拆出降复杂度)。
 *
 * 作用域分段(项目/全局)+ 按真实文件去重的卡片(共享 AGENTS.md 一行,
 * 引擎列合并);探测/生成状态全部收敛在本视图,随视图挂载惰性启动。
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowClockwise } from "@phosphor-icons/react";
import type { CliProfile } from "@kernel/cli";
import { t } from "@kernel/i18n";
import { Spinner } from "@kernel/Spinner";
import { openFileInTab } from "@kernel/fileTabs";
import { userHome } from "../paths";
import {
  dedupeMemorySlots,
  entryState,
  expandMemorySlots,
  generateMemoryTemplate,
  probeMemoryFiles,
  undeclaredEngines,
  type MemoryFileEntry,
  type MemoryProbeMap,
} from "./memoryFilesData";
import { MemoryFileCard, ScopeContext, ScopeSegmented, UndeclaredGroup } from "./MemoryFilesRows";

const ACTION_CLS =
  "flex-none rounded border border-(--tmd-border) px-2 py-0.5 text-meta text-(--tmd-fg-muted) transition-colors hover:border-(--tmd-accent) hover:text-(--tmd-accent) disabled:opacity-50";

export function MemoryFilesView({ profiles, cwd }: { profiles: CliProfile[]; cwd: string | null }) {
  const [scope, setScope] = useState<"project" | "user">("project");
  const [home, setHome] = useState("");
  const [probe, setProbe] = useState<MemoryProbeMap>({});
  const [probing, setProbing] = useState(false);
  const [probedOnce, setProbedOnce] = useState(false);
  const [undeclaredOpen, setUndeclaredOpen] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [genBusy, setGenBusy] = useState<string | null>(null);
  const [genFailed, setGenFailed] = useState<MemoryProbeMap>({});

  useEffect(() => {
    userHome().then(setHome).catch(() => setHome(""));
  }, []);

  const { project, user } = useMemo(
    () => (home === "" ? { project: [], user: [] } : expandMemorySlots(profiles, cwd, home)),
    [profiles, cwd, home],
  );
  const undeclared = useMemo(() => undeclaredEngines(profiles), [profiles]);
  const entries = useMemo(() => dedupeMemorySlots(scope === "project" ? project : user), [scope, project, user]);
  const summary = useMemo(() => {
    const ok = entries.filter((e) => entryState(e, probe) === "ok").length;
    return { ok, total: entries.length };
  }, [entries, probe]);

  const runProbe = useCallback(async () => {
    const paths = [...project, ...user].map((s) => s.absPath);
    setProbing(true);
    setGenFailed({});
    try {
      setProbe(await probeMemoryFiles(paths));
      setProbedOnce(true);
    } finally {
      setProbing(false);
    }
  }, [project, user]);

  /* 槽集(路径串)或 home 变化即重探 */
  const pathsKey = [...project, ...user].map((s) => s.absPath).join("\n");
  useEffect(() => {
    if (home === "") return;
    void runProbe();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 路径串引用随槽集变化即重探,豁免 runProbe 恒新引用
  }, [pathsKey, home]);

  /* 生成空模板:写盘成功原位翻转状态;失败仅行内标记 */
  const generate = useCallback(async (entry: MemoryFileEntry) => {
    setGenBusy(entry.absPath);
    try {
      await generateMemoryTemplate({
        engine: entry.engines[0] ?? "", scope: entry.scope, label: entry.label, relPath: entry.relPath, absPath: entry.absPath,
      });
      setGenFailed((prev) => ({ ...prev, [entry.absPath]: false }));
      setProbe((prev) => ({ ...prev, [entry.absPath]: true }));
    } catch {
      setGenFailed((prev) => ({ ...prev, [entry.absPath]: true }));
    } finally {
      setGenBusy(null);
    }
  }, []);

  return (
    <>
      {/* 作用域分段 + 摘要 + 重新探测 */}
      <div className="flex-none px-1.5 pt-1.5">
        <ScopeSegmented scope={scope} onScope={setScope} />
        <ScopeContext scope={scope} base={cwd} />
        <div className="flex items-center gap-2 pb-1.5 text-meta text-(--tmd-fg-muted)">
          <span>{probedOnce || probing ? t("{n}/{m} 已存在", { n: String(summary.ok), m: String(summary.total) }) : t("探测中…")}</span>
          <button
            type="button"
            onClick={() => void runProbe()}
            disabled={probing || (project.length === 0 && user.length === 0)}
            className={`${ACTION_CLS} ml-auto inline-flex items-center gap-1`}
            title={t("按 profile 声明批量探测")}
          >
            {probing ? <Spinner /> : <ArrowClockwise aria-hidden />}
            {t("重新探测")}
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-2">
        <div className="px-0.5 pb-1.5 text-[10px] text-(--tmd-fg-faint)">{t("按真实文件去重 · 共享文件合并为一行")}</div>
        {entries.map((entry) => (
          <MemoryFileCard
            key={entry.absPath}
            entry={entry}
            probe={probe}
            pending={!probedOnce}
            selected={selected === entry.absPath}
            generating={genBusy === entry.absPath}
            genFailed={!!genFailed[entry.absPath]}
            onOpen={(e) => {
              setSelected(e.absPath);
              openFileInTab(e.absPath);
            }}
            onCreate={(e) => void generate(e)}
          />
        ))}
        {home !== "" && entries.length === 0 && (
          <div className="p-3 text-center text-xs text-(--tmd-fg-faint)">{t("尚无引擎声明记忆文件")}</div>
        )}
        <UndeclaredGroup engines={undeclared} open={undeclaredOpen} onToggle={() => setUndeclaredOpen(!undeclaredOpen)} />
      </div>

      <div className="flex-none border-t border-(--tmd-border) px-1.5 py-1.5 text-meta leading-relaxed text-(--tmd-fg-muted)">
        {t("项目规则只作用于当前工作区;全局规则所有项目共用。点击文件进编辑器,创建模板只写空壳。")}
      </div>
    </>
  );
}
