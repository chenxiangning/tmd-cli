/**
 * ports · 行渲染 —— 监听端口行(进程家族父子两级折叠)纯展示件。
 * 归因/工作区/新鲜度数据由容器注入,动作经 ctx 回调上抛,本件零状态。
 */

import type { ReactNode } from "react";
import { ArrowSquareOut, CaretDown, CaretRight, Check, Copy, Prohibit, TerminalWindow } from "@phosphor-icons/react";
import { t } from "@kernel/i18n";
import { killCommand } from "./portsKill";
import { rowKey } from "./portsTree";
import { portPurpose } from "./purpose";
import type { OsKind, OwnerSession, PortEntry, PortGroup } from "./types";

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

/** 列表列头:列宽与 PortRowLine/PortCells 逐一对应,scroll 容器内吸顶。 */
export function PortListHeader() {
  return (
    <div className="sticky top-0 z-10 flex items-center gap-2 border-b border-(--tmd-border) bg-(--tmd-bg-base) px-2 py-1 text-[0.625rem] text-(--tmd-fg-faint)">
      <span className="w-5 shrink-0" aria-hidden />
      <span className="w-12 shrink-0 text-right">{t("端口")}</span>
      <span className="w-16 shrink-0">{t("监听地址")}</span>
      <span className="w-12 shrink-0">{t("暴露面")}</span>
      <span className="w-28 shrink-0">{t("用途")}</span>
      <span className="min-w-0 flex-1 truncate">{t("进程")}</span>
      <span className="w-40 shrink-0">{t("仓库")}</span>
      <span className="w-[6.625rem] shrink-0" aria-hidden />
    </div>
  );
}

export function PortRowLine({
  entry,
  ctx,
  lead,
  depth = 0,
}: {
  entry: PortEntry;
  ctx: RowCtx;
  /** 行首插槽(组头 caret);子行无。 */
  lead?: ReactNode;
  depth?: 0 | 1;
}) {
  const key = rowKey(entry);
  const ws = ctx.wsNameOf(entry.gitRoot);
  const owner = ctx.ownerOf(entry);
  return (
    <div
      className={
        "flex min-w-0 items-center gap-2 border-b border-(--tmd-border) px-2 py-1 hover:bg-(--tmd-bg-hover)" +
        (depth ? " pl-1" : "")
      }
    >
      <span className="flex w-5 shrink-0 items-center justify-center text-(--tmd-fg-faint)">
        {lead ?? (depth ? <span aria-hidden>└</span> : null)}
      </span>
      <span className="w-12 shrink-0 text-right font-mono text-xs font-semibold">{entry.port}</span>
      <PortCells entry={entry} ws={ws} />
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

/** 监听进程家族组:顶层行 + 可折叠子行(无子行 = 平铺单行)。 */
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
    <div>
      <PortRowLine entry={group.top} ctx={ctx} lead={lead} />
      {hasChildren &&
        !collapsed &&
        group.children.map((c) => <PortRowLine key={rowKey(c)} entry={c} ctx={ctx} depth={1} />)}
    </div>
  );
}
