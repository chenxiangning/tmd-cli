/**
 * 编辑区(文件预览面板)—— tab 条 + 内容挂载点。
 * 从 AppShell 拆出(500 行铁则):FileTabIcon / FileTab / EditorCenter 三位一体的
 * tab 交互(右键菜单、最大化切换、关闭)集中于此。
 */

import { memo, useState } from "react";
import { Maximize2, Minimize2, X } from "lucide-react";
import { Mounts } from "@kernel/Mounts";
import { baseName } from "@kernel/pathUtils";
import { resolveFileVisual } from "@kernel/fileVisual";
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
  isActive,
  dirty,
  onContextMenu,
}: {
  tabId: string;
  tabPath: string;
  isActive: boolean;
  dirty?: boolean;
  onContextMenu: (e: React.MouseEvent) => void;
}) {
  const fileName = baseName(tabPath) || tabPath;
  const maximized = useEditorMaximized();
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
        <FileTabIcon fileName={fileName} />
        <span className="tab-main-label">{fileName}</span>
        {/* 未保存圆点(useFileDocument 经 updateTab 上报) */}
        {dirty ? <span className="tab-dirty-dot" aria-hidden /> : null}
      </button>
      {/* 最大化查看/还原切换(沿用 tab-detach 样式钩子;原"在新窗口打开"为占位) */}
      <button
        type="button"
        className="tab-detach"
        aria-label={maximized ? "还原" : `最大化查看 ${fileName}`}
        title={maximized ? "还原" : "最大化查看"}
        onClick={(e) => {
          e.stopPropagation();
          toggleEditorMaximized();
        }}
      >
        {maximized ? (
          <Minimize2 size={11} aria-hidden />
        ) : (
          <Maximize2 size={11} aria-hidden />
        )}
      </button>
      <button
        type="button"
        className="tab-close"
        aria-label={`关闭 ${fileName}`}
        title="关闭"
        onClick={(e) => {
          e.stopPropagation();
          closeTab(tabId);
        }}
      >
        <X size={11} aria-hidden />
      </button>
    </div>
  );
}

export const EditorCenter = memo(function EditorCenter() {
  const { tabs, activeId } = useEditorTabs();
  const active = tabs.find((t) => t.id === activeId) ?? null;
  /** tab 右键菜单目标:作用于被右键的 tab,不强制激活。 */
  const [menu, setMenu] = useState<{ tabId: string; x: number; y: number } | null>(null);

  return (
    <div className="flex h-full flex-col bg-(--tmd-bg-base)">
      <div className="tab-bar">
        <div className="tab-bar-track">
          {tabs.map((t) => (
            <FileTab
              key={t.id}
              tabId={t.id}
              tabPath={t.path || t.title}
              isActive={t.id === activeId}
              dirty={t.dirty}
              onContextMenu={(e) => setMenu({ tabId: t.id, x: e.clientX, y: e.clientY })}
            />
          ))}
        </div>
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
      <div className="min-h-0 flex-1 overflow-auto">
        {active ? (
          <Mounts point="editorCenter.tabContent" />
        ) : (
          <div className="flex h-full items-center justify-center text-xs text-(--tmd-fg-faint)">
            选中一个文件查看
          </div>
        )}
      </div>
    </div>
  );
});
