/**
 * 窄屏左栏抽屉 —— 与桌面左栏同一内容(Mounts 挂点 + 设置簇),遮罩点击/Escape 收起。
 * 自 AppShell 按 300 行铁则与可访问性(遮罩 = button,键盘可达)拆出。
 */
import { useEffect } from "react";
import { Mounts } from "@kernel/Mounts";
import { t } from "@kernel/i18n";
import { SidebarSettingsCluster } from "./SidebarSettingsCluster";

export function NarrowDrawer({ onClose }: { onClose: () => void }) {
  /* Escape 收起(遮罩 button 已覆盖点击/键盘两条路径) */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="absolute inset-0 z-40 flex">
      <button
        type="button"
        aria-label={t("收起抽屉")}
        onClick={onClose}
        className="absolute inset-0 cursor-default bg-black/45"
      />
      <aside className="relative z-10 flex h-full w-[78vw] max-w-[320px] flex-col border-r border-(--tmd-border) bg-(--tmd-bg-base) shadow-2xl">
        <div className="min-h-0 flex-1 overflow-auto">
          <Mounts point="leftSidebar.section" />
        </div>
        <SidebarSettingsCluster />
      </aside>
    </div>
  );
}
