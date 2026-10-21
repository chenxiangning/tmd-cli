/**
 * ports · 行渲染 —— 监听端口行(进程家族父子两级折叠)纯展示件。
 * 归因/工作区/新鲜度数据由容器注入,动作经 ctx 回调上抛,本件零状态。
 */

import type { ReactNode } from "react";
import { ArrowSquareOut, CaretDown, CaretRight, CaretUp, Check, Copy, Prohibit, TerminalWindow } from "@phosphor-icons/react";
import { t } from "@kernel/i18n";
import { killCommand } from "./portsKill";
import { rowKey } from "./portsTree";
import { portPurpose } from "./purpose";
import type { OsKind, OwnerSession, PortEntry, PortGroup, SortKey, SortSpec } from "./types";

/** 行渲染上下文(容器注入)。 */
export interface RowCtx {
  os: OsKind;
  newKeys: ReadonlySet<string>;
  killing: ReadonlySet<string>;
  collapsed: ReadonlySet<string>;
  /** 复制成功闪态:key = `${rowKey}:url|kill`。 */
  flash: string | null;
  ownerOf: (entry: PortEntry) => OwnerSession | null;
  wsNameOf: (gitRoot: string | null) => string | null;
  onToggle: (key: string) => void;
  onOpenUrl: (port: number) => void;
  onCopy: (kind: "url" | "kill", entry: PortEntry) => void;
  onKillAsk: (entry: PortEntry) => void;
  onJumpSession: (sessionId: string) => void;
  /** 行点击(非动作区)弹端口详情。 */
  onDetail: (entry: PortEntry) => void;
}

const ICON_BTN =
  "flex h-6 w-6 shrink-0 items-center justify-center rounded-(--tmd-radius-sm) text-(--tmd-fg-muted) hover:bg-(--tmd-bg-hover) hover:text-(--tmd-fg) disabled:opacity-40 disabled:hover:bg-transparent";

/** 行尾动作簇:打开浏览器 / 复制地址 / 复制 kill 命令 / 终止。 */
function RowActions({ entry, ctx }: { entry: PortEntry; ctx: RowCtx }) {
  const key = rowKey(entry);
  const killing = ctx.killing.has(key);
  const flashUrl = ctx.flash === `${key}:url`;
  const flashKill = ctx.flash === `${key}:kill`;
  return (
    <span className="flex shrink-0 items-center gap-0.5 pl-1">
      <button type="button" className={ICON_BTN} title={t("浏览器打开")} onClick={() => ctx.onOpenUrl(entry.port)}>
        <ArrowSquareOut size="0.875rem" />
      </button>
      <button type="button" className={ICON_BTN} title={flashUrl ? t("已复制") : t("复制地址")} onClick={() => ctx.onCopy("url", entry)}>
        {flashUrl ? <Check size="0.875rem" className="text-(--tmd-accent)" /> : <Copy size="0.875rem" />}
      </button>
      <button
        type="button"
        className={ICON_BTN}
        disabled={entry.pid == null}
        title={t("复制终止命令:{cmd}", { cmd: killCommand(entry.pid ?? 0, ctx.os) })}
        onClick={() => ctx.onCopy("kill", entry)}
      >
        {flashKill ? <Check size="0.875rem" className="text-(--tmd-accent)" /> : <TerminalWindow size="0.875rem" />}
      </button>
      <button
        type="button"
        className={ICON_BTN + " hover:text-(--tmd-diff-removed)"}
        disabled={entry.pid == null || killing}
        title={killing ? t("终止中…") : t("终止进程")}
        onClick={() => ctx.onKillAsk(entry)}
      >
        <Prohibit size="0.875rem" />
      </button>
    </span>
  );
}

function OwnerChip({ owner, ctx }: { owner: OwnerSession; ctx: RowCtx }) {
  return (
    <button
      type="button"
      className="max-w-36 shrink-0 truncate text-[0.6875rem] text-(--tmd-accent) hover:underline"
      title={t("由本应用会话启动,点击跳转会话")}
      onClick={() => ctx.onJumpSession(owner.id)}
    >
      ↳ {owner.title || owner.profileId}
    </button>
  );
}

/** 中段五列:地址 / 暴露面 / 用途 / 进程 / 仓库。 */
function PortCells({ entry, ws }: { entry: PortEntry; ws: string | null }) {
  const purpose = portPurpose(entry.port);
  const exposed = entry.exposure === "exposed";
  const repoTitle = entry.gitRoot ?? entry.cwd ?? undefined;
  return (
    <>
      <span className="w-16 shrink-0 truncate font-mono text-[0.6875rem] text-(--tmd-fg-muted)" title={entry.addr}>
        {entry.addr}
      </span>
      <span
        className={"w-12 shrink-0 text-[0.6875rem] " + (exposed ? "text-(--tmd-git-modified)" : "text-(--tmd-fg-faint)")}
      >
        {exposed ? t("局域网") : t("仅本机")}
      </span>
      <span className="w-28 shrink-0 truncate text-xs" title={purpose ?? entry.process}>
        {purpose ?? "—"}
      </span>
      <span
        className="min-w-0 flex-1 truncate text-[0.6875rem] text-(--tmd-fg-muted)"
        title={entry.args || entry.process || undefined}
      >
        {entry.process || "—"}
        {entry.pid != null ? ` · ${entry.pid}` : ""}
        {entry.args ? <span className="ml-1 opacity-70">{entry.args}</span> : null}
      </span>
      <span className="w-40 shrink-0 truncate text-[0.6875rem] text-(--tmd-fg-muted)" title={repoTitle}>
        {ws ?? entry.gitRoot ?? ""}
      </span>
    </>
  );
}

