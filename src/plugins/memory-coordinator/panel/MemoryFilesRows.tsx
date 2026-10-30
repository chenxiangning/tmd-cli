/**
 * 记忆文件面板 · 文件视图组件面(方案 A 重构:作用域分段 + 按真实文件去重的卡片)。
 * 纯展示:状态归 MemoryFilesPanel;行三态 = 在(点击进编辑器)/ 未生成(创建模板)/ 未声明。
 */

import { t } from "@kernel/i18n";
import { Spinner } from "@kernel/Spinner";
import { entryState, type MemoryFileEntry, type MemoryProbeMap } from "./memoryFilesData";

/** 行内动作钮统一形(悬停染 accent)。 */
const ACTION_CLS =
  "flex-none rounded border border-(--tmd-border) px-2 py-0.5 text-meta text-(--tmd-fg-muted) transition-colors hover:border-(--tmd-accent) hover:text-(--tmd-accent) disabled:opacity-50 disabled:hover:border-(--tmd-border) disabled:hover:text-(--tmd-fg-muted)";

/** 作用域分段:项目规则 / 全局规则(设计稿 .seg 同位)。 */
export function ScopeSegmented({
  scope, onScope,
}: {
  scope: "project" | "user";
  onScope: (s: "project" | "user") => void;
}) {
  return (
    <div className="flex gap-0.5 rounded-lg bg-(--tmd-bg-subtle) p-0.5">
      {(["project", "user"] as const).map((s) => (
        <button
          key={s}
          type="button"
          aria-pressed={scope === s}
          onClick={() => onScope(s)}
          className={`flex-1 rounded-md px-1.5 py-1 text-meta transition-colors ${
            scope === s ? "bg-(--tmd-bg-elevated) text-(--tmd-fg) shadow-sm" : "text-(--tmd-fg-muted) hover:text-(--tmd-fg)"
          }`}
        >
          {s === "project" ? t("项目规则") : t("全局规则")}
        </button>
      ))}
    </div>
  );
}

/** 作用域上下文行:基目录 + 生效范围说明。 */
export function ScopeContext({ scope, base }: { scope: "project" | "user"; base: string | null }) {
  return (
    <div className="flex items-center gap-1.5 px-0.5 py-1 text-meta text-(--tmd-fg-muted)">
      <span className="min-w-0 truncate">{scope === "project" ? (base ?? t("打开工作区后可用")) : "~/ (Home)"}</span>
      <span className="ml-auto flex-none text-(--tmd-fg-faint)">{scope === "project" ? t("仅当前项目生效") : t("所有项目共用")}</span>
    </div>
  );
}

/** 状态徽标:在 = ok / 未生成 = warn / 探测中 = 中性。 */
function StateBadge({ state, pending }: { state: "ok" | "missing" | "pending"; pending: boolean }) {
  const cls = pending
    ? "border-(--tmd-border) text-(--tmd-fg-faint)"
    : state === "ok"
      ? "border-(--tmd-ok) text-(--tmd-ok)"
      : "border-(--tmd-warn) text-(--tmd-warn)";
  return <span className={`flex-none rounded-full border px-1.5 text-[10px] leading-4 ${cls}`}>{pending ? t("探测中") : state === "ok" ? t("已存在") : t("未生成")}</span>;
}

/** 文件卡片:文件名 + 状态 + 路径 + 共享引擎 + 动作(在 = 打开编辑器 / 缺 = 创建模板)。 */
export function MemoryFileCard({
  entry, probe, pending, selected, generating, genFailed, onOpen, onCreate,
}: {
  entry: MemoryFileEntry;
  probe: MemoryProbeMap;
  pending: boolean;
  selected: boolean;
  generating: boolean;
  genFailed: boolean;
  onOpen: (e: MemoryFileEntry) => void;
  onCreate: (e: MemoryFileEntry) => void;
}) {
  const state = pending ? "pending" : entryState(entry, probe);
  const exists = state === "ok";
  const rel = entry.scope === "project" ? entry.relPath : `~/${entry.relPath}`;
  return (
    <article
      className={`relative mb-1.5 overflow-hidden rounded-lg border bg-(--tmd-bg-elevated) transition-colors ${
        selected ? "border-(--tmd-accent)" : "border-(--tmd-border) hover:border-(--tmd-border-strong)"
      }`}
    >
      {selected && <span className="absolute inset-y-0 left-0 z-1 w-0.5 bg-(--tmd-accent)" aria-hidden />}
      <button
        type="button"
        disabled={!exists}
        onClick={() => onOpen(entry)}
        title={entry.absPath}
        className="block w-full px-2.5 pt-2 pb-1.5 text-left disabled:cursor-default"
      >
        <div className="flex items-center gap-1.5">
          <span className="min-w-0 truncate font-mono text-xs font-semibold text-(--tmd-fg)">{entry.label}</span>
          <StateBadge state={state} pending={pending} />
        </div>
        <div className="mt-0.5 truncate font-mono text-[10px] text-(--tmd-fg-faint)" title={entry.absPath}>{rel}</div>
        <div className="mt-1.5 flex items-center gap-1">
          {entry.engines.slice(0, 3).map((e) => (
            <span key={e} className="rounded border border-(--tmd-border) px-1 text-[10px] text-(--tmd-fg-muted)">{e}</span>
          ))}
          {entry.engines.length > 3 && <span className="text-[10px] text-(--tmd-fg-faint)">+{entry.engines.length - 3}</span>}
        </div>
      </button>
      {!exists && !pending && (
        <div className="flex items-center gap-2 border-t border-(--tmd-border) bg-(--tmd-warn)/8 px-2.5 py-1.5 text-meta text-(--tmd-warn)">
          <span className="min-w-0 flex-1">{t("空白模板不会影响另一作用域")}</span>
          <button type="button" disabled={generating} onClick={() => onCreate(entry)} title={t("写入空模板;完整内容可在终端跑 /init 生成")} className={ACTION_CLS}>
            {generating ? <Spinner /> : t("创建模板")}
          </button>
          {genFailed && <span className="text-meta text-(--tmd-error)">{t("生成模板失败")}</span>}
        </div>
      )}
    </article>
  );
}

/** 未声明组:默认折叠,零声明引擎只列名(不猜路径)。 */
export function UndeclaredGroup({ engines, open, onToggle }: { engines: string[]; open: boolean; onToggle: () => void }) {
  if (engines.length === 0) return null;
  return (
    <div className="mt-2.5 border-t border-(--tmd-border) pt-1">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-0.5 py-1.5 text-left text-meta text-(--tmd-fg-muted) hover:text-(--tmd-fg)"
      >
        <span>{t("未声明")} · {engines.length}</span>
        <span className={`ml-auto text-(--tmd-fg-faint) transition-transform ${open ? "rotate-180" : ""}`}>▾</span>
      </button>
      {open && (
        <div className="space-y-0.5 px-0.5 pb-1 text-meta text-(--tmd-fg-faint)">
          {engines.map((e) => (
            <div key={e} className="flex h-6 items-center gap-2">
              <span className="size-[7px] flex-none rounded-full bg-(--tmd-border)" aria-hidden />
              {e} · {t("— 未声明路径")}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
