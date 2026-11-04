/**
 * search 插件入口 —— 三作用域统一搜索壳(D-03):
 * - ⇧⌘F 全文搜索面板(回车触发,结果按文件分组折叠,点击 openFileAtLine 跳行)
 * - ⌘P 文件名快开(fsWalkFiles + 自写 fuzzy 打分,目录项不进)
 * - ⌘O 会话历史检索(search 启用时为唯一入口,本体由 session-search 插件供给)
 * 三命令共用一个居中浮层(overlay 挂点);Esc/遮罩关闭在浮层壳统一处理
 * (全局快捷键系统禁注册 Esc,故走浮层自身 onKeyDown)。session-search 禁用时
 * sessions 域不可达(命令即缺席,壳内防御性不渲染);search 禁用时会话检索
 * 回退到 session-search 原壳,不存在双遮罩。
 */
import { createPortal } from "react-dom";
import { MagnifyingGlass } from "@phosphor-icons/react";
import type { Plugin } from "@kernel/plugin";
import { t } from "@kernel/i18n";
import { SearchPanel } from "./SearchPanel";
import { QuickOpen } from "./QuickOpen";
import { SearchHubEntry } from "./HubEntry";
import { closeSearchOverlay, openSearchOverlay, useSearchOverlay } from "./overlayStore";
import { SessionsBody } from "./SessionsBody";
import { SessionSearchToast } from "@plugins/session-search/SearchBody";
import "./locales"; /* 域词典随插件自带:import 即注册 */

/** 浮层壳:遮罩 + 居中定位 + Esc 收起;面板本体按当前 kind 三选一。 */
function SearchOverlay() {
  const kind = useSearchOverlay();
  return createPortal(
    <>
      {/* 全屏容器统一收 Esc 与遮罩点击(自靶判定):独立捕获层会被容器整体
          遮蔽成死代码,故不设(2026-09-26 审查修正)。 */}
      {kind && (
        <div
          role="presentation"
          className="fixed inset-0 z-[1201] flex items-start justify-center bg-black/45 px-4 pt-[12vh]"
          data-icon-decor="search"
          onClick={(e) => {
            if (e.target === e.currentTarget) closeSearchOverlay();
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape" && !e.nativeEvent.isComposing) closeSearchOverlay();
          }}
        >
          {kind === "panel" ? <SearchPanel /> : kind === "quickOpen" ? <QuickOpen /> : <SessionsBody />}
        </div>
      )}
      {/* 会话检索定位轻提示常驻壳层:关壳后异步定位回调仍可呈现。 */}
      <SessionSearchToast />
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
    /* 统一搜索折叠入口:左栏顶部(order -1,学堂 -2 之下),让三个搜索能力可被发现。 */
    ctx.contribute("leftSidebar.section", { order: -1, component: SearchHubEntry });
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