/** 单个可排序列头按钮:点击排序、再点反向;激活列显示方向箭头。 */
function SortTh({
  label,
  sortKey,
  width,
  right = false,
  sort,
  onSort,
}: {
  label: string;
  sortKey: SortKey;
  width: string;
  right?: boolean;
  sort: SortSpec | null;
  onSort: (key: SortKey) => void;
}) {
  const active = sort?.key === sortKey;
  return (
    <button
      type="button"
      className={
        "flex items-center gap-0.5 truncate hover:text-(--tmd-fg) " +
        width +
        (right ? " justify-end text-right " : " ") +
        (active ? "text-(--tmd-accent)" : "")
      }
      title={active ? (sort.dir === "asc" ? t("升序") : t("降序")) : label}
      onClick={() => onSort(sortKey)}
    >
      {label}
      {active && (sort.dir === "asc" ? <CaretUp size="0.625rem" /> : <CaretDown size="0.625rem" />)}
    </button>
  );
}

/** 列表列头:列宽与 PortRowLine/PortCells 逐一对应,scroll 容器内吸顶;整行可排序。 */
export function PortListHeader({
  sort,
  onSort,
}: {
  sort: SortSpec | null;
  onSort: (key: SortKey) => void;
}) {
  return (
    <div className="sticky top-0 z-10 flex items-center gap-2 border-b border-(--tmd-border) bg-(--tmd-bg-base) px-2 py-1 text-[0.625rem] text-(--tmd-fg-faint)">
      <span className="w-5 shrink-0" aria-hidden />
      <SortTh label={t("端口")} sortKey="port" width="w-12 shrink-0" right sort={sort} onSort={onSort} />
      <SortTh label={t("监听地址")} sortKey="addr" width="w-16 shrink-0" sort={sort} onSort={onSort} />
      <SortTh label={t("暴露面")} sortKey="exposure" width="w-12 shrink-0" sort={sort} onSort={onSort} />
      <SortTh label={t("用途")} sortKey="purpose" width="w-28 shrink-0" sort={sort} onSort={onSort} />
      <SortTh label={t("进程")} sortKey="process" width="min-w-0 flex-1" sort={sort} onSort={onSort} />
      <SortTh label={t("仓库")} sortKey="repo" width="w-40 shrink-0" sort={sort} onSort={onSort} />
      <span className="w-[6.625rem] shrink-0" aria-hidden />
    </div>
  );
}

export function PortRowLine({ entry, ctx, lead }: { entry: PortEntry; ctx: RowCtx; lead?: ReactNode }) {
  const key = rowKey(entry);
  const ws = ctx.wsNameOf(entry.gitRoot);
  const owner = ctx.ownerOf(entry);
  return (
    <div className="flex min-w-0 items-center gap-2 px-2 py-1.5 hover:bg-(--tmd-bg-hover)">
      <span className="flex w-5 shrink-0 items-center justify-center text-(--tmd-fg-faint)">{lead}</span>
      {/* 主内容区 = 原生 button:整段(端口+五列)点击弹详情;动作簇/折叠钮在外层,不嵌套。 */}
      <button
        type="button"
        className="m-0 flex min-w-0 flex-1 cursor-pointer items-center gap-2 border-0 bg-transparent p-0 text-left text-inherit outline-none focus-visible:bg-(--tmd-bg-hover)"
        title={t("点击查看端口详情")}
        onClick={() => ctx.onDetail(entry)}
      >
        <span className="w-12 shrink-0 text-right font-mono text-xs font-semibold">{entry.port}</span>
        <PortCells entry={entry} ws={ws} />
      </button>
      {owner && <OwnerChip owner={owner} ctx={ctx} />}
      {ctx.newKeys.has(key) && (
        <span className="shrink-0 rounded-(--tmd-radius-sm) bg-(--tmd-accent-soft) px-1 text-[0.625rem] text-(--tmd-accent)">
          {t("新出现")}
        </span>
      )}
      <RowActions entry={entry} ctx={ctx} />
    </div>
  );
}

/**
 * 监听进程家族组 = 一张卡片:组头行(顶层监听进程)+ 虚线描边子容器(子监听行)。
 * 层级靠容器归属表达——子行不再画 └ 引导符;无子行 = 单平铺卡片。
 */
export function PortGroupBlock({ group, ctx }: { group: PortGroup; ctx: RowCtx }) {
  const key = rowKey(group.top);
  const hasChildren = group.children.length > 0;
  const collapsed = ctx.collapsed.has(key);
  const lead = hasChildren ? (
    <button
      type="button"
      className="flex h-full w-full items-center justify-center text-(--tmd-fg-faint) hover:text-(--tmd-fg)"
      aria-expanded={!collapsed}
      aria-label={t("折叠子进程")}
      onClick={() => ctx.onToggle(key)}
    >
      {collapsed ? <CaretRight size="0.625rem" /> : <CaretDown size="0.625rem" />}
    </button>
  ) : null;
  return (
    <div className="overflow-hidden rounded-(--tmd-radius-sm) border border-(--tmd-border) bg-(--tmd-bg-elevated)">
      <PortRowLine entry={group.top} ctx={ctx} lead={lead} />
      {hasChildren && !collapsed && (
        <div className="mx-2 mb-2 rounded-(--tmd-radius-sm) border border-dashed border-(--tmd-border-strong) [&>:last-child]:border-b-0">
          {group.children.map((c) => (
            <PortRowLine key={rowKey(c)} entry={c} ctx={ctx} />
          ))}
        </div>
      )}
    </div>
  );
}
