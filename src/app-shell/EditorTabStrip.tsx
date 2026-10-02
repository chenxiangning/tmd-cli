/**
 * 编辑 tab 条(顶栏)—— 文件/记忆/diff 等编辑区 tab 的横向条。
 *
 * 2026-09-06 架构改:自编辑栏表头(EditorCenter 内第二排)上移到顶栏,经
 * contributions 挂 header.breadcrumb(order 300),与会话 tab 条(order 200)
 * 同排。激活语义双轨并存:会话 tab 管中央幕布,编辑 tab 管编辑栏,互不打断。
 * FileTabIcon / FileTab 自 EditorCenter 原样迁入(右键菜单、最大化切换、关闭)。
 * 溢出走马灯:滚轮竖向滚动转横向 scrollLeft,滚动条 CSS 隐藏(tab-bar.css)。
 */

import { memo, useState, useCallback } from "react";
import { CornersOut, CornersIn, Cross } from "@phosphor-icons/react";
import { baseName } from "@kernel/pathUtils";
import { resolveFileVisual } from "@kernel/fileVisual";
import { getTabIcon } from "@kernel/tabs";
import { t } from "@kernel/i18n";
import {
  closeAllTabs,
  closeOtherTabs,
  closeTab,
  setActiveTab,
  useEditorTabs,
} from "@kernel/tabs";
import { TabContextMenu } from "./TabContextMenu";
import { toggleEditorMaximized, useEditorMaximized } from "./editorMaximized";

/* 文件类型 SVG ─ 由 fileTreeIcons 给出(与文件树一致)。 */
function FileTabIcon({ fileName }: { fileName: string }) {
  const html = resolveFileVisual(fileName, false).svgHtml;
  return (
    <span
      className="tab-icon"
      aria-hidden
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

/** 单个 tab ─ 图标 + 名称(+ 脏标记圆点)+ 最大化切换 + close;右键出菜单。 */
function FileTab({
  tabId,
  tabPath,
  tabTitle,
  tabKind,
  isActive,
  dirty,
  onContextMenu,
}: {
  tabId: string;
  tabPath: string;
  tabTitle: string;
  tabKind: string;
  isActive: boolean;
  dirty?: boolean;
  onContextMenu: (e: React.MouseEvent) => void;
}) {
  const fileName = baseName(tabPath) || tabPath;
  const maximized = useEditorMaximized();
  /* kind 注册图标(非文件 tab 的插件语义图标)优先;未注册回落文件类型徽标 */
  const KindIcon = getTabIcon(tabKind);
  return (
    <div
      className={`tab${isActive ? " is-active" : ""}`}
      data-tab-id={tabId}
      onContextMenu={(e) => {
        e.preventDefault();
        onContextMenu(e);
      }}
    >
      <button
        type="button"
        className="tab-main"
        onClick={() => setActiveTab(tabId)}
        title={tabPath}
      >
        {KindIcon ? (
          <span className="tab-icon" aria-hidden>
            <KindIcon size="0.75rem" />
          </span>
        ) : (
          <FileTabIcon fileName={fileName} />
        )}
        <span className="tab-main-label">{KindIcon ? tabTitle : fileName}</span>
        {/* 未保存圆点(useFileDocument 经 updateTab 上报) */}
        {dirty ? <span className="tab-dirty-dot" aria-hidden /> : null}
      </button>
      {/* 最大化查看/还原切换(沿用 tab-detach 样式钩子;原"在新窗口打开"为占位) */}
      <button
        type="button"
        className="tab-detach"
        aria-label={maximized ? t("还原") : t("最大化查看 {file}", { file: fileName })}
        title={t(maximized ? "还原" : "最大化查看")}
        onClick={(e) => {
          e.stopPropagation();
          toggleEditorMaximized();
        }}
      >
        {maximized ? (
          <CornersIn size="0.75rem" aria-hidden />
        ) : (
          <CornersOut size="0.75rem" aria-hidden />
        )}
      </button>
      <button
        type="button"
        className="tab-close"
        aria-label={t("关闭 {file}", { file: fileName })}
        data-hint={t("关闭 {file}", { file: fileName })}
        data-hint-cmd="shell.closeTab"
        title=""
        onClick={(e) => {
          e.stopPropagation();
          closeTab(tabId);
        }}
      >
        <Cross size="0.75rem" aria-hidden />
      </button>
    </div>
  );
}

/** 顶栏编辑 tab 条:无 tab 不渲染。溢出走马灯滚动,无滚动条。 */
export const EditorTabStrip = memo(function EditorTabStrip() {
  /* 溢出感知:可滚且未到头才挂右缘渐隐 fade-end(评审 B2,常驻会裁最后一张)。 */
  const [fadeEnd, setFadeEnd] = useState(false);
  const updateFade = useCallback((el: HTMLDivElement) => {
    setFadeEnd(el.scrollWidth - el.clientWidth - el.scrollLeft > 1);
  }, []);
  const tabsRef = useCallback(
    (el: HTMLDivElement | null) => {
      if (el) updateFade(el);
    },
    [updateFade],
  );
  const { tabs, activeId } = useEditorTabs();
  /** tab 右键菜单目标:作用于被右键的 tab,不强制激活。 */
  const [menu, setMenu] = useState<{ tabId: string; x: number; y: number } | null>(null);

  if (tabs.length === 0) return null;

  return (
    <div
      ref={tabsRef}
      className={`tab-bar${fadeEnd ? " fade-end" : ""} tmd-scroll-hide`}
      role="tablist"
      aria-label={t("打开的文件")}
      onWheel={(e) => {
        /* 竖向滚轮转横向滚动;不 preventDefault(外层无纵向滚动链可劫持) */
        e.currentTarget.scrollLeft += e.deltaY + e.deltaX;
      }}
      onScroll={(e) => updateFade(e.currentTarget)}
    >
      <div className="tab-bar-track">
        {tabs.map((t) => (
          <FileTab
            key={t.id}
            tabId={t.id}
            tabPath={t.path || t.title}
            tabTitle={t.title}
            tabKind={t.kind}
            isActive={t.id === activeId}
            dirty={t.dirty}
            onContextMenu={(e) => setMenu({ tabId: t.id, x: e.clientX, y: e.clientY })}
          />
        ))}
      </div>
      {menu ? (
        <TabContextMenu
          position={{ x: menu.x, y: menu.y }}
          onCloseTab={() => closeTab(menu.tabId)}
          onCloseOthers={() => closeOtherTabs(menu.tabId)}
          onCloseAll={() => closeAllTabs()}
          onClose={() => setMenu(null)}
        />
      ) : null}
    </div>
  );
});
