import { t } from "@kernel/i18n";
import { CircleNotch, FileText, MagnifyingGlass, Plus } from "@phosphor-icons/react";

import { BulkToolbar, EraSection, HomeActions } from "./HomeSections";
import type { CanvasAnchorHealth } from "../../utils/staleSignals";
import { openIntentCanvasBacklink } from "../../activeDocumentBridge";
import type { IntentCanvasIndexEntry } from "../../types";
import type { CanvasEra } from "../../utils/eraGrouping";

import type {
  IntentCanvasCardActionPrompt,
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
          <HomeActions
            status={status}
            filteredCount={filteredEntries.length}
            allSelected={allFilteredEntriesSelected}
            aiDrawEnabled={props.aiDrawEnabled}
            onToggleSelectAll={props.onToggleSelectAll}
            onRefresh={props.onRefresh}
            onToggleAiDraw={props.onToggleAiDraw}
            onCreateCanvas={props.onCreateCanvas}
          />
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
      <BulkToolbar
        selectedCount={selectedCount}
        isBulkDeleting={isBulkDeleting}
        isBulkDeletePromptOpen={isBulkDeletePromptOpen}
        onClearSelection={props.onClearSelection}
        onBulkDeleteRequest={props.onBulkDeleteRequest}
        onBulkDeleteConfirm={props.onBulkDeleteConfirm}
        onBulkDeleteCancel={props.onBulkDeleteCancel}
      />

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
          {eras.map((era, eraIndex) => (
            <EraSection
              key={era.id}
              era={era}
              eraIndex={eraIndex}
              now={now}
              selectedCanvasIds={selectedCanvasIds}
              anchorHealthByCanvasId={anchorHealthByCanvasId}
              actionPrompt={actionPrompt}
              confirmingCanvasActionId={confirmingCanvasActionId}
              onSelectEra={props.onSelectEra}
              onToggleCanvasSelection={props.onToggleCanvasSelection}
              onCanvasActionRequest={props.onCanvasActionRequest}
              onConfirmCanvasAction={props.onConfirmCanvasAction}
              onCancelCanvasAction={props.onCancelCanvasAction}
            />
          ))}
        </div>
      )}
    </>
  );
}



