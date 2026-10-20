/**
 * 工作区文件浏览器头部(名称 + 更多菜单钮 + 变更过滤 + 展开全部 + 刷新)——
 * 2026-10-20 从 WorkspaceFileBrowser.tsx 拆出的展示组件(守 300 行铁则,
 * 零语义改动);状态与 settings 读写仍在主组件,本组件只收回调。
 */
import { DotsThree, Funnel, CaretDoubleDown, ArrowClockwise } from "@phosphor-icons/react";
import { t } from "@kernel/i18n";
import { Spinner } from "@kernel/Spinner";

export interface WsfbHeadProps {
  headName: string;
  root: string;
  changedOnly: boolean;
  refreshing: boolean;
  /** 变更过滤钮:切态并清搜索词(主组件语义)。 */
  onToggleChanged: () => void;
  /** 展开全部目录(仅 changedOnly 态渲染;剪枝树桶置开逻辑在主组件)。 */
  onExpandAll: () => void;
  onRefresh: () => void;
  onMore: (rect: DOMRect) => void;
}

export function WsfbHead({
  headName,
  root,
  changedOnly,
  refreshing,
  onToggleChanged,
  onExpandAll,
  onRefresh,
  onMore,
}: WsfbHeadProps) {
  return (
    <div className="wsfb-head">
      <span className="wsfb-head-name" title={root}>
        {headName}
      </span>
      <span className="wsfb-head-actions">
        <button
          type="button"
          className="wsfb-head-btn"
          title={t("更多操作")}
          aria-label={t("更多操作")}
          onClick={(e) => onMore(e.currentTarget.getBoundingClientRect())}
        >
          <DotsThree size="1rem" weight="bold" aria-hidden />
        </button>
        <button
          type="button"
          className={`wsfb-head-btn${changedOnly ? " is-on" : ""}`}
          title={changedOnly ? t("显示全部文件") : t("仅显示有变更的文件")}
          aria-pressed={changedOnly}
          onClick={onToggleChanged}
        >
          <Funnel size="0.875rem" aria-hidden />
        </button>
        {changedOnly && (
          <button
            type="button"
            className="wsfb-head-btn"
            title={t("展开全部目录")}
            aria-label={t("展开全部目录")}
            onClick={onExpandAll}
          >
            <CaretDoubleDown size="0.875rem" aria-hidden />
          </button>
        )}
        <button
          type="button"
          className="wsfb-head-btn"
          title={t("刷新")}
          aria-label={t("刷新")}
          onClick={onRefresh}
        >
          {refreshing
            ? <Spinner size="0.875rem" />
            : <ArrowClockwise size="0.875rem" aria-hidden />}
        </button>
      </span>
    </div>
  );
}
