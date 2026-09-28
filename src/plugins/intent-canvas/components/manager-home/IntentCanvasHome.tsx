import { t } from "@kernel/i18n";
import { ArrowClockwise, CircleNotch, FileText, GitBranch, ListChecks, MagnifyingGlass, Palette, Plus, Square, Trash } from "@phosphor-icons/react";

import { cn } from "../../utils/cn";
import { openIntentCanvasBacklink } from "../../activeDocumentBridge";
import { ConfirmBubble } from "../ConfirmBubble";
import type { IntentCanvasIndexEntry } from "../../types";
import type { CanvasEra } from "../../utils/eraGrouping";
import { deriveCanvasStaleBadge, type CanvasAnchorHealth } from "../../utils/staleSignals";
import {
  IntentCanvasHomeCard,
  type IntentCanvasCardActionPrompt,
} from "./IntentCanvasHomeCard";

export type IntentCanvasHomeStatus = "idle" | "loading" | "ready" | "error";

export type IntentCanvasHomeProps = {
  status: IntentCanvasHomeStatus;
  filteredEntries: IntentCanvasIndexEntry[];
  eras: CanvasEra[];
  now: Date;
  warnings: string[];
  errorMessage: string | null;
  aiDrawNotice: { id: string; title: string }[] | null;
  aiDrawError: string | null;
  aiDrawEnabled: boolean;
  onToggleAiDraw: () => void;
  searchQuery: string;
  anchorHealthByCanvasId: Record<string, CanvasAnchorHealth>;
  selectedCanvasIds: ReadonlySet<string>;
  selectedCount: number;
  allFilteredEntriesSelected: boolean;
  isBulkDeletePromptOpen: boolean;
  isBulkDeleting: boolean;
  actionPrompt: IntentCanvasCardActionPrompt | null;
  confirmingCanvasActionId: string | null;
  onSearchQueryChange: (value: string) => void;
  onToggleSelectAll: () => void;
  onRefresh: () => void;
  onOpenProjectMap?: () => void;
  onCreateCanvas: () => void;
  onToggleCanvasSelection: (canvasId: string) => void;
  onSelectEra: (era: CanvasEra) => void;
  onClearSelection: () => void;
  onBulkDeleteRequest: () => void;
  onBulkDeleteConfirm: () => void;
  onBulkDeleteCancel: () => void;
  onCanvasActionRequest: (
    entry: IntentCanvasIndexEntry,
    action: IntentCanvasCardActionPrompt["action"],
  ) => void;
  onConfirmCanvasAction: () => void;
  onCancelCanvasAction: () => void;
};

/* Intl formatter 模块级复用(era 分组头渲染热路径)。 */
const ERA_MONTH_FORMATTER = new Intl.DateTimeFormat(undefined, { month: "long" });
const ERA_MONTH_CROSS_YEAR_FORMATTER = new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric" as const });

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

