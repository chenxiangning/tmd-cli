/**
 * 记忆文件面板 · 行组件面(自 MemoryFilesPanel 拆出守 300 行铁则)。
 * 纯展示:状态点/行/分组头,生成态经 props 传入,状态归 MemoryFilesPanel。
 */

import { openFileInTab } from "@kernel/fileTabs";
import { t } from "@kernel/i18n";
import { Spinner } from "@kernel/Spinner";
import { slotState, type MemoryProbeMap, type MemorySlot } from "./memoryFilesData";

/** 状态点(在 = ok 色 / 未生成 = warn 色;未声明灰点在 UndeclaredRow 内联)。 */
const DOT_CLS: Record<"ok" | "missing", string> = {
  ok: "bg-(--tmd-ok)",
  missing: "bg-(--tmd-warn)",
};

/** 行内动作钮统一形(AnimProjectRow ACTION_CLS 同款:悬停染 accent)。 */
const ACTION_CLS =
  "flex-none rounded border border-(--tmd-border) px-2 py-0.5 text-meta text-(--tmd-fg-muted) transition-colors hover:border-(--tmd-accent) hover:text-(--tmd-accent) disabled:opacity-50 disabled:hover:border-(--tmd-border) disabled:hover:text-(--tmd-fg-muted)";

/** 单行:状态点 + 引擎 + 文件名(mono,可点进编辑器)+ relPath faint + 尾注。 */
function MemoryFileRow({
  slot,
  probe,
  pending,
  generating,
  genFailed,
  onGenerate,
}: {
  slot: MemorySlot;
  probe: MemoryProbeMap;
  pending: boolean;
  generating: boolean;
  genFailed: boolean;
  onGenerate: (slot: MemorySlot) => void;
}) {
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
            <button
              type="button"
              onClick={() => onGenerate(slot)}
              disabled={generating}
              title={t("写入空模板;完整内容可在终端跑 /init 生成")}
              className={ACTION_CLS}
            >
              {generating ? <Spinner /> : t("生成模板")}
            </button>
            {genFailed && <span className="text-meta text-(--tmd-error)">{t("生成模板失败")}</span>}
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

/** 已声明两组(项目级/用户级):无工作区项目组整组隐藏,行随 probe 落定三态。
 *  行键 = engine:scope —— absPath 会撞键(pi/kimi/codex/… 项目级同为 {cwd}/AGENTS.md),
 *  重复键在列表重渲染时正是行错位/重复的根源。 */
export function DeclaredGroups({
  cwd,
  project,
  user,
  probe,
  pending,
  genBusy,
  genFailed,
  onGenerate,
}: {
  cwd: string | null;
  project: MemorySlot[];
  user: MemorySlot[];
  probe: MemoryProbeMap;
  pending: boolean;
  genBusy: string | null;
  genFailed: MemoryProbeMap;
  onGenerate: (slot: MemorySlot) => void;
}) {
  return (
    <>
      {cwd !== null && project.length > 0 && (
        <>
          <GroupHead label={t("项目级(当前工作区)")} />
          {project.map((slot) => (
            <MemoryFileRow
              key={`${slot.engine}:${slot.scope}`}
              slot={slot}
              probe={probe}
              pending={pending}
              generating={genBusy === slot.absPath}
              genFailed={!!genFailed[slot.absPath]}
              onGenerate={onGenerate}
            />
          ))}
        </>
      )}
      {user.length > 0 && (
        <>
          <GroupHead label={t("用户级(Home)")} />
          {user.map((slot) => (
            <MemoryFileRow
              key={`${slot.engine}:${slot.scope}`}
              slot={slot}
              probe={probe}
              pending={pending}
              generating={genBusy === slot.absPath}
              genFailed={!!genFailed[slot.absPath]}
              onGenerate={onGenerate}
            />
          ))}
        </>
      )}
    </>
  );
}

/** 未声明组:默认折叠,点击头展开(不猜路径,零声明引擎只列名)。 */
export function UndeclaredGroup({
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
