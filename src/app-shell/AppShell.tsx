/**
 * 客户端主页外壳 —— 横向多栏可拖布局(文件预览为条件通栏) + composer 高度可拖 + 顶栏 macOS 融合。
 *
 * 布局(横向最多 4 栏,全部可拖):
 * ┌────────────────────────────────────────────────────────┐
 * │ 头部(macOS 红黄绿 + 面包屑 + 挂点)                       │
 * ├──────────┬───────────────────┬───────────┬─────────────┤
 * │ session  │  幕布(terminal)  │           │  files      │
 * │ (可拖)   │  ─────────────  │  文件预览  │  (可拖)     │
 * │          │  composer       │ (占满竖屏) │             │
 * ├──────────┴───────────────────┴───────────┴─────────────┤
 * │ 底部状态栏                                              │
 * └────────────────────────────────────────────────────────┘
 *
 * 关键不变量:
 * - 无左右 rail(用户要求去掉)
 * - 三栏都挂 react-resizable-panels,可拖
 * - composer 高度可拖(PanelResizeHandle)
 * - 文件 tab 与会话独立:无 session 也能打开文件
 * - SessionList/TopBar 面包屑等通过挂点贡献(见 contributions.tsx),非硬编码
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Group as PanelGroup, Panel, Separator as PanelResizeHandle } from "react-resizable-panels";
import {
  ExternalLink,
  PanelLeftClose,
  PanelLeftOpen,
  X,
} from "lucide-react";
import { host, useHost } from "@kernel/host";
import { windowClose, windowMinimize, windowToggleMaximize } from "@kernel/ipc";
import { baseName } from "@kernel/pathUtils";
import { Mounts } from "@kernel/Mounts";
import { TerminalView } from "@kernel/TerminalView";
import { closeTab, setActiveTab, useEditorTabs } from "@kernel/tabs";
import { resolveFileVisual } from "@kernel/fileVisual";
import { useFilePanel } from "@kernel/filePanel";
import { usePlatformKind } from "@kernel/platform";
import { RightPanelToolbar, GitPanelPlaceholder, TopBarPanelTabs } from "./RightPanelToolbar";
import { SidebarSettingsCluster } from "./SidebarSettingsCluster";

function usePersistedToggle(key: string, initial: boolean) {
  const [open, setOpen] = useState(
    () => localStorage.getItem(key) !== "0" && initial,
  );
  useEffect(() => {
    localStorage.setItem(key, open ? "1" : "0");
  }, [key, open]);
  return [open, () => setOpen((v) => !v)] as const;
}
/** 测量元素宽度(随拖动实时更新);元素卸载时归零。 */
function useElementWidth() {
  const [width, setWidth] = useState(0);
  const observerRef = useRef<ResizeObserver | null>(null);
  const ref = useCallback((el: HTMLElement | null) => {
    observerRef.current?.disconnect();
    observerRef.current = null;
    if (!el) {
      setWidth(0);
      return;
    }
    const ro = new ResizeObserver((entries) => {
      const w = Math.round(entries[0]?.contentRect.width ?? 0);
      setWidth((prev) => (prev === w ? prev : w));
    });
    ro.observe(el);
    observerRef.current = ro;
  }, []);
  useEffect(() => () => observerRef.current?.disconnect(), []);
  return [ref, width] as const;
}

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

/** 单个 tab ─ 图标 + 名称 + detach + close。 */
function FileTab({
  tabId,
  tabPath,
  isActive,
}: {
  tabId: string;
  tabPath: string;
  isActive: boolean;
}) {
  const fileName = baseName(tabPath) || tabPath;
  return (
    <div className={`tab${isActive ? " is-active" : ""}`} data-tab-id={tabId}>
      <button
        type="button"
        className="tab-main"
        onClick={() => setActiveTab(tabId)}
        title={tabPath}
      >
        <FileTabIcon fileName={fileName} />
        <span className="tab-main-label">{fileName}</span>
      </button>
      <button
        type="button"
        className="tab-detach"
        aria-label={`在新窗口打开 ${fileName}`}
        title="在新窗口打开"
        onClick={(e) => {
          e.stopPropagation();
          // 占位:detached file explorer 后续接入
          // eslint-disable-next-line no-console
          console.info("[tabs] open-detached:", tabPath);
        }}
      >
        <ExternalLink size={11} aria-hidden />
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

function EditorCenter() {
  const { tabs, activeId } = useEditorTabs();
  const active = tabs.find((t) => t.id === activeId) ?? null;

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
            />
          ))}
        </div>
      </div>
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
}

