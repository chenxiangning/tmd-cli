/**
 * 跨引擎原生记忆文件面板 —— 声明式发现 + 一键进编辑器,零 AI 零代写。
 *
 * 三组渲染:项目级(当前工作区 cwd,无工作区整组隐藏)/ 用户级(Home)/
 * 未声明(零声明 profile 灰行,默认折叠)。行三态:在(文件名可点进编辑器)/
 * 未生成(hint「终端跑 /init 可生成」,不代写)/ 未声明(不猜路径)。
 * 数据面在 memoryFilesData.ts(纯逻辑 + 批量探测,单测 seam)。
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowClockwise } from "@phosphor-icons/react";
import { host, useHost } from "@kernel/host";
import { useWorkspaces } from "@kernel/workspace";
import { openFileInTab } from "@kernel/fileTabs";
import { t } from "@kernel/i18n";
import { Spinner } from "@kernel/Spinner";
import { userHome } from "../paths";
import {
  expandMemorySlots,
  probeMemoryFiles,
  summarizeMemoryFiles,
  slotState,
  undeclaredEngines,
  type MemoryProbeMap,
  type MemorySlot,
} from "./memoryFilesData";

/** 状态点(在 = ok 色 / 未生成 = warn 色;未声明灰点在 UndeclaredRow 内联)。 */
const DOT_CLS: Record<"ok" | "missing", string> = {
  ok: "bg-(--tmd-ok)",
  missing: "bg-(--tmd-warn)",
};

/** 行内动作钮统一形(AnimProjectRow ACTION_CLS 同款:悬停染 accent)。 */
const ACTION_CLS =
  "flex-none rounded border border-(--tmd-border) px-2 py-0.5 text-meta text-(--tmd-fg-muted) transition-colors hover:border-(--tmd-accent) hover:text-(--tmd-accent) disabled:opacity-50 disabled:hover:border-(--tmd-border) disabled:hover:text-(--tmd-fg-muted)";

/** 单行:状态点 + 引擎 + 文件名(mono,可点进编辑器)+ relPath faint + 尾注。 */
function MemoryFileRow({ slot, probe, pending }: { slot: MemorySlot; probe: MemoryProbeMap; pending: boolean }) {
  /* 首轮探测未落定:中性占位(灰点/不可点/无断言),完成后原位落定,不闪「未生成」 */
  const state = pending ? "pending" : slotState(slot, probe);
  const exists = state === "ok";
  const relLabel = slot.scope === "project" ? t("项目根") : `~/${slot.relPath}`;
  return (
    <div className="flex h-7 items-center gap-2 px-1.5" title={`${relLabel}/${slot.label}`}>
      <span
        className={`size-[7px] flex-none rounded-full ${state === "ok" ? DOT_CLS.ok : state === "missing" ? DOT_CLS.missing : "bg-(--tmd-border)"}`}
        aria-hidden
      />
      <span className="w-[3.25rem] flex-none truncate text-meta text-(--tmd-fg-muted)">{slot.engine}</span>
      {exists ? (
        <button
          type="button"
          onClick={() => openFileInTab(slot.absPath)}
          title={t("在编辑器中打开")}
          className="min-w-0 truncate font-mono text-xs text-(--tmd-fg) hover:text-(--tmd-accent)"
        >
          {slot.label}
        </button>
      ) : (
        <span className="min-w-0 truncate font-mono text-xs text-(--tmd-fg-muted)">{slot.label}</span>
      )}
      <span className="ml-auto flex flex-none items-center gap-1.5">
        {state === "missing" && (
          <>
            <span className="rounded bg-(--tmd-warn)/12 px-1.5 py-px text-meta text-(--tmd-warn)">
              {t("终端跑 /init 可生成")}
            </span>
            <span className="text-meta text-(--tmd-fg-muted)">{t("未生成")}</span>
          </>
        )}
        {exists && <span className="text-meta text-(--tmd-fg-faint)">{relLabel}</span>}
      </span>
    </div>
  );
}

/** 未声明灰行:不猜路径、不兜底,只陈述「— 未声明路径」。 */
function UndeclaredRow({ engine }: { engine: string }) {
  return (
    <div className="flex h-7 items-center gap-2 px-1.5">
      <span className="size-[7px] flex-none rounded-full bg-(--tmd-border)" aria-hidden />
      <span className="w-[3.25rem] flex-none truncate text-meta text-(--tmd-fg-muted)">{engine}</span>
      <span className="min-w-0 truncate text-meta text-(--tmd-fg-faint)">{t("— 未声明路径")}</span>
    </div>
  );
}

/** 分组头(设计 .mgroup 同位:灰底细字,右侧可折叠注记)。 */
function GroupHead({ label, note }: { label: string; note?: string }) {
  return (
    <div className="flex items-center gap-2 border-y border-(--tmd-border) bg-(--tmd-bg-subtle) px-1.5 py-1 text-meta font-medium text-(--tmd-fg-muted) first:border-t-0">
      <span>{label}</span>
      {note && <span className="ml-auto font-normal text-(--tmd-fg-faint)">{note}</span>}
    </div>
  );
}

