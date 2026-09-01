/**
 * 默认贡献器 —— AppShell 内嵌 UI 全部经挂点贡献,保持可替换。
 * 幂等注册:StrictMode 双调 / HMR 不会重复挂。
 */

import { useEffect, useState } from "react";
import { host, useHost } from "@kernel/host";
import type { MountContribution, MountPoint } from "@kernel/plugin";
import { useWorkspaces } from "@kernel/workspace";

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

/** 相对时间(mossx 风格): "刚刚" / "N 分" / "N 时" / "N 天" / "N 周"。 */
function relativeTime(ms: number): string {
  if (!ms) return "";
  const diff = Date.now() - ms;
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return "刚刚";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} 分`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} 时`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day} 天`;
  const week = Math.floor(day / 7);
  if (week < 5) return `${week} 周`;
  const month = Math.floor(day / 30);
  return `${month} 月`;
}

function SessionListDefault() {
  useHost();
  const sessions = host.getSessions();
  const profiles = host.getCliProfiles();
  const activeId = host.getActiveSessionId();
  const { list: workspaces, activeId: activeWsId } = useWorkspaces();
  const activeWs = workspaces.find((w) => w.id === activeWsId) ?? workspaces[0];
  const cwd = activeWs?.root ?? "/Users/chenxiangning/code/AI/github/tmd-cli";

  const byWorkspace = new Map<string, typeof sessions>();
  for (const s of sessions) {
    const key = s.workspaceId ?? "default";
    const list = byWorkspace.get(key) ?? [];
    list.push(s);
    byWorkspace.set(key, list);
  }

  return (
    <div className="flex flex-col gap-1 p-2">
      <div className="px-1 text-xs text-neutral-500">新建会话</div>
      {profiles.map((p) => (
        <button
          key={p.id}
          className="rounded px-2 py-1 text-left text-sm hover:bg-neutral-800"
          onClick={() =>
            void host.createSession(p.id, cwd, activeWs?.id)
          }
        >
          + {p.name}
        </button>
      ))}

      <div className="mt-3 px-1 text-xs text-neutral-500">会话</div>
      {workspaces.map((ws) => {
        const list = byWorkspace.get(ws.id) ?? [];
        if (list.length === 0) return null;
        return (
          <div key={ws.id} className="flex flex-col gap-0.5">
            <div className="px-1 pt-2 text-xs text-neutral-600">{ws.name}</div>
            {list.map((s) => (
              <button
                key={s.id}
                className={`flex items-center gap-2 rounded px-2 py-1 text-left text-sm ${
                  s.id === activeId ? "bg-neutral-800" : "hover:bg-neutral-800"
                }`}
                onClick={() => host.setActiveSession(s.id)}
              >
                <ActivityDot sessionId={s.id} />
                <span className="flex-1 truncate">
                  {s.displayLabel ?? `${s.profileId} · ${s.id.slice(0, 6)}`}
                </span>
                <span className="shrink-0 text-xs text-neutral-500">
                  {relativeTime(s.createdAt ?? 0)}
                </span>
              </button>
            ))}
          </div>
        );
      })}
      {(byWorkspace.get("default") ?? []).length > 0 && (
        <div className="flex flex-col gap-0.5">
          <div className="px-1 pt-2 text-xs text-neutral-600">未分组</div>
          {(byWorkspace.get("default") ?? []).map((s) => (
            <button
              key={s.id}
              className={`flex items-center gap-2 rounded px-2 py-1 text-left text-sm ${
                s.id === activeId ? "bg-neutral-800" : "hover:bg-neutral-800"
              }`}
              onClick={() => host.setActiveSession(s.id)}
            >
              <ActivityDot sessionId={s.id} />
              <span className="flex-1 truncate">
                {s.displayLabel ?? `${s.profileId} · ${s.id.slice(0, 6)}`}
              </span>
              <span className="shrink-0 text-xs text-neutral-500">
                {relativeTime(s.createdAt ?? 0)}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function BreadcrumbDefault() {
  useHost();
  const sessions = host.getSessions();
  const activeId = host.getActiveSessionId();
  const active = sessions.find((s) => s.id === activeId) ?? null;

  if (!active) return null;

  return (
    <div
      data-tauri-drag-region
      className="ml-2 flex items-center gap-1 text-xs text-neutral-400"
    >
      <span className="text-neutral-500">⌁</span>
      <span className="truncate">{active.profileId}</span>
      <span className="text-neutral-600">›</span>
      <span className="truncate text-neutral-300">{active.id.slice(0, 8)}</span>
    </div>
  );
}

/** 顶部 tab 占位 —— 首页/市场/拓展。点击切换 active,实际内容由插件贡献。 */
function TopTabsPlaceholder() {
  const [active, setActive] = useState<"home" | "market" | "extensions">("home");
  const tabs: Array<{ id: "home" | "market" | "extensions"; label: string }> = [
    { id: "home", label: "首页" },
    { id: "market", label: "市场" },
    { id: "extensions", label: "拓展" },
  ];
  return (
    <div className="flex items-center gap-1 border-b border-neutral-800 px-2 text-xs">
      {tabs.map((t) => (
        <button
          key={t.id}
          className={`rounded px-2 py-1 ${
            active === t.id
              ? "bg-neutral-800 text-neutral-100"
              : "text-neutral-400 hover:bg-neutral-800/60"
          }`}
          onClick={() => setActive(t.id)}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

/** 装配入口:由 main.tsx 调用,把内置 UI 注册到挂点。幂等。 */
let registered = false;
export function registerDefaultContributions(ctx: {
  contribute: (point: MountPoint, contribution: MountContribution) => void;
}): void {
  if (registered) return;
  registered = true;
  ctx.contribute("leftSidebar.sessionList", {
    order: 100,
    component: SessionListDefault,
  });
  ctx.contribute("header.breadcrumb", {
    order: 100,
    component: BreadcrumbDefault,
  });
  ctx.contribute("leftSidebar.section", {
    order: 50,
    component: TopTabsPlaceholder,
  });
}
