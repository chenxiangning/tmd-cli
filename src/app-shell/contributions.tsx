/**
 * 默认贡献器 —— AppShell 内嵌 UI 全部经挂点贡献,保持可替换。
 *
 * 用户可写一个自定义插件,contribute 同挂点 order 更小来覆盖默认。
 */

import { useEffect, useState } from "react";
import { host, useHost } from "@kernel/host";
import type { MountContribution, MountPoint } from "@kernel/plugin";

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

function SessionListDefault() {
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

/** 装配入口:由 main.tsx 调用,把内置 UI 注册到挂点。 */
export function registerDefaultContributions(ctx: {
  contribute: (point: MountPoint, contribution: MountContribution) => void;
}): void {
  ctx.contribute("leftSidebar.sessionList", {
    order: 100,
    component: SessionListDefault,
  });
  ctx.contribute("header.breadcrumb", {
    order: 100,
    component: BreadcrumbDefault,
  });
}