export function IntentCanvasHome(props: IntentCanvasHomeProps) {
    const {
    status,
    filteredEntries,
    eras,
    now,
    warnings,
    errorMessage,
    searchQuery,
    anchorHealthByCanvasId,
    selectedCanvasIds,
    selectedCount,
    allFilteredEntriesSelected,
    isBulkDeletePromptOpen,
    isBulkDeleting,
    actionPrompt,
    confirmingCanvasActionId,
  } = props;

  return (
    <>
      <header className="intent-canvas-manager-hero">
        <div className="intent-canvas-manager-identity">
          <h2>{t("意图画布")}</h2>
          <p>{t("{count} 个画布 · 按更新时间", { count: filteredEntries.length })}</p>
        </div>
        <label className="intent-canvas-search">
          <MagnifyingGlass aria-hidden />
          <input
            value={searchQuery}
            placeholder={t("搜索标题、摘要或文件路径...")}
            onChange={(event) => props.onSearchQueryChange(event.currentTarget.value)}
          />
        </label>
        <div className="intent-canvas-manager-actions">
          <button
            type="button"
            className="is-icon"
            onClick={props.onToggleSelectAll}
            disabled={filteredEntries.length === 0 || status === "loading"}
            aria-label={
              allFilteredEntriesSelected
                ? t("取消选择")
                : t("全选")
            }
            title={
              allFilteredEntriesSelected
                ? t("取消选择")
                : t("全选")
            }
          >
            {allFilteredEntriesSelected ? <Square aria-hidden /> : <ListChecks aria-hidden />}
          </button>
          <button
            type="button"
            className="is-icon"
            onClick={props.onRefresh}
            disabled={status === "loading"}
            aria-label={t("刷新")}
            title={t("刷新")}
          >
            <ArrowClockwise aria-hidden className={status === "loading" ? "is-spinning" : undefined} />
          </button>
          {props.onOpenProjectMap ? (
            <button
              type="button"
              className="is-icon"
              onClick={props.onOpenProjectMap}
              aria-label={t("项目知识地图")}
              title={t("项目知识地图")}
            >
              <GitBranch aria-hidden />
            </button>
          ) : null}
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
      </header>

      {warnings.map((warning) => (
        <p key={warning} className="intent-canvas-warning" role="status">{warning}</p>
      ))}
      {props.aiDrawError ? (
        <p className="intent-canvas-error" role="alert">{props.aiDrawError}</p>
      ) : props.aiDrawNotice && props.aiDrawNotice.length > 0 ? (
        <p className="intent-canvas-ai-draw-notice" role="status">
          {t("AI 作画已上画布:")}
          {props.aiDrawNotice.map((canvas) => (
            <button
              key={canvas.id}
              type="button"
              className="intent-canvas-ai-draw-notice-link"
              onClick={() => openIntentCanvasBacklink(canvas.id)}
              title={t("打开画布「{title}」", { title: canvas.title })}
            >
              {canvas.title}
            </button>
          ))}
        </p>
      ) : null}
      {errorMessage ? <p className="intent-canvas-error" role="alert">{errorMessage}</p> : null}
      {selectedCount > 0 ? (
        <div className="intent-canvas-bulk-toolbar" role="status">
          <span>{t("已选择 {count} 个画布", { count: selectedCount })}</span>
          <div className="intent-canvas-bulk-actions">
            <button type="button" onClick={props.onClearSelection} disabled={isBulkDeleting}>
              {t("取消选择")}
            </button>
            <button
              type="button"
              className="is-danger"
              onClick={props.onBulkDeleteRequest}
              disabled={isBulkDeleting}
            >
              <Trash aria-hidden />
              {t("删除已选 {count} 个", { count: selectedCount })}
            </button>
          </div>
          {isBulkDeletePromptOpen ? (
            <div className="intent-canvas-action-popover-shell is-bulk">
              <ConfirmBubble
                threadName={t("已选择 {count} 个画布", { count: selectedCount })}
                title={t("批量删除")}
                message={t("删除已选 {count} 个画布?文件会被移到废纸篓。", { count: selectedCount })}
                hint={t("此操作不会删除会话消息,只批量移除意图画布存储里的画布文件。")}
                confirmLabel={t("删除已选 {count} 个", { count: selectedCount })}
                isDeleting={isBulkDeleting}
                onCancel={props.onBulkDeleteCancel}
                onConfirm={props.onBulkDeleteConfirm}
              />
            </div>
          ) : null}
        </div>
      ) : null}

      {status === "loading" && filteredEntries.length === 0 ? (
        <div className="intent-canvas-loading">
          <CircleNotch aria-hidden className="is-spinning" /> {t("正在加载画布...")}
        </div>
      ) : filteredEntries.length === 0 ? (
        <div className="intent-canvas-empty-state">
          <FileText aria-hidden />
          <h3>{t("还没有画布")}</h3>
          <p>{t("创建第一张图,把你的业务意图、模块关系和问题上下文画出来。")}</p>
          <button type="button" className="is-primary" onClick={props.onCreateCanvas}>
            <Plus aria-hidden />
            {t("新建画布")}
          </button>
        </div>
      ) : (
        <div className="intent-canvas-eras">
          {eras.map((era, eraIndex) => {
            const isStaleEra = era.kind === "stale";
            return (
              <section
                key={era.id}
                className={cn("intent-canvas-era", isStaleEra && "is-stale", eraIndex === 0 && "is-latest")}
              >
                <div className="intent-canvas-era-rail">
                  <h3>{formatEraLabel(era, now, t)}</h3>
                  <span className="intent-canvas-era-agg">
                    {isStaleEra
                      ? t("{count} 张 · {days} 天未动", {
                          count: era.canvasCount,
                          days: era.maxStaleDays,
                        })
                      : t("{count} 张 · {elements} 元素", {
                          count: era.canvasCount,
                          elements: era.elementSum,
                        })}
                  </span>
                  {isStaleEra ? (
                    <>
                      <span className="intent-canvas-era-cleanup">
                        ⚠ {t("建议清理")}
                      </span>
                      <button
                        type="button"
                        className="intent-canvas-era-select"
                        onClick={() => props.onSelectEra(era)}
                      >
                        {t("全选本组")}
                      </button>
                    </>
                  ) : null}
                </div>
                <div className="intent-canvas-era-deck" role="list">
                  {era.entries.map((entry) => (
                    <IntentCanvasHomeCard
                      key={entry.id}
                      entry={entry}
                      isSelected={selectedCanvasIds.has(entry.id)}
                      isStaleEra={isStaleEra}
                      staleBadge={
                        isStaleEra
                          ? deriveCanvasStaleBadge({
                              entry,
                              anchorHealth: anchorHealthByCanvasId[entry.id] ?? "unknown",
                              now,
                            })
                          : null
                      }
                      now={now}
                      actionPrompt={actionPrompt}
                      isConfirming={confirmingCanvasActionId === entry.id}
                      onToggleSelection={props.onToggleCanvasSelection}
                      onActionRequest={props.onCanvasActionRequest}
                      onConfirmAction={props.onConfirmCanvasAction}
                      onCancelAction={props.onCancelCanvasAction}
                    />
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </>
  );
}
