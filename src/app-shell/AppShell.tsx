/**
 * 客户端主页外壳 —— 三栏可拖布局 + composer 高度可拖 + 顶栏 macOS 融合。
 *
 * 布局(横向 3 栏,全部可拖):
 * ┌────────────────────────────────────────────────────────┐
 * │ 头部(macOS 红黄绿 + 面包屑 + 挂点)                       │
 * ├──────────┬──────────────────────────────┬──────────────┤
 * │ session  │  幕布(terminal)             │  files       │
 * │ (可拖)   │  + 文件 tab(有打开时)      │  (可拖)      │
 * │          │  + composer(高度可拖)      │              │
 * ├──────────┴──────────────────────────────┴──────────────┤
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

import { useEffect, useState } from "react";
import { Group as PanelGroup, Panel, Separator as PanelResizeHandle } from "react-resizable-panels";
import { host, useHost } from "@kernel/host";
import type { MountPoint } from "@kernel/plugin";
import { TerminalView } from "@kernel/TerminalView";
import { closeTab, setActiveTab, useEditorTabs } from "@kernel/tabs";

function Mounts({ point }: { point: MountPoint }) {
  useHost();
  return (
    <>
      {host.getMount(point).map((c, i) => {
        const Comp = c.component;
        return <Comp key={i} />;
      })}
    </>
  );
}

function usePersistedToggle(key: string, initial: boolean) {
  const [open, setOpen] = useState(
    () => localStorage.getItem(key) !== "0" && initial,
  );
  useEffect(() => {
    localStorage.setItem(key, open ? "1" : "0");
  }, [key, open]);
  return [open, () => setOpen((v) => !v)] as const;
}

function EditorCenter() {
  const { tabs, activeId } = useEditorTabs();
  const active = tabs.find((t) => t.id === activeId) ?? null;

  return (
    <div className="flex h-full flex-col bg-neutral-950">
      <div className="flex h-7 shrink-0 items-center gap-1 overflow-x-auto border-b border-neutral-800 px-1 text-xs">
        {tabs.map((t) => {
          const isActive = t.id === activeId;
          return (
            <button
              key={t.id}
              className={`flex shrink-0 items-center gap-1 rounded px-2 py-0.5 ${
                isActive
                  ? "bg-neutral-800 text-neutral-100"
                  : "text-neutral-400 hover:bg-neutral-800/60"
              }`}
              onClick={() => setActiveTab(t.id)}
              title={t.path}
            >
              <span className="truncate">{t.title}</span>
              <span
                className="ml-1 rounded px-1 text-neutral-500 hover:bg-neutral-700"
                onClick={(e) => {
                  e.stopPropagation();
                  closeTab(t.id);
                }}
              >
                ✕
              </span>
            </button>
          );
        })}
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {active ? (
          <Mounts point="editorCenter.tabContent" />
        ) : (
          <div className="flex h-full items-center justify-center text-xs text-neutral-600">
            选中一个文件查看
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * 中央幕布 —— 文件 tab 与会话独立:
 * - 无 session + 有 tab → 中央直接是 EditorCenter
 * - 无 session + 无 tab → "新建会话"占位
 * - 有 session + 无 tab → 纯 TerminalView
 * - 有 session + 有 tab → terminal | editor 双栏
 *
 * 底部 composer 与主区之间可拖。
 */
function MainPanel() {
  const activeId = host.getActiveSessionId();
  const { tabs } = useEditorTabs();
  const showEditor = tabs.length > 0;

  return (
    <PanelGroup orientation="vertical" id="tmd.main.vertical">
      <Panel defaultSize={70} minSize={30} id="canvas">
        <div className="flex h-full w-full">
          {!activeId && showEditor && <EditorCenter />}
          {!activeId && !showEditor && (
            <div className="flex h-full items-center justify-center text-neutral-500">
              左侧新建一个会话开始
            </div>
          )}
          {activeId && !showEditor && (
            <TerminalView key={activeId} sessionId={activeId} />
          )}
          {activeId && showEditor && (
            <PanelGroup orientation="horizontal" id="tmd.main.horizontal">
              <Panel defaultSize={70} minSize={30} id="terminal">
                <div className="h-full w-full">
                  <TerminalView key={activeId} sessionId={activeId} />
                </div>
              </Panel>
              <PanelResizeHandle className="w-1 shrink-0 bg-neutral-800 hover:bg-neutral-600" />
              <Panel defaultSize={30} minSize={15} id="editor">
                <EditorCenter />
              </Panel>
            </PanelGroup>
          )}
        </div>
      </Panel>
      <PanelResizeHandle className="h-1 shrink-0 bg-neutral-800 hover:bg-neutral-600" />
      <Panel defaultSize={30} minSize={10} id="composer">
        <Mounts point="editorCenter.composer" />
      </Panel>
    </PanelGroup>
  );
}

