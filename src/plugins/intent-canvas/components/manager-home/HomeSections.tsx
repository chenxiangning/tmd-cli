/**
 * 意图画布管理首页拆出的区块组件(复杂度/文件规模闸):
 * BulkToolbar 批量操作条 / HomeActions 头部动作区 / EraSection 分组卡片区。
 */

import { ArrowClockwise, ListChecks, Palette, Plus, Square, Trash } from "@phosphor-icons/react";
import { t } from "@kernel/i18n";
import { Spinner } from "@kernel/Spinner";
import { useMinSpin } from "@kernel/useMinSpin";
import { cn } from "../../utils/cn";
import { ConfirmBubble } from "../ConfirmBubble";
import { IntentCanvasHomeCard } from "./IntentCanvasHomeCard";
import type { IntentCanvasCardActionPrompt } from "./IntentCanvasHomeCard";
import type { CanvasEra } from "../../utils/eraGrouping";
import { deriveCanvasStaleBadge, type CanvasAnchorHealth } from "../../utils/staleSignals";
import type { IntentCanvasHomeProps, IntentCanvasHomeStatus } from "./IntentCanvasHome";

function formatEraLabel(era: CanvasEra, now: Date, t: (key: string) => string): string {
  if (era.kind === "week") {
    return t("本周");
  }
  if (era.kind === "stale") {
    return t("更早");
  }
  const monthDate = new Date(era.year ?? now.getFullYear(), (era.month ?? 1) - 1, 1);
  const crossYear = monthDate.getFullYear() !== now.getFullYear();
  return (crossYear ? ERA_MONTH_CROSS_YEAR_FORMATTER : ERA_MONTH_FORMATTER).format(monthDate);
}

const ERA_MONTH_FORMATTER = new Intl.DateTimeFormat(undefined, { month: "long" });
const ERA_MONTH_CROSS_YEAR_FORMATTER = new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric" as const });

/** 批量操作条:选中 ≥1 张时浮现,含删除确认气泡。从 Home 拆出(复杂度闸)。 */
export function BulkToolbar(props: {
  selectedCount: number;
  isBulkDeleting: boolean;
  isBulkDeletePromptOpen: boolean;
  onClearSelection: () => void;
  onBulkDeleteRequest: () => void;
  onBulkDeleteConfirm: () => void;
  onBulkDeleteCancel: () => void;
}) {
  if (props.selectedCount === 0) {
    return null;
  }
  return (
    <div className="intent-canvas-bulk-toolbar" role="status">
      <span>{t("已选择 {count} 个画布", { count: props.selectedCount })}</span>
      <div className="intent-canvas-bulk-actions">
        <button type="button" onClick={props.onClearSelection} disabled={props.isBulkDeleting}>
          {t("取消选择")}
        </button>
        <button
          type="button"
          className="is-danger"
          onClick={props.onBulkDeleteRequest}
          disabled={props.isBulkDeleting}
        >
          <Trash aria-hidden />
          {t("删除已选 {count} 个", { count: props.selectedCount })}
        </button>
      </div>
      {props.isBulkDeletePromptOpen ? (
        <div className="intent-canvas-action-popover-shell is-bulk">
          <ConfirmBubble
            title={t("批量删除")}
            message={t("删除已选 {count} 个画布?文件会被移到废纸篓。", { count: props.selectedCount })}
            hint={t("此操作不会删除会话消息,只批量移除意图画布存储里的画布文件。")}
            confirmLabel={t("删除已选 {count} 个", { count: props.selectedCount })}
            isDeleting={props.isBulkDeleting}
            onCancel={props.onBulkDeleteCancel}
            onConfirm={props.onBulkDeleteConfirm}
          />
        </div>
      ) : null}
    </div>
  );
}

