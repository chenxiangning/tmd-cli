/**
 * 侧栏文件浏览器列表态与派生 —— 全部文件 / 仅变更 / 搜索 三态渲染组件,
 * 及着色/剪枝纯派生(自 WorkspaceFileBrowser 拆出,文件规模铁则)。
 * 列表渲染本体见 WsfbLists;此处只做态选择与空/加载分支。
 */

import { ArrowClockwise } from "@phosphor-icons/react";
import { t } from "@kernel/i18n";
import type { DirEntry } from "@kernel/ipc";
import type { ChangedChild } from "./workspaceBrowserModel";
import { WsfbAllFilesList, WsfbChangedList, WsfbSearchList, type WsfbRowMenu } from "./WsfbLists";

const SEARCH_RENDER_CAP = 200;


/** 搜索态:命中平铺(点击开 tab)+ 截断提示。 */
export function SearchBody({
  hits,
  truncated,
  selectedPath,
  colors,
  letters,
  ignored,
  rowMenu,
  onPick,
}: {
  hits: string[] | null;
  /** walk 满额(SEARCH_WALK_CAP):命中集可能不完整,空结果别当「没有」。 */
  truncated: boolean;
  selectedPath: string | null;
  colors: ReadonlyMap<string, string>;
  letters: ReadonlyMap<string, string>;
  ignored: readonly string[];
  rowMenu: WsfbRowMenu;
  onPick: (path: string) => void;
}) {
  if (hits == null) return <div className="wsfb-empty">{t("搜索中…")}</div>;
  if (hits.length === 0) {
    return (
      <div className="wsfb-empty">
        {truncated ? t("结果可能不完整:文件数超过扫描上限") : t("没有匹配的文件")}
      </div>
    );
  }
  return (
    <>
      <WsfbSearchList
        hits={hits.slice(0, SEARCH_RENDER_CAP)}
        selectedPath={selectedPath}
        colors={colors}
        letters={letters}
        ignored={ignored}
        rowMenu={rowMenu}
        onPick={onPick}
      />
      {hits.length > SEARCH_RENDER_CAP && (
        <div className="wsfb-empty">{t("仅显示前 {n} 条结果", { n: SEARCH_RENDER_CAP })}</div>
      )}
    </>
  );
}

/** 变更态:剪枝树(空 = 无变更文件提示)。 */
export function ChangedBody({
  rootKids,
  changedTree,
  changedOpen,
  selectedPath,
  colors,
  letters,
  rowMenu,
  onSelect,
  onToggleDir,
}: {
  rootKids: readonly ChangedChild[];
  changedTree: ReadonlyMap<string, readonly ChangedChild[]>;
  changedOpen: Record<string, true>;
  selectedPath: string | null;
  colors: ReadonlyMap<string, string>;
  letters: ReadonlyMap<string, string>;
  rowMenu: WsfbRowMenu;
  onSelect: (path: string) => void;
  onToggleDir: (path: string) => void;
}) {
  if (rootKids.length === 0) return <div className="wsfb-empty">{t("没有变更文件")}</div>;
  return (
    <WsfbChangedList
      rootKids={rootKids}
      changedTree={changedTree}
      changedOpen={changedOpen}
      selectedPath={selectedPath}
      colors={colors}
      letters={letters}
      rowMenu={rowMenu}
      onSelect={onSelect}
      onToggleDir={onToggleDir}
    />
  );
}

/** 全部文件态:懒展开树(与右栏 FileTree 同一 useDirTree 数据)。 */
export function AllFilesBody({
  entries,
  expanded,
  selectedPath,
  colors,
  letters,
  ignored,
  rowMenu,
  loading,
  onToggle,
}: {
  entries: readonly DirEntry[];
  expanded: Record<string, DirEntry[]>;
  selectedPath: string | null;
  colors: ReadonlyMap<string, string>;
  letters: ReadonlyMap<string, string>;
  ignored: readonly string[];
  rowMenu: WsfbRowMenu;
  loading: boolean;
  onToggle: (e: DirEntry) => void;
}) {
  if (loading && entries.length === 0) {
    return (
      <div className="file-tree-loading-row" role="status" aria-live="polite">
        <span className="file-tree-loading-spinner" aria-hidden>
          <ArrowClockwise size="0.75rem" />
        </span>
        <span>{t("加载中…")}</span>
      </div>
    );
  }
  if (entries.length === 0) return <div className="wsfb-empty">{t("目录为空")}</div>;
  return (
    <WsfbAllFilesList
      entries={entries}
      expanded={expanded}
      selectedPath={selectedPath}
      colors={colors}
      letters={letters}
      ignored={ignored}
      rowMenu={rowMenu}
      onToggle={onToggle}
    />
  );
}