/** 已声明两组(项目级/用户级):无工作区项目组整组隐藏,行随 probe 落定三态。 */
function DeclaredGroups({
  cwd,
  project,
  user,
  probe,
  pending,
}: {
  cwd: string | null;
  project: MemorySlot[];
  user: MemorySlot[];
  probe: MemoryProbeMap;
  pending: boolean;
}) {
  return (
    <>
      {cwd !== null && project.length > 0 && (
        <>
          <GroupHead label={t("项目级(当前工作区)")} />
          {project.map((slot) => (
            <MemoryFileRow key={slot.absPath} slot={slot} probe={probe} pending={pending} />
          ))}
        </>
      )}
      {user.length > 0 && (
        <>
          <GroupHead label={t("用户级(Home)")} />
          {user.map((slot) => (
            <MemoryFileRow key={slot.absPath} slot={slot} probe={probe} pending={pending} />
          ))}
        </>
      )}
    </>
  );
}

/** 未声明组:默认折叠,点击头展开(不猜路径,零声明引擎只列名)。 */
function UndeclaredGroup({
  engines,
  open,
  onToggle,
}: {
  engines: string[];
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <>
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center border-y border-(--tmd-border) bg-(--tmd-bg-subtle) px-1.5 py-1 text-left text-meta font-medium text-(--tmd-fg-muted) hover:text-(--tmd-fg)"
      >
        <span>
          {t("未声明")} · {engines.length}
        </span>
        <span className={`ml-auto font-normal text-(--tmd-fg-faint) ${open ? "rotate-180" : ""}`}>
          ▾
        </span>
      </button>
      {open && engines.map((engine) => <UndeclaredRow key={engine} engine={engine} />)}
    </>
  );
}

export function MemoryFilesPanel() {
  useHost(); /* profile 注册面变化(插件启停)重渲 */
  const profiles = host.getCliProfiles();
  const { list, activeId } = useWorkspaces();
  const cwd = list.find((w) => w.id === activeId)?.root ?? null;
  const [home, setHome] = useState("");
  const [probe, setProbe] = useState<MemoryProbeMap>({});
  const [probing, setProbing] = useState(false);
  const [probedOnce, setProbedOnce] = useState(false);
  const [undeclaredOpen, setUndeclaredOpen] = useState(false);

  useEffect(() => {
    userHome()
      .then(setHome)
      .catch(() => setHome(""));
  }, []);

  const { project, user } = useMemo(
    () => (home === "" ? { project: [], user: [] } : expandMemorySlots(profiles, cwd, home)),
    [profiles, cwd, home],
  );
  const undeclared = useMemo(() => undeclaredEngines(profiles), [profiles]);
  const summary = useMemo(
    () => summarizeMemoryFiles(project, user, probe, undeclared.length),
    [project, user, probe, undeclared.length],
  );

  const runProbe = useCallback(async () => {
    const paths = [...project, ...user].map((s) => s.absPath);
    setProbing(true);
    try {
      setProbe(await probeMemoryFiles(paths));
      setProbedOnce(true);
    } finally {
      setProbing(false);
    }
  }, [project, user]);

  const pathsKey = [...project, ...user].map((s) => s.absPath).join("\n");
  useEffect(() => {
    if (home === "") return;
    void runProbe();
    /* 槽集(路径串)或 home 变化即重探;runProbe 随槽集重建,豁免其自身依赖 */
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 路径串引用随槽集变化即重探,豁免 runProbe 恒新引用
  }, [pathsKey, home]);

  return (
    <div className="flex h-full min-h-0 flex-col" data-icon-decor="memory">
      {/* 头部:摘要 + 重新探测 */}
      <div className="flex flex-none items-center gap-2 px-1.5 py-1.5">
        <span className="min-w-0 truncate text-xs text-(--tmd-fg-muted)">
          {probedOnce || probing
            ? t("{n} 在 · {m} 缺 · {k} 未声明", { n: summary.ok, m: summary.missing, k: summary.undeclared })
            : t("探测中…")}
        </span>
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

      <div className="min-h-0 flex-1 overflow-y-auto px-0.5">
        <DeclaredGroups cwd={cwd} project={project} user={user} probe={probe} pending={!probedOnce} />
        {undeclared.length > 0 && (
          <UndeclaredGroup
            engines={undeclared}
            open={undeclaredOpen}
            onToggle={() => setUndeclaredOpen(!undeclaredOpen)}
          />
        )}
        {home !== "" && project.length === 0 && user.length === 0 && (
          <div className="p-3 text-center text-xs text-(--tmd-fg-faint)">{t("尚无引擎声明记忆文件")}</div>
        )}
      </div>

      {/* footbar:职责声明(只发现与跳转,不代写) */}
      <div className="flex-none border-t border-(--tmd-border) px-1.5 py-1.5 text-meta leading-relaxed text-(--tmd-fg-muted)">
        {t("编辑=打开文件编辑器,复用未保存闸与查找;本面板只发现与跳转,不代写,零 AI")}
      </div>
    </div>
  );
}
