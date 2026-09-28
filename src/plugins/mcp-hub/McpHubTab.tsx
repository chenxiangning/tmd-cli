/**
 * MCP 管理 tab 壳 —— 左引擎栏 + 视图切换(服务器/商店/导入)。
 * 引擎/视图选择是组件局部态(不跨 tab 关闭记忆);商店与导入视图以左栏
 * 选中引擎为默认目标引擎,各自可改。数据全部来自 hubStore(挂载刷新)。
 */
import { useEffect, useState } from "react";
import type { EditorTab } from "@kernel/tabs";
import { t } from "@kernel/i18n";
import { refreshHub, useHubState } from "./hubStore";
import { ServersView } from "./ServersView";
import { StoreView } from "./StoreView";
import { ImportView } from "./ImportView";

type HubView = "servers" | "store" | "import";

const VIEWS: { id: HubView; label: string }[] = [
  { id: "servers", label: "服务器" },
  { id: "store", label: "商店" },
  { id: "import", label: "导入" },
];

export function McpHubTab(_props: { tab: EditorTab }) {
  const { engines, loading } = useHubState();
  const [profileId, setProfileId] = useState<string | null>(null);
  const [view, setView] = useState<HubView>("servers");

  useEffect(() => {
    void refreshHub();
  }, []);

  const active = engines.find((e) => e.profileId === profileId) ?? engines[0];
  const onSelect = (id: string) => {
    setProfileId(id);
    if (view !== "servers") setView("servers");
  };

  return (
    <div className="flex h-full min-h-0 bg-(--tmd-bg-base)">
      <aside className="flex w-44 flex-none flex-col border-r border-(--tmd-border)">
        <div className="px-3 pt-3 pb-1 text-[0.625rem] font-medium tracking-wide text-(--tmd-fg-faint)">
          {t("引擎")}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto pb-2">
          {engines.map((engine) => (
            <button
              key={engine.profileId}
              type="button"
              aria-pressed={engine.profileId === active?.profileId}
              className={`relative flex w-full items-center justify-between px-3 py-1.5 text-left text-[0.6875rem] leading-[1.125rem] transition-colors ${
                engine.profileId === active?.profileId
                  ? "bg-(--tmd-bg-hover) font-medium text-(--tmd-fg) after:absolute after:inset-y-1 after:left-0 after:w-0.5 after:rounded-full after:bg-(--tmd-accent)"
                  : "text-(--tmd-fg-muted) hover:bg-(--tmd-bg-hover)"
              }`}
              onClick={() => onSelect(engine.profileId)}
            >
              <span className="truncate">{engine.name}</span>
              <span className="min-w-4 flex-none text-right text-(--tmd-fg-faint) tabular-nums">
                {engine.entries === null ? "!" : engine.exists ? Object.keys(engine.entries).length : "·"}
              </span>
            </button>
          ))}
          <div className="px-3 py-1.5 text-[0.625rem] leading-[1.125rem] text-(--tmd-fg-faint)">
            {t("pi:—(靠 pi-mcp-adapter 扩展)")}
          </div>
          {engines.length === 0 && (
            <div className="px-3 py-2 text-[0.625rem] leading-relaxed text-(--tmd-fg-faint)">
              {loading ? t("正在扫描…") : t("没有可管理的引擎")}
            </div>
          )}
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex flex-none items-center gap-1 border-b border-(--tmd-border) px-3 py-1.5">
          {VIEWS.map((v) => (
            <button
              key={v.id}
              type="button"
              aria-pressed={view === v.id}
              className={`rounded-(--tmd-radius-sm) px-2.5 py-1 text-[0.6875rem] transition-colors ${
                view === v.id
                  ? "bg-(--tmd-bg-hover) font-medium text-(--tmd-fg)"
                  : "text-(--tmd-fg-muted) hover:bg-(--tmd-bg-hover) hover:text-(--tmd-fg)"
              }`}
              onClick={() => setView(v.id)}
            >
              {t(v.label)}
            </button>
          ))}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {view === "servers" && (active ? <ServersView engine={active} /> : null)}
          {view === "store" && <StoreView defaultEngine={active ?? null} engines={engines} />}
          {view === "import" && <ImportView engines={engines} defaultEngine={active ?? null} />}
        </div>
      </div>
    </div>
  );
}
