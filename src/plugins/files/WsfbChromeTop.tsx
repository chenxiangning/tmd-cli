/**
 * 侧栏文件浏览器顶栏 chrome —— 返回工作区 + 搜索框(漏斗开时带「显示全部文件」
 * 退出 pill)。自 WorkspaceFileBrowser 拆出(文件规模铁则)。
 */

import { ArrowLeft, MagnifyingGlass } from "@phosphor-icons/react";
import { t } from "@kernel/i18n";
import { closeWorkspaceFiles } from "@kernel/workspaceFileBrowser";

export function WsfbChromeTop({
  query,
  onQuery,
  changedOnly,
  onExitChanged,
}: {
  query: string;
  onQuery: (v: string) => void;
  changedOnly: boolean;
  onExitChanged: () => void;
}) {
  return (
    <>
      <button type="button" className="wsfb-back" onClick={closeWorkspaceFiles}>
        <ArrowLeft size="0.875rem" aria-hidden />
        <span>{t("返回工作区")}</span>
      </button>
      <div className="wsfb-search">
        <MagnifyingGlass size="0.75rem" aria-hidden className="wsfb-search-icon" />
        <input
          type="text"
          value={query}
          placeholder={t("搜索文件...")}
          onChange={(e) => onQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              if (query) onQuery("");
              else closeWorkspaceFiles();
            }
          }}
        />
        {changedOnly && (
          <button type="button" className="wsfb-filter-pill" onClick={onExitChanged}>
            {t("显示全部文件")}
          </button>
        )}
      </div>
    </>
  );
}
