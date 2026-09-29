/**
 * 意图画布 · 编辑器右栏:AI Context 指标 + 来源追溯(回链/过期/失联)+
 * Context Preview。渲染结构移植自 mossx IntentCanvasEditor 右 aside。
 */

import { ArrowLeft, CircleNotch, FileMagnifyingGlass, FileText, Warning } from "@phosphor-icons/react";
import { t } from "@kernel/i18n";
import { cn } from "../utils/cn";
import type {
  IntentCanvasEvidenceBacklink,
  IntentCanvasSourceBacklink,
  IntentCanvasSourceLocation,
  IntentCanvasTraceabilityProjection,
  RelationshipSourceRuntimeState,
} from "../utils/traceability";

export type EditorRightRailProps = {
  collapsed: boolean;
  onToggleCollapsed: () => void;
  elementCount: number;
  fileCount: number;
  nodeCount: number;
  traceability: IntentCanvasTraceabilityProjection;
  sourceState: RelationshipSourceRuntimeState;
  transmissionContextJson: string;
  errorText: string | null;
  onOpenBacklink: (
    backlink: IntentCanvasSourceBacklink | IntentCanvasEvidenceBacklink,
  ) => void;
  onOpenSourceFile?: (path: string, location?: IntentCanvasSourceLocation) => void;
};

export function EditorRightRail(props: EditorRightRailProps) {
  const { collapsed, traceability, sourceState } = props;
  return (
    <aside className={cn("intent-canvas-rail is-right", collapsed && "is-collapsed")}>
      <div className="intent-canvas-rail-header">
        <span>{t("AI Context")}</span>
        <button
          type="button"
          className="intent-canvas-rail-toggle"
          onClick={props.onToggleCollapsed}
          aria-label={collapsed ? t("展开右侧面板") : t("折叠右侧面板")}
          title={collapsed ? t("展开右侧面板") : t("折叠右侧面板")}
        >
          <ArrowLeftShared collapsed={collapsed} />
          <span>{collapsed ? t("展开右侧面板") : t("折叠右侧面板")}</span>
        </button>
      </div>
      {!collapsed ? (
        <>
          <section className="intent-canvas-card is-accent">
            <h3>{t("AI Context")}</h3>
            <p>{t("发送给会话的是结构化摘要和 JSON snapshot,不是截图。")}</p>
            <dl className="intent-canvas-metrics">
              <div>
                <dt>{t("元素")}</dt>
                <dd>{props.elementCount}</dd>
              </div>
              <div>
                <dt>{t("文件")}</dt>
                <dd>{props.fileCount}</dd>
              </div>
              <div>
                <dt>{t("节点")}</dt>
                <dd>{props.nodeCount}</dd>
              </div>
            </dl>
          </section>
          <SourceTraceCard
            traceability={traceability}
            sourceState={sourceState}
            onOpenBacklink={props.onOpenBacklink}
            onOpenSourceFile={props.onOpenSourceFile}
          />
          <section className="intent-canvas-card">
            <h3>{t("Context Preview")}</h3>
            <pre>{props.transmissionContextJson}</pre>
          </section>
          {props.errorText ? (
            <p className="intent-canvas-error" role="alert">{props.errorText}</p>
          ) : null}
        </>
      ) : null}
    </aside>
  );
}

/** 右栏折叠箭头方向与左栏镜像(mossx is-flipped 语义)。 */
function ArrowLeftShared({ collapsed }: { collapsed: boolean }) {
  return <ArrowLeft aria-hidden className={collapsed ? undefined : "is-flipped"} />;
}

/** 来源追溯卡:tmd-cli 无 project-map 扫描器,常态为空;导入图存在时展示
 *  健康/过期/失联指标与三类回链列表。从 EditorRightRail 拆出(复杂度闸)。 */
