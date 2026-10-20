/**
 * 工作区 caption 行(标题 + 视图切换 + 全折叠 + 插件贡献位 + 添加钮)——
 * 2026-10-20 从 workspace/index.tsx 拆出的展示组件(守 300 行铁则,零语义改动);
 * 状态与 settings 读写仍在 WorkspaceSection,本组件只收回调与现成值。
 * 视图切换:本地(缺省)/〈来源 chips〉/归档 单按钮组(来源段由
 * workspaceOrigins 注册表供给,来源插件启用才有)。
 */
import { Folders, CaretDoubleDown, CaretDoubleUp, FolderSimplePlus } from "@phosphor-icons/react";
import { Mounts } from "@kernel/Mounts";
import { t } from "@kernel/i18n";
import type { WorkspaceOrigin } from "@kernel/workspaceOrigins";

export interface WorkspaceCaptionProps {
  origins: readonly WorkspaceOrigin[];
  archivedView: boolean;
  originFilter: string;
  allCollapsed: boolean;
  onToggleAllCollapsed: () => void;
  onAdd: (rect: DOMRect) => void;
  onPickView: (value: string) => void;
}

export function WorkspaceCaption({
  origins,
  archivedView,
  originFilter,
  allCollapsed,
  onToggleAllCollapsed,
  onAdd,
  onPickView,
}: WorkspaceCaptionProps) {
  return (
    <div className="ws-caption">
      <span className="ws-caption-label">
        <Folders size="1rem" aria-hidden className="ws-caption-icon" />
        {t("工作区")}
      </span>
      <span className="ws-caption-actions">
        <div className="ws-view-toggle" role="radiogroup" aria-label={t("工作区视图")}>
          {(
            [
              ["local", "本地"],
              ...origins.map((o) => [o.id, o.label] as const),
              ["archived", "归档"],
            ] as const
          ).map(([value, label]) => {
            const active = archivedView
              ? value === "archived"
              : value === (originFilter || "local");
            return (
              <button key={value} type="button" role="radio" aria-checked={active}
                className={active ? "is-on" : ""}
                onClick={() => onPickView(value)}>
                {t(label)}
              </button>
            );
          })}
        </div>
        <button
          className="ws-caption-btn"
          title={allCollapsed ? t("展开全部工作区会话") : t("折叠全部工作区会话")}
          aria-label={allCollapsed ? t("展开全部工作区会话") : t("折叠全部工作区会话")}
          onClick={onToggleAllCollapsed}
        >
          {allCollapsed ? (
            <CaretDoubleUp size="0.8125rem" aria-hidden />
          ) : (
            <CaretDoubleDown size="0.8125rem" aria-hidden />
          )}
        </button>
        {/* 插件贡献的动作位(如 session-budget 的预算入口),渲染器 = kernel Mounts */}
        <Mounts point="leftSidebar.workspaceCaption" />
        <button
          className="ws-caption-btn"
          title={t("添加工作区")}
          onClick={(e) => onAdd(e.currentTarget.getBoundingClientRect())}
        >
          <FolderSimplePlus size="0.8125rem" aria-hidden />
        </button>
      </span>
    </div>
  );
}
