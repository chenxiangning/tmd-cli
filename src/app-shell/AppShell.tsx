/**
 * 五区外壳 + 左右工具条（rail）。
 *
 * 布局：头部 / [左 rail + 左栏 | 幕布 | 右栏 + 右 rail] / 底部。
 * - rail 是 VS Code activity bar 式窄条，插件可挂 leftRail/rightRail 图标
 * - 底部左右角的折叠钮控制对应侧整区（rail + 面板）显隐，状态持久化
 * - 外壳是内核的一部分；头/底/rail/侧栏都暴露挂载点给插件
 */

import { useEffect, useState } from "react";
import { host, useHost } from "@kernel/host";
import type { MountPoint } from "@kernel/plugin";
import { TerminalView } from "@kernel/TerminalView";

function Mounts({ point }: { point: MountPoint }) {
  useHost();
  return (
    <>
      {host.getMount(point).map(({ component: C }, i) => (
        <C key={i} />
      ))}
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

export function AppShell() {
  useHost();
  const activeId = host.getActiveSessionId();
  const [leftOpen, toggleLeft] = usePersistedToggle("shell.left", true);
  const [rightOpen, toggleRight] = usePersistedToggle("shell.right", true);

  return (
    <div className="flex h-screen w-screen flex-col bg-neutral-950 text-neutral-200">
      {/* 头部工具栏 */}
      <header className="flex h-10 shrink-0 items-center justify-between border-b border-neutral-800 px-3">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold">tmd-cli</span>
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
            <nav className="flex w-10 shrink-0 flex-col items-center gap-1 border-r border-neutral-800 py-2">
              <Mounts point="leftRail" />
            </nav>
            <aside className="flex w-56 shrink-0 flex-col border-r border-neutral-800">
              <SessionList />
              <Mounts point="leftSidebar.section" />
            </aside>
          </>
        )}

        {/* 幕布 */}
        <main className="min-w-0 flex-1">
          {activeId ? (
            <TerminalView key={activeId} sessionId={activeId} />
          ) : (
            <div className="flex h-full items-center justify-center text-neutral-500">
              左侧新建一个会话开始
            </div>
          )}
        </main>

        {/* 右侧面板 + 工具条 */}
        {rightOpen && (
          <>
            <aside className="flex w-64 shrink-0 flex-col border-l border-neutral-800">
              <div className="flex h-9 shrink-0 items-center border-b border-neutral-800 px-3 text-xs text-neutral-500">
                文件
              </div>
              <div className="min-h-0 flex-1 overflow-auto">
                <Mounts point="rightSidebar.tab" />
              </div>
            </aside>
            <nav className="flex w-10 shrink-0 flex-col items-center gap-1 border-l border-neutral-800 py-2">
              <Mounts point="rightRail" />
            </nav>
          </>
        )}
      </div>

      {/* 底部状态栏：角落折叠钮 + 插件挂载点 */}
      <footer className="flex h-7 shrink-0 items-center justify-between border-t border-neutral-800 px-1 text-xs text-neutral-500">
        <div className="flex items-center gap-1">
          <button
            className="rounded px-2 py-0.5 hover:bg-neutral-800"
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
            className="rounded px-2 py-0.5 hover:bg-neutral-800"
            title={rightOpen ? "折叠右栏" : "展开右栏"}
            onClick={toggleRight}
          >
            {rightOpen ? "▶" : "◀"}
          </button>
        </div>
      </footer>

      {/* 浮层挂载点（文件预览等） */}
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
