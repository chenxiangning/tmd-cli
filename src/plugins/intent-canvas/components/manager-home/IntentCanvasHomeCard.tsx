import { t } from "@kernel/i18n";
import { Copy, Link, Trash } from "@phosphor-icons/react";

import { cn } from "../../utils/cn";
import { ConfirmBubble } from "../ConfirmBubble";
import type { IntentCanvasIndexEntry } from "../../types";
import { formatRelativeCanvasTime } from "../../utils/relativeTime";
import type { CanvasStaleBadge } from "../../utils/staleSignals";

export type IntentCanvasCardAction = "open" | "duplicate" | "delete";

export type IntentCanvasCardActionPrompt = {
  action: IntentCanvasCardAction;
  entry: IntentCanvasIndexEntry;
};

export type IntentCanvasHomeCardProps = {
  entry: IntentCanvasIndexEntry;
  isSelected: boolean;
  isStaleEra: boolean;
  staleBadge: CanvasStaleBadge | null;
  now: Date;
  actionPrompt: IntentCanvasCardActionPrompt | null;
  isConfirming: boolean;
  onToggleSelection: (canvasId: string) => void;
  onActionRequest: (entry: IntentCanvasIndexEntry, action: IntentCanvasCardAction) => void;
  onConfirmAction: () => void;
  onCancelAction: () => void;
};

/** 卡片动作文案(中文源串即 key;确认/提示按动作查表,替代 mossx 动态拼接键)。 */
const ACTION_TEXT: Record<"open" | "duplicate" | "delete", { label: string; confirm: string; hint: string }> = {
  open: {
    label: "打开",
    confirm: "打开画布「{title}」?当前列表会切换到编辑器。",
    hint: "若当前有未保存的编辑器内容,请先保存后再打开其他画布。",
  },
  duplicate: {
    label: "复制",
    confirm: "复制画布「{title}」?系统会创建一个新的画布副本。",
    hint: "副本会按工作区写入 ~/.tmd-cli/intent-canvas 目录。",
  },
  delete: {
    label: "删除",
    confirm: "删除画布「{title}」?文件会被移到废纸篓。",
    hint: "此操作不会删除会话消息,只移除意图画布存储里的画布文件。",
  },
};

const MODE_LABEL_KEYS = {
  architect: "Architect",
  spotlight: "Spotlight",
  file: "File",
} as const;

function PlaceholderThumbnail() {
  return (
    <svg
      className="intent-canvas-thumb-placeholder"
      viewBox="0 0 280 88"
      preserveAspectRatio="xMidYMid slice"
      aria-hidden
    >
      <g fill="none" stroke="currentColor" strokeWidth="1" strokeDasharray="3 3">
        <circle cx="140" cy="44" r="6" />
        <circle cx="85" cy="28" r="4" />
        <circle cx="195" cy="60" r="4" />
      </g>
    </svg>
  );
}

export function IntentCanvasHomeCard({
  entry,
  isSelected,
  isStaleEra,
  staleBadge,
  now,
  actionPrompt,
  isConfirming,
  onToggleSelection,
  onActionRequest,
  onConfirmAction,
  onCancelAction,
}: IntentCanvasHomeCardProps) {
    const isActionPromptOpen = actionPrompt?.entry.id === entry.id;

  const staleBadgeText = staleBadge
    ? staleBadge.kind === "anchors-broken"
      ? t("锚点失效")
      : staleBadge.kind === "empty-graph"
        ? t("空图")
        : t("{days} 天未动", { days: staleBadge.days })
    : null;

  return (
    <article
      className={cn("intent-canvas-home-card", isSelected && "is-selected")}
      role="listitem"
    >
      <button
        type="button"
        className="intent-canvas-home-card-open"
        onClick={() => onActionRequest(entry, "open")}
      >
        <span className="intent-canvas-thumb">
          {entry.thumbnailSvg ? (
            /* data-URI img:SVG 以图片语义渲染(脚本/事件属性不执行),即便索引被
               进程级写入方污染也不落 webview 执行面。 */
            <img
              className="intent-canvas-thumb-svg"
              alt=""
              src={`data:image/svg+xml;utf8,${encodeURIComponent(entry.thumbnailSvg)}`}
            />
          ) : (
            <PlaceholderThumbnail />
          )}
        </span>
        <span className="intent-canvas-home-card-body">
          <h3>
            {entry.title}
            {isStaleEra && staleBadgeText ? (
              <span className="intent-canvas-stale-tag">{staleBadgeText}</span>
            ) : null}
          </h3>
          <p>{entry.summary || t("暂无摘要。")}</p>
        </span>
        <span className="intent-canvas-home-card-foot">
          <span className={cn("intent-canvas-mode-badge", `is-${entry.mode}`)}>
            {t(MODE_LABEL_KEYS[entry.mode])}
          </span>
          <span className="intent-canvas-stat-inline">
            <b>{entry.elementCount}</b>·<b>{entry.linkedFileCount}</b>·<b>{entry.linkedProjectMapNodeCount}</b>
          </span>
          <span className="intent-canvas-foot-spacer" />
          <span className="intent-canvas-time">
            {formatRelativeCanvasTime(entry.updatedAt, now, t)}
          </span>
        </span>
      </button>
      <label className="intent-canvas-home-card-selection">
        <input
          type="checkbox"
          checked={isSelected}
          onChange={() => onToggleSelection(entry.id)}
          aria-label={t("选择画布「{title}」", { title: entry.title })}
        />
      </label>
      <div className="intent-canvas-card-actions">
        <button
          type="button"
          onClick={() => onActionRequest(entry, "duplicate")}
          aria-label={t("复制")}
          title={t("复制")}
        >
          <Copy aria-hidden />
        </button>
        <button
          type="button"
          onClick={() => onActionRequest(entry, "open")}
          aria-label={t("打开")}
          title={t("打开")}
        >
          <Link aria-hidden />
        </button>
        <button
          type="button"
          className="is-danger"
          onClick={() => onActionRequest(entry, "delete")}
          aria-label={t("删除")}
          title={t("删除")}
        >
          <Trash aria-hidden />
        </button>
      </div>
      {isActionPromptOpen && actionPrompt ? (
        <div className="intent-canvas-action-popover-shell">
          <ConfirmBubble
            threadName={entry.title}
            title={t(ACTION_TEXT[actionPrompt.action].label)}
            message={t(ACTION_TEXT[actionPrompt.action].confirm, { title: entry.title })}
            hint={t(ACTION_TEXT[actionPrompt.action].hint)}
            confirmLabel={t(ACTION_TEXT[actionPrompt.action].label)}
            isDeleting={isConfirming}
            onCancel={onCancelAction}
            onConfirm={onConfirmAction}
          />
        </div>
      ) : null}
    </article>
  );
}
