// AppShell 头部 titlebar(三区布局 + Windows 自绘窗口控件),自 AppShell.tsx 按「纯结构拆分、行为不变」拆出
import { Tray, Plug, CaretLineLeft, CaretLineRight } from "@phosphor-icons/react";
import { t } from "@kernel/i18n";
import { windowClose, windowMinimize, windowToggleMaximize } from "@kernel/ipc";
import { Mounts } from "@kernel/Mounts";
import { usePlatformKind } from "@kernel/platform";
import { toggleHomeSession } from "./shortcutCommands";
import { TopBarPanelTabs } from "./RightPanelToolbar";

/** macOS 用原生左侧 traffic lights,Windows 自绘右侧按钮组;窗口控制经 kernel/ipc 薄封装。 */
function WindowControls() {
  const platform = usePlatformKind();
  if (platform !== "windows") return null;
  /* 浏览器 dev 无 Tauri runtime,ipc 窗口封装会抛错,必须在平台闸之后调用。 */
  return (
    <div className="titlebar-window-controls win-traffic-lights" aria-label={t("窗口控制")}>
      <button aria-label={t("最小化")} title={t("最小化")} className="win-traffic-light" onClick={() => void windowMinimize()}>
        <svg viewBox="0 0 10 10" stroke="currentColor" strokeWidth="1.5" fill="none"><line x1="1" y1="5" x2="9" y2="5" /></svg>
      </button>
      <button aria-label={t("最大化")} title={t("最大化")} className="win-traffic-light" onClick={() => void windowToggleMaximize()}>
        <svg viewBox="0 0 10 10" stroke="currentColor" strokeWidth="1.5" fill="none"><rect x="1" y="1" width="8" height="8" rx="1" /></svg>
      </button>
      <button aria-label={t("关闭")} title={t("关闭")} className="win-traffic-light close" onClick={() => void windowClose()}>
        <svg viewBox="0 0 10 10" stroke="currentColor" strokeWidth="1.5" fill="none"><line x1="1" y1="1" x2="9" y2="9" /><line x1="9" y1="1" x2="1" y2="9" /></svg>
      </button>
    </div>
  );
}

/**
 * 头部 —— codemoss 风格 33px titlebar,横向三区与下方三栏边界对齐:
 * - 左区:与左侧栏同宽(leftWidth 实测);macOS 红绿灯 inset 在左,折叠左栏按钮钉在左区最右缘
 * - 中区:会话/编辑 tab 条靠左,占据剩余宽度
 * - 右区:与右侧栏同宽(rightWidth 实测);折叠右栏按钮钉在右区最左缘,其余 icons 保持右对齐
 */
export function TopBar({
  onToggleLeft,
  onToggleRight,
  leftOpen,
  rightOpen,
  marketOpen,
  onToggleMarket,
}: {
  onToggleLeft: () => void;
  onToggleRight: () => void;
  leftOpen: boolean;
  rightOpen: boolean;
  marketOpen: boolean;
  onToggleMarket: () => void;
}) {
  const platform = usePlatformKind();
  /* 回首页按钮 = 固定身份的纯 toggle:永远显示「回到首页」,点一下开首页,
     再点一下切回打开首页之前的会话(toggle 记忆在 shortcutCommands);
     市场覆盖层盖着首页,回首页前先收掉,否则切换在底下发生屏上无变化。 */
  const goHome = () => {
    if (marketOpen) onToggleMarket();
    toggleHomeSession();
  };
  return (
    <header className="titlebar" data-tauri-drag-region>
      {/* 左区域:与左侧栏同宽,折叠左栏按钮钉在左区最右缘(+4px 吞掉分隔手柄,与栏边界对齐) */}
      <div
        className={`titlebar-zone-left${leftOpen ? " is-expanded" : ""}`}
        data-tauri-drag-region
        style={leftOpen ? { width: "calc(var(--tmd-left-aside-w) + 4px)" } : undefined}
      >
        {platform === "macos" ? <div className="titlebar-leading" aria-hidden /> : null}
        {/* 插件贡献的左区按钮簇(内置终端等):经 activate(ctx) 挂点登记 */}
        <Mounts point="header.leftCluster" />
        {/* 插件市场(插排页):整页替换下方三栏,再点或页内关闭即回 */}
        <button
          type="button"
          className={`titlebar-action${marketOpen ? " is-active" : ""}`}
          aria-label={t("插件市场")}
          data-hint={t("插件市场")}
          data-hint-cmd="shell.openMarket"
          title=""
          onClick={onToggleMarket}
        >
          <Plug size="0.875rem" aria-hidden />
        </button>
        <button
          type="button"
          className="titlebar-action"
          aria-label={t("回到首页")}
          data-hint={t("回到首页")}
          data-hint-cmd="shell.goHome"
          title=""
          onClick={goHome}
        >
          <Tray size="0.875rem" aria-hidden />
        </button>
        <button
          type="button"
          className="titlebar-action"
          aria-label={t(leftOpen ? "收起左栏" : "展开左栏")}
          data-hint={t(leftOpen ? "收起左栏" : "展开左栏")}
          data-hint-cmd="shell.toggleLeftBar"
          title=""
          onClick={onToggleLeft}
        >
          {leftOpen ? <CaretLineLeft size="0.875rem" aria-hidden /> : <CaretLineRight size="0.875rem" aria-hidden />}
        </button>
      </div>
      <div className="titlebar-center" data-tauri-drag-region>
        {/* 会话/编辑 tab 条:中间区域靠左 */}
        <Mounts point="header.breadcrumb" />
        <Mounts point="header.left" />
      </div>
      <div
        className={`titlebar-actions${rightOpen ? " is-expanded" : ""}`}
        data-tauri-drag-region
      >
        {/* 折叠/展开右侧栏 */}
        <button
          type="button"
          className="titlebar-action"
          aria-label={t(rightOpen ? "收起右栏" : "展开右栏")}
          data-hint={t(rightOpen ? "收起右栏" : "展开右栏")}
          data-hint-cmd="shell.toggleRightBar"
          title=""
          onClick={onToggleRight}
        >
          {rightOpen ? <CaretLineRight size="0.875rem" aria-hidden /> : <CaretLineLeft size="0.875rem" aria-hidden />}
        </button>
        <TopBarPanelTabs />
        <Mounts point="header.right" />
      </div>
      <WindowControls />
    </header>
  );
}
