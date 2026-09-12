/**
 * 渠道单行渲染 —— 见 docs/superpowers/specs/2026-09-11-cli-provider-channels-design.md。
 *
 * 列表行 = 头像 + 名称 + cc-switch 徽标 + 副文 + Switch + 编辑 + 删除(当前渠道删除禁用)。
 * 行 click = 切换该渠道(只读 props,动作从父级回传,组件纯展示 + 行为转发)。
 */

import { t } from "@kernel/i18n";
import { CloudIcon, PencilIcon, TrashIcon } from "@phosphor-icons/react";
import type { Channel } from "./types";

export function ChannelRow({
  channel,
  isCurrent,
  busy,
  isConfirmingDelete,
  onActivate,
  onEdit,
  onRequestDelete,
  onConfirmDelete,
  onCancelDelete,
}: {
  channel: Channel;
  isCurrent: boolean;
  busy: boolean;
  isConfirmingDelete: boolean;
  onActivate: () => void;
  onEdit: () => void;
  onRequestDelete: () => void;
  onConfirmDelete: () => void;
  onCancelDelete: () => void;
}) {
  const subtitle = subtitleOf(channel);
  return (
    <div
      role="button"
      tabIndex={0}
      className={`flex min-h-[3.25rem] cursor-pointer items-center gap-3 px-3 py-2.5 hover:bg-(--tmd-bg-hover) ${
        isCurrent ? "bg-(--tmd-bg-active)" : ""
      }`}
      data-testid="provider-row"
      data-current={isCurrent ? "true" : "false"}
      onClick={() => {
        if (!busy && !isCurrent) onActivate();
      }}
      onKeyDown={(e) => {
        if (e.key !== "Enter") return;
        e.preventDefault();
        if (!busy && !isCurrent) onActivate();
      }}
    >
      <div
        className="flex size-8 shrink-0 items-center justify-center rounded-md bg-(--tmd-bg-popover) text-(--tmd-fg-muted)"
        aria-hidden
      >
        <CloudIcon className="size-4" weight="fill" />
      </div>
      <div className="flex min-w-0 flex-1 flex-col">
        <p className="flex items-center gap-1.5 text-xs text-(--tmd-fg)">
          <span className="truncate">{channel.name}</span>
          {channel.source === "cc-switch" && (
            <span className="rounded bg-(--tmd-warn-bg) px-1 text-[0.625rem] text-(--tmd-warn-fg)">
              cc-switch
            </span>
          )}
        </p>
        {subtitle && (
          <p className="truncate text-[0.6875rem] text-(--tmd-fg-muted)">{subtitle}</p>
        )}
      </div>
      <label
        className="inline-flex items-center"
        onClick={(e) => e.stopPropagation()}
        data-testid="provider-row-switch"
      >
        <input
          type="checkbox"
          checked={isCurrent}
          disabled={busy}
          onChange={() => {
            if (!isCurrent) onActivate();
          }}
          className="provider-row-switch-input"
          aria-label={channel.name}
        />
      </label>
      <button
        type="button"
        aria-label={t("编辑")}
        title={t("编辑")}
        disabled={busy}
        onClick={(e) => {
          e.stopPropagation();
          onEdit();
        }}
        className="flex size-7 items-center justify-center rounded text-(--tmd-fg-muted) hover:bg-(--tmd-bg-popover) hover:text-(--tmd-fg) disabled:opacity-40"
        data-testid="provider-row-edit"
      >
        <PencilIcon className="size-3.5" aria-hidden />
      </button>
      {isConfirmingDelete ? (
        <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
          <button
            type="button"
            className="cli-cfg-btn is-danger"
            disabled={busy}
            onClick={onConfirmDelete}
            data-testid="provider-row-confirm-delete"
          >
            {t("确认删除")}
          </button>
          <button
            type="button"
            className="cli-cfg-btn"
            disabled={busy}
            onClick={onCancelDelete}
          >
            {t("取消")}
          </button>
        </div>
      ) : (
        <button
          type="button"
          aria-label={t("删除")}
          title={t("删除")}
          disabled={busy || isCurrent}
          onClick={(e) => {
            e.stopPropagation();
            onRequestDelete();
          }}
          className="flex size-7 items-center justify-center rounded text-(--tmd-fg-muted) hover:bg-(--tmd-bg-popover) hover:text-(--tmd-fg) disabled:opacity-40"
          data-testid="provider-row-delete"
        >
          <TrashIcon className="size-3.5" aria-hidden />
        </button>
      )}
    </div>
  );
}

function subtitleOf(ch: Channel): string {
  const parts: string[] = [];
  if (ch.remark) parts.push(ch.remark);
  if (ch.baseUrl) parts.push(hostOf(ch.baseUrl));
  if (ch.model) parts.push(ch.model);
  return parts.join(" · ");
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}
