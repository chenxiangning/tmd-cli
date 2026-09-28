/**
 * MCP 管理 tab 壳 —— 视图切换(服务器/商店/导入),无左引擎栏。
 * 引擎选择来自 hubStore.selectedProfileId(右栏面板点引擎行设置并打开本 tab);
 * 商店与导入视图以选中引擎为默认目标引擎,各自可改。数据全部来自 hubStore。
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
  const { engines, selectedProfileId } = useHubState();
  const [view, setView] = useState<HubView>("servers");

  useEffect(() => {
    void refreshHub();
  }, []);

  const active = engines.find((e) => e.profileId === selectedProfileId) ?? engines[0];

  return (
    <div className="flex h-full min-h-0 flex-col bg-(--tmd-bg-base)">
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
  );
}
