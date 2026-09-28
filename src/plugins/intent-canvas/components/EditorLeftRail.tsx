/**
 * 意图画布 · 编辑器左栏:画布信息(标题/摘要)+ 结构化关联(文件/节点/会话)。
 * 渲染结构移植自 mossx IntentCanvasEditor 左 aside。
 */

import { ArrowLeft } from "@phosphor-icons/react";
import { cn } from "../utils/cn";
import { t } from "@kernel/i18n";

export type EditorLeftRailProps = {
  collapsed: boolean;
  onToggleCollapsed: () => void;
  title: string;
  summary: string;
  fileLinksText: string;
  nodeLinksText: string;
  threadLinksText: string;
  activeThreadId: string | null;
  onTitleChange: (value: string) => void;
  onSummaryChange: (value: string) => void;
  onFileLinksChange: (value: string) => void;
  onNodeLinksChange: (value: string) => void;
  onThreadLinksChange: (value: string) => void;
};

export function EditorLeftRail(props: EditorLeftRailProps) {
  const { collapsed } = props;
  return (
    <aside className={cn("intent-canvas-rail is-left", collapsed && "is-collapsed")}>
      <div className="intent-canvas-rail-header">
        <span>{t("画布信息")}</span>
        <button
          type="button"
          className="intent-canvas-rail-toggle"
          onClick={props.onToggleCollapsed}
          aria-label={collapsed ? t("展开左侧面板") : t("折叠左侧面板")}
          title={collapsed ? t("展开左侧面板") : t("折叠左侧面板")}
        >
          <ArrowLeft aria-hidden className={collapsed ? "is-flipped" : undefined} />
          <span>{collapsed ? t("展开左侧面板") : t("折叠左侧面板")}</span>
        </button>
      </div>
      {!collapsed ? (
        <>
          <section className="intent-canvas-card">
            <h3>{t("画布信息")}</h3>
            <label>
              <span>{t("标题")}</span>
              <input
                value={props.title}
                onChange={(event) => props.onTitleChange(event.currentTarget.value)}
              />
            </label>
            <label>
              <span>{t("意图摘要")}</span>
              <textarea
                value={props.summary}
                rows={5}
                placeholder={t("这张图想说明什么?有哪些边界、假设和关键问题?")}
                onChange={(event) => props.onSummaryChange(event.currentTarget.value)}
              />
            </label>
          </section>
          <section className="intent-canvas-card">
            <h3>{t("结构化关联")}</h3>
            <label>
              <span>{t("关联文件")}</span>
              <textarea
                value={props.fileLinksText}
                rows={4}
                placeholder="src/services/order.ts"
                onChange={(event) => props.onFileLinksChange(event.currentTarget.value)}
              />
            </label>
            <label>
              <span>{t("关联 Project Map 节点")}</span>
              <textarea
                value={props.nodeLinksText}
                rows={3}
                placeholder="project-map-node-id"
                onChange={(event) => props.onNodeLinksChange(event.currentTarget.value)}
              />
            </label>
            <label>
              <span>{t("关联会话")}</span>
              <textarea
                value={props.threadLinksText}
                rows={3}
                placeholder={props.activeThreadId ?? "thread-id"}
                onChange={(event) => props.onThreadLinksChange(event.currentTarget.value)}
              />
            </label>
          </section>
        </>
      ) : null}
    </aside>
  );
}
