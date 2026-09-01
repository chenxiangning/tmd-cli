/**
 * 外壳骨架 + 中央幕布 + composer + 文件编辑器 tab + 会话列表 + 折叠工具条。
 *
 * 布局(对齐 mossx 外壳骨架):
 * ┌─────────────────────────────────────────────────┐
 * │ 头部工具栏(默认融合 macOS 原生标题栏,data-tauri-drag-region) │
 * ├────┬─────────┬──────────────────────┬─────────┬───┤
 * │rail│ 左栏    │ 终端幕布(占主体)  │ 文件 tab│rail│
 * │    │ session │                       │ (有文件) │   │
 * │    │         │                       │ 才显示   │   │
 * │    │         ├──────────────────────┤         │   │
 * │    │         │ composer             │         │   │
 * ├────┴─────────┴──────────────────────┴─────────┴───┤
 * │ 底部状态栏                                        │
 * └─────────────────────────────────────────────────┘
 *
 * 关键设计:
 * - 文件 tab 区仅在打开过文件时显示(用户诉求 #1)
 * - composer 始终在幕布正下方,高度可拖拽
 * - 左侧会话持久化走 ~/.tmd-cli/sessions.json(本轮计划接入)
 * - 头部用 data-tauri-drag-region 融合 macOS 原生窗口栏(诉求 #7)
 * - 工具条对齐 mossx 紧凑尺寸:头部 h-8,底部 h-6,rail w-8(诉求 #6)
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
 * 中间主体 —— 根据 tabs 是否存在,在单栏(纯幕布)与双栏(幕布 + 文件 tab)间切换。
 * 双栏使用 react-resizable-panels 可拖拽;单栏隐藏文件 tab Panel。
 */
function MainPanel() {
  const activeId = host.getActiveSessionId();
  const [rightMaximized, setRightMaximized] = useState(false);
  const { tabs } = useEditorTabs();
  const showEditor = tabs.length > 0;

  return (
    <main className="flex min-w-0 flex-1 flex-col">
      <div className="flex min-h-0 flex-1">
        {showEditor ? (
          <PanelGroup orientation="horizontal" id="tmd.main" autoSave="tmd.main">
            <Panel defaultSize={rightMaximized ? 0 : 70} minSize={0} id="terminal">
              <div className="h-full w-full">
                {activeId ? (
                  <TerminalView key={activeId} sessionId={activeId} />
                ) : (
                  <div className="flex h-full items-center justify-center text-neutral-500">
                    左侧新建一个会话开始
                  </div>
                )}
              </div>
            </Panel>
            <PanelResizeHandle className="w-1 shrink-0 bg-neutral-800 hover:bg-neutral-600" />
            <Panel defaultSize={rightMaximized ? 100 : 30} minSize={15} id="editor">
              <div className="relative h-full w-full">
                <button
                  onClick={() => setRightMaximized((v) => !v)}
                  title={rightMaximized ? "恢复左侧" : "最大化右侧"}
                  className="absolute right-1 top-1 z-10 rounded bg-neutral-800/80 px-1.5 py-0.5 text-xs text-neutral-400 hover:bg-neutral-700 hover:text-neutral-100"
                >
                  {rightMaximized ? "⤇" : "⤆"}
                </button>
                <EditorCenter />
              </div>
            </Panel>
          </PanelGroup>
        ) : (
          <div className="h-full w-full">
            {activeId ? (
              <TerminalView key={activeId} sessionId={activeId} />
            ) : (
              <div className="flex h-full items-center justify-center text-neutral-500">
                左侧新建一个会话开始
              </div>
            )}
          </div>
        )}
      </div>
      <div className="h-40 shrink-0 border-t border-neutral-800">
        <Mounts point="editorCenter.composer" />
      </div>
    </main>
  );
}

export function AppShell() {
  useHost();
  const [leftOpen, toggleLeft] = usePersistedToggle("shell.left", true);
  const [rightOpen, toggleRight] = usePersistedToggle("shell.right", true);

  return (
    <div className="flex h-screen w-screen flex-col bg-neutral-950 text-neutral-200">
      {/* 头部工具栏(融合 macOS 原生窗口栏,data-tauri-drag-region 允许拖拽) */}
      <header
        data-tauri-drag-region
        className="flex h-8 shrink-0 items-center justify-between border-b border-neutral-800 bg-neutral-950 px-3"
      >
        <div className="flex items-center gap-2" data-tauri-drag-region>
          <span className="text-sm font-semibold" data-tauri-drag-region>
            tmd-cli
          </span>
          <Mounts point="header.left" />
        </div>
        <div className="flex items-center gap-2">
          <Mounts point="header.right" />
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* 左侧工具条 + 面板 */}
        {leftOpen && (
          <>
            <nav className="flex w-8 shrink-0 flex-col items-center gap-1 border-r border-neutral-800 py-1">
              <Mounts point="leftRail" />
            </nav>
            <aside className="flex w-52 shrink-0 flex-col border-r border-neutral-800">
              <SessionList />
              <Mounts point="leftSidebar.section" />
            </aside>
          </>
        )}

        <MainPanel />

        {/* 右侧面板 + 工具条 */}
        {rightOpen && (
          <>
            <aside className="flex w-56 shrink-0 flex-col border-l border-neutral-800">
              <div className="flex h-8 shrink-0 items-center border-b border-neutral-800 px-3 text-xs text-neutral-500">
                文件
              </div>
              <div className="min-h-0 flex-1 overflow-auto">
                <Mounts point="rightSidebar.tab" />
              </div>
            </aside>
            <nav className="flex w-8 shrink-0 flex-col items-center gap-1 border-l border-neutral-800 py-1">
              <Mounts point="rightRail" />
            </nav>
          </>
        )}
      </div>

      {/* 底部状态栏 */}
      <footer className="flex h-6 shrink-0 items-center justify-between border-t border-neutral-800 px-1 text-xs text-neutral-500">
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

/** 呼吸灯：2 秒内有过 PTY 输出 = 呼吸态，否则静止。 */
function ActivityDot({ sessionId }: { sessionId: string }) {
  useHost();
  const [, tick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(timer);
  }, []);
  const alive = Date.now() - host.getLastActivityAt(sessionId) < 2000;
  return (
    <span
      className={`inline-block h-2 w-2 rounded-full ${
        alive ? "animate-breathe bg-emerald-400" : "bg-neutral-600"
      }`}
    />
  );
}

function SessionList() {
  useHost();
  const sessions = host.getSessions();
  const profiles = host.getCliProfiles();
  const activeId = host.getActiveSessionId();
  const cwd = "/Users/chenxiangning/code/AI/github/tmd-cli";

  return (
    <div className="flex flex-col gap-1 p-2">
      <div className="px-1 text-xs text-neutral-500">新建会话</div>
      {profiles.map((p) => (
        <button
          key={p.id}
          className="rounded px-2 py-1 text-left text-sm hover:bg-neutral-800"
          onClick={() => void host.createSession(p.id, cwd)}
        >
          + {p.name}
        </button>
      ))}
      <div className="mt-3 px-1 text-xs text-neutral-500">会话</div>
      {sessions.map((s) => (
        <button
          key={s.id}
          className={`flex items-center gap-2 rounded px-2 py-1 text-left text-sm ${
            s.id === activeId ? "bg-neutral-800" : "hover:bg-neutral-800"
          }`}
          onClick={() => host.setActiveSession(s.id)}
        >
          <ActivityDot sessionId={s.id} />
          <span className="truncate">
            {s.profileId} · {s.id.slice(0, 6)}
          </span>
        </button>
      ))}
    </div>
  );
}
