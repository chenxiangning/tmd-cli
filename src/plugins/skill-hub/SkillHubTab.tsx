/**
 * Skills 中央 tab 壳 ── 已装 / 商店 / 本地导入三视图切换 + 顶栏(v2 闭环)。
 * 单例 tab(右栏面板「打开管理」进入);tab 是管理面,每次打开强制重扫+重读记录。
 */

import { useEffect, useState } from "react";
import { ArrowSquareIn, PuzzlePiece, Storefront } from "@phosphor-icons/react";
import { t } from "@kernel/i18n";
import type { EditorTab } from "@kernel/tabs";
import { InstalledView } from "./InstalledView";
import { StoreView } from "./StoreView";
import { ImportView } from "./ImportView";
import { refreshSkillScan } from "./skillStore";

type HubView = "installed" | "store" | "import";

function viewButton(active: boolean): string {
  return `flex items-center gap-1 rounded px-2 py-1 text-xs ${
    active
      ? "bg-(--tmd-accent-soft) text-(--tmd-fg)"
      : "text-(--tmd-fg-muted) hover:bg-(--tmd-bg-hover)"
  }`;
}

export function SkillHubTab({ tab }: { tab: EditorTab }) {
  const [view, setView] = useState<HubView>("installed");
  useEffect(() => {
    if (tab.id) void refreshSkillScan();
  }, [tab.id]);

  return (
    <div className="flex h-full min-h-0 flex-col" data-skill-hub={view}>
      <div className="flex items-center gap-1 border-b border-(--tmd-border) px-3 py-2">
        <button
          type="button"
          className={viewButton(view === "installed")}
          onClick={() => setView("installed")}
        >
          <PuzzlePiece size={13} aria-hidden="true" />
          {t("已安装")}
        </button>
        <button
          type="button"
          className={viewButton(view === "store")}
          onClick={() => setView("store")}
        >
          <Storefront size={13} aria-hidden="true" />
          {t("技能商店")}
        </button>
        <button
          type="button"
          className={viewButton(view === "import")}
          onClick={() => setView("import")}
        >
          <ArrowSquareIn size={13} aria-hidden="true" />
          {t("本地导入")}
        </button>
      </div>
      <div className="min-h-0 flex-1">
        {view === "installed" ? (
          <InstalledView onGotoImport={() => setView("import")} />
        ) : view === "store" ? (
          <StoreView />
        ) : (
          <ImportView />
        )}
      </div>
    </div>
  );
}
