/**
 * ports · 端口详情弹窗 —— 行点击触发:全字段定义列表(换行展示被列表截断的
 * 命令行/路径)+ 动作尾栏(浏览器打开/复制/kill 经二次确认)。展示件零状态。
 */

import { ArrowSquareOut, Check, Copy, Prohibit, TerminalWindow } from "@phosphor-icons/react";
import { t } from "@kernel/i18n";
import { DialogShell } from "@kernel/DialogShell";
import { killCommand } from "./portsKill";
import { portPurpose } from "./purpose";
import type { OsKind, OwnerSession, PortEntry } from "./types";

function Field({ label, value, mono = false }: { label: string; value: string | null; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="text-[0.625rem] text-(--tmd-fg-faint)">{label}</dt>
      <dd
        className={"truncate text-xs text-(--tmd-fg) " + (mono ? "font-mono" : "")}
        title={value ?? undefined}
      >
        {value ?? "—"}
      </dd>
    </div>
  );
}

const FOOT_BTN =
  "flex h-7 items-center gap-1.5 rounded-(--tmd-radius-sm) border border-(--tmd-border-strong) px-2.5 text-xs text-(--tmd-fg-muted) hover:bg-(--tmd-bg-hover) hover:text-(--tmd-fg) disabled:opacity-40";

/** 详情弹窗动作尾栏:打开/复制地址/复制 kill 命令 + 终止(红色实底,接二次确认)。 */
function DetailActions({
  entry,
  os,
  flashUrl,
  flashKill,
  onOpenUrl,
  onCopy,
  onKillAsk,
}: {
  entry: PortEntry;
  os: OsKind;
  flashUrl: boolean;
  flashKill: boolean;
  onOpenUrl: (port: number) => void;
  onCopy: (kind: "url" | "kill", entry: PortEntry) => void;
  onKillAsk: (entry: PortEntry) => void;
}) {
  const killCmd = killCommand(entry.pid ?? 0, os);
  return (
    <div className="mt-4 flex items-center justify-end gap-2">
      <button type="button" className={FOOT_BTN} onClick={() => onOpenUrl(entry.port)}>
        <ArrowSquareOut size="0.875rem" aria-hidden />
        {t("浏览器打开")}
      </button>
      <button type="button" className={FOOT_BTN} onClick={() => onCopy("url", entry)}>
        {flashUrl ? (
          <Check size="0.875rem" className="text-(--tmd-accent)" />
        ) : (
          <Copy size="0.875rem" aria-hidden />
        )}
        {flashUrl ? t("已复制") : t("复制地址")}
      </button>
      <button
        type="button"
        className={FOOT_BTN}
        disabled={entry.pid == null}
        title={t("复制终止命令:{cmd}", { cmd: killCmd })}
        onClick={() => onCopy("kill", entry)}
      >
        {flashKill ? (
          <Check size="0.875rem" className="text-(--tmd-accent)" />
        ) : (
          <TerminalWindow size="0.875rem" aria-hidden />
        )}
        {flashKill ? t("已复制") : t("复制终止命令")}
      </button>
      <button
        type="button"
        className="flex h-7 items-center gap-1.5 rounded-(--tmd-radius-sm) bg-(--tmd-err) px-2.5 text-xs text-(--tmd-accent-fg) hover:opacity-90 disabled:opacity-40"
        disabled={entry.pid == null}
        onClick={() => onKillAsk(entry)}
      >
        <Prohibit size="0.875rem" aria-hidden />
        {t("终止进程")}
      </button>
    </div>
  );
}

export function PortDetailDialog({
  entry,
  os,
  ws,
  owner,
  isNew,
  flash,
  onOpenUrl,
  onCopy,
  onKillAsk,
  onClose,
}: {
  entry: PortEntry;
  os: OsKind;
  /** 命中工作区显示名;null = 未认领。 */
  ws: string | null;
  owner: OwnerSession | null;
  isNew: boolean;
  /** 复制成功闪态:`${pid:port}:url|kill`。 */
  flash: string | null;
  onOpenUrl: (port: number) => void;
  onCopy: (kind: "url" | "kill", entry: PortEntry) => void;
  onKillAsk: (entry: PortEntry) => void;
  onClose: () => void;
}) {
  const key = `${entry.pid ?? entry.addr}:${entry.port}`;
  const flashUrl = flash === `${key}:url`;
  const flashKill = flash === `${key}:kill`;
  const killCmd = killCommand(entry.pid ?? 0, os);
  return (
    <DialogShell
      title={t("端口详情")}
      icon={<span aria-hidden>◉</span>}
      width={520}
      onClose={onClose}
      footer={
        <DetailActions
          entry={entry}
          os={os}
          flashUrl={flashUrl}
          flashKill={flashKill}
          onOpenUrl={onOpenUrl}
          onCopy={onCopy}
          onKillAsk={onKillAsk}
        />
      }
    >
      <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-2.5">
        <Field label={t("端口")} value={String(entry.port)} mono />
        <Field label={t("监听地址")} value={entry.addr} mono />
        <Field label={t("暴露面")} value={entry.exposure === "exposed" ? t("局域网") : t("仅本机")} />
        <Field label={t("用途")} value={portPurpose(entry.port)} />
        <Field label={t("进程")} value={entry.process || null} />
        <Field label={t("PID")} value={entry.pid != null ? String(entry.pid) : null} mono />
        <Field label={t("PPID")} value={entry.ppid != null ? String(entry.ppid) : null} mono />
        <Field label={t("仓库")} value={ws ?? entry.gitRoot} mono />
        <Field label={t("会话归因")} value={owner ? owner.title || owner.profileId : null} />
        <Field label={t("新鲜度")} value={isNew ? t("新出现") : null} />
      </dl>
      <div className="mt-3 min-w-0">
        <dt className="text-[0.625rem] text-(--tmd-fg-faint)">{t("命令行")}</dt>
        <dd className="break-all font-mono text-[0.6875rem] text-(--tmd-fg-muted)">{entry.args || "—"}</dd>
      </div>
      <div className="mt-1.5 min-w-0">
        <dt className="text-[0.625rem] text-(--tmd-fg-faint)">{t("工作目录")}</dt>
        <dd className="break-all font-mono text-[0.6875rem] text-(--tmd-fg-muted)">{entry.cwd || "—"}</dd>
      </div>
      <div className="mt-1.5 min-w-0">
        <dt className="text-[0.625rem] text-(--tmd-fg-faint)">{t("终止命令")}</dt>
        <dd className="break-all font-mono text-[0.6875rem] text-(--tmd-fg-muted)">{killCmd}</dd>
      </div>
    </DialogShell>
  );
}