/**
 * 中央幕布 —— 上下结构:terminal(无 session 时占位) + composer,高度可拖。
 * 文件预览不在此层:提升为外层水平 group 的独立通栏面板(见 AppShell),
 * 打开文件时 terminal 不再被横向压缩。
 */
function MainPanel() {
  const activeId = host.getActiveSessionId();

  return (
    <PanelGroup orientation="vertical" id="tmd.main.vertical">
      <Panel defaultSize={70} minSize={30} id="canvas">
        {activeId ? (
          <TerminalView key={activeId} sessionId={activeId} />
        ) : (
          <div className="flex h-full items-center justify-center text-(--tmd-fg-subtle)">
            左侧新建一个会话开始
          </div>
        )}
      </Panel>
      <PanelResizeHandle className="panel-handle panel-handle-h" />
      <Panel defaultSize={30} minSize={10} id="composer">
        <Mounts point="editorCenter.composer" />
      </Panel>
    </PanelGroup>
  );
}

/** macOS 用原生左侧 traffic lights,Windows 自绘右侧按钮组;窗口控制经 kernel/ipc 薄封装。 */
function WindowControls() {
  const platform = usePlatformKind();
  if (platform !== "windows") return null;
  /* 浏览器 dev 无 Tauri runtime,ipc 窗口封装会抛错,必须在平台闸之后调用。 */
  return (
    <div className="titlebar-window-controls win-traffic-lights" aria-label="窗口控制">
      <button aria-label="最小化" title="最小化" className="win-traffic-light" onClick={() => void windowMinimize()}>
        <svg viewBox="0 0 10 10" stroke="currentColor" strokeWidth="1.5" fill="none"><line x1="1" y1="5" x2="9" y2="5" /></svg>
      </button>
      <button aria-label="最大化" title="最大化" className="win-traffic-light" onClick={() => void windowToggleMaximize()}>
        <svg viewBox="0 0 10 10" stroke="currentColor" strokeWidth="1.5" fill="none"><rect x="1" y="1" width="8" height="8" rx="1" /></svg>
      </button>
      <button aria-label="关闭" title="关闭" className="win-traffic-light close" onClick={() => void windowClose()}>
        <svg viewBox="0 0 10 10" stroke="currentColor" strokeWidth="1.5" fill="none"><line x1="1" y1="1" x2="9" y2="9" /><line x1="9" y1="1" x2="1" y2="9" /></svg>
      </button>
    </div>
  );
}

/**
 * 头部 —— codemoss 风格 33px titlebar,横向三区与下方三栏边界对齐:
 * - 左区:与左侧栏同宽(leftWidth 实测);macOS 红绿灯 inset 在左,折叠左栏按钮钉在左区最右缘
 * - 中区:项目面包屑靠左,占据剩余宽度
 * - 右区:与右侧栏同宽(rightWidth 实测);折叠右栏按钮钉在右区最左缘,其余 icons 保持右对齐
 */