/** 头部动作区:全选/刷新/AI 作画总闸/新建。从 Home 拆出(复杂度闸)。 */
export function HomeActions(props: {
  status: IntentCanvasHomeStatus;
  filteredCount: number;
  allSelected: boolean;
  aiDrawEnabled: boolean;
  onToggleSelectAll: () => void;
  onRefresh: () => void;
  onToggleAiDraw: () => void;
  onCreateCanvas: () => void;
}) {
  const { spinning, spin } = useMinSpin();
  return (
    <div className="intent-canvas-manager-actions">
                  <button
            type="button"
            className="is-icon"
            onClick={props.onToggleSelectAll}
            disabled={props.filteredCount === 0 || props.status === "loading"}
            aria-label={
              props.allSelected
                ? t("取消选择")
                : t("全选")
            }
            title={
              props.allSelected
                ? t("取消选择")
                : t("全选")
            }
          >
            {props.allSelected ? <Square aria-hidden /> : <ListChecks aria-hidden />}
          </button>
          <button
            type="button"
            className="is-icon"
            onClick={() => spin(props.onRefresh)}
            disabled={props.status === "loading"}
            aria-label={t("刷新")}
            title={t("刷新")}
          >
            {props.status === "loading" || spinning ? (
              <Spinner size="0.875rem" />
            ) : (
              <ArrowClockwise aria-hidden />
            )}
          </button>
          <button
            type="button"
            className={cn("is-icon intent-canvas-ai-draw-toggle", props.aiDrawEnabled && "is-active")}
            onClick={props.onToggleAiDraw}
            aria-pressed={props.aiDrawEnabled}
            aria-label={props.aiDrawEnabled ? t("AI 作画:开") : t("AI 作画:关")}
            title={
              props.aiDrawEnabled
                ? t("AI 作画:开(发送消息自动附带画图指令,AI 画完自动上画布)")
                : t("AI 作画:关")
            }
          >
            <Palette aria-hidden />
          </button>
          <button type="button" className="is-primary" onClick={props.onCreateCanvas}>
            <Plus aria-hidden />
            {t("新建画布")}
          </button>
    </div>
  );
}

/** 分组卡片区:按更新时段(本周/近月/陈年)分区渲染画布卡。从 Home 拆出(复杂度闸)。 */
export function EraSection(props: {
  era: CanvasEra;
  eraIndex: number;
  now: Date;
  selectedCanvasIds: ReadonlySet<string>;
  anchorHealthByCanvasId: Record<string, CanvasAnchorHealth>;
  actionPrompt: IntentCanvasCardActionPrompt | null;
  confirmingCanvasActionId: string | null;
  onSelectEra: (era: CanvasEra) => void;
  onToggleCanvasSelection: (canvasId: string) => void;
  onCanvasActionRequest: IntentCanvasHomeProps["onCanvasActionRequest"];
  onConfirmCanvasAction: IntentCanvasHomeProps["onConfirmCanvasAction"];
  onCancelCanvasAction: IntentCanvasHomeProps["onCancelCanvasAction"];
}) {
  const { era, eraIndex, now } = props;
  const isStaleEra = era.kind === "stale";
  return (
    <section
      className={cn("intent-canvas-era", isStaleEra && "is-stale", eraIndex === 0 && "is-latest")}
    >
      <div className="intent-canvas-era-rail">
        <h3>{formatEraLabel(era, now, t)}</h3>
        <span className="intent-canvas-era-agg">
          {isStaleEra
            ? t("{count} 张 · {days} 天未动", { count: era.canvasCount, days: era.maxStaleDays })
            : t("{count} 张 · {elements} 元素", { count: era.canvasCount, elements: era.elementSum })}
        </span>
        {isStaleEra ? (
          <>
            <span className="intent-canvas-era-cleanup">⚠ {t("建议清理")}</span>
            <button type="button" className="intent-canvas-era-select" onClick={() => props.onSelectEra(era)}>
              {t("全选本组")}
            </button>
          </>
        ) : null}
      </div>
      <ul className="intent-canvas-era-deck">
        {era.entries.map((entry) => (
          <li key={entry.id} className="intent-canvas-era-item">
            <IntentCanvasHomeCard
              entry={entry}
              isSelected={props.selectedCanvasIds.has(entry.id)}
              isStaleEra={isStaleEra}
              staleBadge={
                isStaleEra
                  ? deriveCanvasStaleBadge({
                      entry,
                      anchorHealth: props.anchorHealthByCanvasId[entry.id] ?? "unknown",
                      now,
                    })
                  : null
              }
              now={now}
              actionPrompt={props.actionPrompt}
              isConfirming={props.confirmingCanvasActionId === entry.id}
              onToggleSelection={props.onToggleCanvasSelection}
              onActionRequest={props.onCanvasActionRequest}
              onConfirmAction={props.onConfirmCanvasAction}
              onCancelAction={props.onCancelCanvasAction}
            />
          </li>
        ))}
      </ul>
    </section>
  );
}