function SourceTraceCard(props: {
  traceability: EditorRightRailProps["traceability"];
  sourceState: EditorRightRailProps["sourceState"];
  onOpenBacklink: EditorRightRailProps["onOpenBacklink"];
  onOpenSourceFile?: EditorRightRailProps["onOpenSourceFile"];
}) {
  const { traceability, sourceState } = props;
  return (
            <section className="intent-canvas-card intent-canvas-source-trace-card">
              <h3>{t("来源追溯")}</h3>
              <p>{t("导入的代码关系图会保留 source anchor、evidence ref 和刷新状态;这些信息与手动画布内容分离。")}</p>
              <dl className="intent-canvas-metrics intent-canvas-source-health">
                <div>
                  <dt>{t("导入图")}</dt>
                  <dd>{traceability.importedGraphCount}</dd>
                </div>
                <div className={traceability.staleGraphCount > 0 ? "is-warning" : undefined}>
                  <dt>{t("过期")}</dt>
                  <dd>{traceability.staleGraphCount}</dd>
                </div>
                <div className={traceability.unresolvedAnchorCount > 0 ? "is-warning" : undefined}>
                  <dt>{t("失联")}</dt>
                  <dd>{traceability.unresolvedAnchorCount}</dd>
                </div>
              </dl>
              {sourceState.status === "loading" ? (
                <p className="intent-canvas-source-notice">
                  <CircleNotch aria-hidden className="is-spinning" />
                  {t("正在检查最新关系快照。")}
                </p>
              ) : null}
              {sourceState.status === "error" ? (
                <p className="intent-canvas-source-notice is-warning">
                  <Warning aria-hidden />
                  {t("来源检查失败:{message}", { message: sourceState.error })}
                </p>
              ) : null}
              {sourceState.status === "ready" && !sourceState.value.exists ? (
                <p className="intent-canvas-source-notice is-warning">
                  <Warning aria-hidden />
                  {t("当前没有可用的关系快照;画布内容会继续保留并可编辑。")}
                </p>
              ) : null}
              {traceability.staleGraphCount > 0 ? (
                <p className="intent-canvas-source-notice is-warning">
                  <Warning aria-hidden />
                  {t("{count} 个导入图来自旧扫描。", { count: traceability.staleGraphCount })}
                </p>
              ) : null}
              {traceability.unresolvedAnchorCount > 0 ? (
                <p className="intent-canvas-source-notice is-warning">
                  <Warning aria-hidden />
                  {t("{count} 个来源锚点已无法在最新关系快照中解析。", {
                    count: traceability.unresolvedAnchorCount,
                  })}
                </p>
              ) : null}
              {traceability.codeSelectionBacklinks.length > 0 ? (
                <div className="intent-canvas-source-list">
                  <strong>{t("代码选区")}</strong>
                  {traceability.codeSelectionBacklinks.slice(0, 4).map((source) => (
                    <button
                      key={source.id}
                      type="button"
                      className="intent-canvas-source-action"
                      onClick={() => props.onOpenBacklink(source)}
                      disabled={!props.onOpenSourceFile}
                      aria-label={t("打开 {path}:{line}", {
                        path: source.path,
                        line: source.location?.line ?? 1,
                      })}
                      title={source.path}
                    >
                      <FileText aria-hidden />
                      <span>{source.label}</span>
                      <small>{source.detail}</small>
                    </button>
                  ))}
                </div>
              ) : null}
              {traceability.sourceBacklinks.length > 0 ? (
                <div className="intent-canvas-source-list">
                  <strong>{t("来源文件")}</strong>
                  {traceability.sourceBacklinks.slice(0, 6).map((source) => (
                    <button
                      key={source.id}
                      type="button"
                      className={cn("intent-canvas-source-action", source.unresolved && "is-unresolved")}
                      onClick={() => props.onOpenBacklink(source)}
                      disabled={!props.onOpenSourceFile || source.unresolved}
                      aria-label={
                        source.location
                          ? t("打开 {path}:{line}", { path: source.path, line: source.location.line })
                          : t("打开 {path}", { path: source.path })
                      }
                      title={source.unresolved ? t("该来源锚点已无法解析。") : source.detail}
                    >
                      <FileText aria-hidden />
                      <span>{source.label}</span>
                      <small>{source.detail}</small>
                    </button>
                  ))}
                </div>
              ) : null}
              {traceability.evidenceBacklinks.length > 0 ? (
                <div className="intent-canvas-source-list">
                  <strong>{t("证据 Evidence")}</strong>
                  {traceability.evidenceBacklinks.slice(0, 6).map((evidence) => (
                    <button
                      key={evidence.id}
                      type="button"
                      className={cn("intent-canvas-source-action", evidence.unresolved && "is-unresolved")}
                      onClick={() => props.onOpenBacklink(evidence)}
                      disabled={!props.onOpenSourceFile || !evidence.path || evidence.unresolved}
                      aria-label={t("查看 {label} 的 evidence", { label: evidence.label })}
                      title={
                        evidence.path && !evidence.unresolved
                          ? evidence.detail
                          : t("这条 evidence ref 没有可打开的文件来源。")
                      }
                    >
                      <FileMagnifyingGlass aria-hidden />
                      <span>{evidence.label}</span>
                      <small>{evidence.detail}</small>
                    </button>
                  ))}
                </div>
              ) : null}
    </section>
  );
}