function TopBar({
  onToggleLeft,
  onToggleRight,
  leftOpen,
  rightOpen,
  leftWidth,
  rightWidth,
}: {
  onToggleLeft: () => void;
  onToggleRight: () => void;
  leftOpen: boolean;
  rightOpen: boolean;
  /** 左侧栏实测宽度(px);0 = 收起或未测量,左区退化为内容自适应。 */
  leftWidth: number;
  /** 右侧栏实测宽度(px);0 = 收起或未测量,右区退化为内容自适应。 */
  rightWidth: number;
}) {
  const platform = usePlatformKind();
  /* 右区宽度换算:右栏宽 + 4px 手柄 - 12px 顶栏右 padding - Windows 自绘窗口控制区。 */
  const rightInset = platform === "windows" ? 116 : 0;
  const rightZoneWidth = rightWidth > 0 ? Math.max(rightWidth - 8 - rightInset, 0) : 0;
  return (
    <header className="titlebar" data-tauri-drag-region>
      {/* 左区域:与左侧栏同宽,折叠左栏按钮钉在左区最右缘(+4px 吞掉分隔手柄,与栏边界对齐) */}
      <div
        className="titlebar-zone-left"
        data-tauri-drag-region
        style={leftWidth > 0 ? { width: leftWidth + 4 } : undefined}
      >
        {platform === "macos" ? <div className="titlebar-leading" aria-hidden /> : null}
        <button
          type="button"
          className="titlebar-action"
          aria-label={leftOpen ? "收起左栏" : "展开左栏"}
          title={leftOpen ? "收起左栏" : "展开左栏"}
          onClick={onToggleLeft}
        >
          {leftOpen ? <PanelLeftClose size={14} aria-hidden /> : <PanelLeftOpen size={14} aria-hidden />}
        </button>
      </div>
      <div className="titlebar-center" data-tauri-drag-region>
        {/* 项目面包屑:中间区域靠左(codemoss 布局) */}
        <Mounts point="header.breadcrumb" />
        <Mounts point="header.left" />
      </div>
      <div
        className="titlebar-actions"
        data-tauri-drag-region
        style={rightZoneWidth > 0 ? { width: rightZoneWidth } : undefined}
      >
        {/* 折叠/展开右侧栏 */}
        <button
          type="button"
          className="titlebar-action"
          aria-label={rightOpen ? "收起右栏" : "展开右栏"}
          title={rightOpen ? "收起右栏" : "展开右栏"}
          onClick={onToggleRight}
        >
          {rightOpen ? <PanelLeftClose size={14} aria-hidden /> : <PanelLeftOpen size={14} aria-hidden />}
        </button>
        <TopBarPanelTabs />
        <Mounts point="header.right" />
      </div>
      <WindowControls />
    </header>
  );
}
export function AppShell() {
  useHost();
  const platform = usePlatformKind();
  const { mode: filePanelMode } = useFilePanel();
  const [leftOpen, toggleLeft] = usePersistedToggle("shell.left", true);
  const [rightOpen, toggleRight] = usePersistedToggle("shell.right", true);
  const { tabs } = useEditorTabs();
  const [leftAsideRef, leftAsideWidth] = useElementWidth();
  const [rightAsideRef, rightAsideWidth] = useElementWidth();
  /* 经典滚动条会吃掉滚动容器的内容宽度:实测一次,供顶栏折叠按钮让位对齐。 */
  useEffect(() => {
    const probe = document.createElement("div");
    probe.style.cssText =
      "position:absolute;top:-99px;left:-99px;width:100px;height:100px;overflow:scroll";
    document.body.appendChild(probe);
    document.documentElement.style.setProperty(
      "--tmd-scrollbar-w",
      `${probe.offsetWidth - probe.clientWidth}px`,
    );
    probe.remove();
  }, []);

  return (
    <div className={`app ${platform}-desktop flex h-screen w-screen flex-col bg-(--tmd-bg-base) text-(--tmd-fg)`}>
      <TopBar
        onToggleLeft={toggleLeft}
        onToggleRight={toggleRight}
        leftOpen={leftOpen}
        rightOpen={rightOpen}
        leftWidth={leftOpen ? leftAsideWidth : 0}
        rightWidth={rightOpen ? rightAsideWidth : 0}
      />

      <PanelGroup orientation="horizontal" id="tmd.outer">
        {/* 左侧 session 栏 */}
        {leftOpen && (
          <>
            <Panel defaultSize={18} minSize={12} id="left">
              <aside ref={leftAsideRef} className="flex h-full flex-col">
                <div className="min-h-0 flex-1 overflow-auto">
                  <Mounts point="leftSidebar.section" />
                </div>
                {/* 左下角:设置齿轮 + pinned 快捷 + 版本号(复刻 codemoss) */}
                <SidebarSettingsCluster />
              </aside>
            </Panel>
            <PanelResizeHandle className="panel-handle panel-handle-v panel-handle-line-r" />
          </>
        )}

        {/* 中央幕布 */}
        <Panel defaultSize={tabs.length > 0 ? 24 : 60} minSize={15} id="center">
          <MainPanel />
        </Panel>

        {/* 文件预览:有打开 tab 时出现,占满竖屏,位于中栏与右栏之间(可拖) */}
        {tabs.length > 0 && (
          <>
            <PanelResizeHandle className="panel-handle panel-handle-v panel-handle-line-l" />
            <Panel defaultSize={36} minSize={15} id="editor">
              <EditorCenter />
            </Panel>
          </>
        )}

        {rightOpen && (
          <>
            <PanelResizeHandle className="panel-handle panel-handle-v panel-handle-line-l" />
            <Panel defaultSize={22} minSize={12} id="right">
              <aside ref={rightAsideRef} className="flex h-full flex-col">
                {/* 顶部 toolbar:右侧面板控制器(folder/git/...) */}
                <RightPanelToolbar />
                {/* 模式切换:files → FileTree;git → GitPanelPlaceholder */}
                <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
                  {/* 必须 flex 容器:内部 file-tree-panel 的 flex:1 才能拿到有界高度,
                      否则文件树内容无限长高被裁掉,列表永远滚不动。 */}
                  {filePanelMode === "files" ? (
                    <Mounts point="rightSidebar.tab" />
                  ) : (
                    <GitPanelPlaceholder />
                  )}
                </div>
              </aside>
            </Panel>
          </>
        )}
      </PanelGroup>

      <Mounts point="overlay" />
    </div>
  );
}
