/**
 * search 插件入口 —— yn 全文搜索/快开复刻(spec 2026-09-18):
 * - ⇧⌘F 全文搜索面板(回车触发,结果按文件分组折叠,点击 openFileAtLine 跳行)
 * - ⌘P 文件名快开(fsWalkFiles + 自写 fuzzy 打分,目录项不进)
 * 两命令共用一个居中浮层(overlay 挂点);Esc/遮罩关闭在浮层壳统一处理
 * (全局快捷键系统禁注册 Esc,故走浮层自身 onKeyDown)。
 */
import { createPortal } from "react-dom";
import { MagnifyingGlass } from "@phosphor-icons/react";
import type { Plugin } from "@kernel/plugin";
import { t } from "@kernel/i18n";
import { SearchPanel } from "./SearchPanel";
import { QuickOpen } from "./QuickOpen";
import { closeSearchOverlay, openSearchOverlay, useSearchOverlay } from "./overlayStore";
import "./locales"; /* 域词典随插件自带:import 即注册 */

/** 浮层壳:遮罩 + 居中定位 + Esc 收起;面板本体按当前 kind 二选一。 */
function SearchOverlay() {
  const kind = useSearchOverlay();
  if (!kind) return null;
  return createPortal(
    <>
      <div className="wsmenu-backdrop" role="presentation" onClick={closeSearchOverlay} />
      <div
        className="fixed inset-0 z-[1201] flex items-start justify-center px-4 pt-[12vh]"
        onKeyDown={(e) => {
          if (e.key === "Escape") closeSearchOverlay();
        }}
      >
        {kind === "panel" ? <SearchPanel /> : <QuickOpen />}
      </div>
    </>,
    document.body,
  );
}

export const searchPlugin: Plugin = {
  id: "search",
  meta: {
    name: "搜索",
    abbr: "SE",
    desc: "全文搜索面板与文件名快开(⇧⌘F / ⌘P),命中跳文件定位行",
    icon: MagnifyingGlass,
    iconColor: "#5CAED6",
    category: "feature",
  },
  activate(ctx) {
    ctx.contribute("overlay", { order: 50, component: SearchOverlay });
    ctx.registerCommand({
      id: "search.panel",
      title: t("全文搜索"),
      keybinding: "Cmd+Shift+F",
      run: () => openSearchOverlay("panel"),
    });
    ctx.registerCommand({
      id: "search.quickOpen",
      title: t("文件名快开"),
      keybinding: "Cmd+P",
      run: () => openSearchOverlay("quickOpen"),
    });
  },
};