/**
 * 头部 —— macOS 红黄绿 + 面包屑 + 挂点。
 */
function TopBar() {
  return (
    <header
      data-tauri-drag-region
      className="flex h-8 shrink-0 items-center justify-between border-b border-neutral-800 bg-black/80 px-3"
    >
      <div className="flex items-center gap-2" data-tauri-drag-region>
        {/* macOS 红黄绿占位 */}
        <div className="flex w-14 items-center gap-1.5" data-tauri-drag-region>
          <span className="h-2.5 w-2.5 rounded-full bg-[#ff5f57]" />
          <span className="h-2.5 w-2.5 rounded-full bg-[#febc2e]" />
          <span className="h-2.5 w-2.5 rounded-full bg-[#28c840]" />
        </div>
        <Mounts point="header.left" />
        <Mounts point="header.breadcrumb" />
      </div>
      <div className="flex items-center gap-2">
        <Mounts point="header.right" />
      </div>
    </header>
  );
}

export function AppShell() {
  useHost();
  const [leftOpen, toggleLeft] = usePersistedToggle("shell.left", true);
  const [rightOpen, toggleRight] = usePersistedToggle("shell.right", true);

  return (
    <div className="flex h-screen w-screen flex-col bg-neutral-950 text-neutral-200">
      <TopBar />

      <PanelGroup orientation="horizontal" id="tmd.outer">
        {/* 左侧 session 栏 */}
        {leftOpen && (
          <>
            <Panel defaultSize={18} minSize={12} id="left">
              <aside className="flex h-full flex-col border-r border-neutral-800">
                <Mounts point="leftSidebar.sessionList" />
                <Mounts point="leftSidebar.section" />
              </aside>
            </Panel>
            <PanelResizeHandle className="w-1 shrink-0 bg-neutral-800 hover:bg-neutral-600" />
          </>
        )}

        {/* 中央幕布 */}
        <Panel defaultSize={60} minSize={30} id="center">
          <MainPanel />
        </Panel>

        {/* 右侧 files 栏 */}
        {rightOpen && (
          <>
            <PanelResizeHandle className="w-1 shrink-0 bg-neutral-800 hover:bg-neutral-600" />
            <Panel defaultSize={22} minSize={12} id="right">
              <aside className="flex h-full flex-col border-l border-neutral-800">
                <div className="flex h-8 shrink-0 items-center border-b border-neutral-800 px-3 text-xs text-neutral-500">
                  文件
                </div>
                <div className="min-h-0 flex-1 overflow-auto">
                  <Mounts point="rightSidebar.tab" />
                </div>
              </aside>
            </Panel>
          </>
        )}
      </PanelGroup>

      {/* 底部状态栏 */}
      <footer className="flex h-6 shrink-0 items-center justify-between border-t border-neutral-800 px-2 text-xs text-neutral-500">
        <div className="flex items-center gap-1">
          <button
            className="rounded px-1.5 py-0.5 hover:bg-neutral-800"
            title={leftOpen ? "折叠左栏" : "展开左栏"}
            onClick={toggleLeft}
          >
            {leftOpen ? "◀" : "▶"}
          </button>
          <Mounts point="footer.left" />
        </div>
        <div className="flex items-center gap-1">
          <Mounts point="footer.right" />
          <button
            className="rounded px-1.5 py-0.5 hover:bg-neutral-800"
            title={rightOpen ? "折叠右栏" : "展开右栏"}
            onClick={toggleRight}
          >
            {rightOpen ? "▶" : "◀"}
          </button>
        </div>
      </footer>

      {/* 浮层挂载点(兜底) */}
      <Mounts point="overlay" />
    </div>
  );
}
