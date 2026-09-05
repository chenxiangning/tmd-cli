// AppShell 头部 titlebar(三区布局 + Windows 自绘窗口控件),自 AppShell.tsx 按「纯结构拆分、行为不变」拆出
import {
  Inbox,
  Plug,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
} from "lucide-react";
import { host } from "@kernel/host";
import { windowClose, windowMinimize, windowToggleMaximize } from "@kernel/ipc";
import { Mounts } from "@kernel/Mounts";
import { usePlatformKind } from "@kernel/platform";
import { TopBarPanelTabs } from "./RightPanelToolbar";

/** macOS 用原生左侧 traffic lights,Windows 自绘右侧按钮组;窗口控制经 kernel/ipc 薄封装。 */
function WindowControls() {
  const platform = usePlatformKind();
  if (platform !== "windows") return null;
  /* 浏览器 dev 无 Tauri runtime,ipc 窗口封装会抛错,必须在平台闸之后调用。 */
  return (
    <div className="titlebar-window-controls win-traffic-lights" aria-label="窗口控制">
      <button aria-label="最小化" title="最小化" className="win-traffic-light" onClick={() => void windowMinimize()}>
        <svg viewBox="0 0 10 10" stroke="currentColor" strokeWidth="1.5" fill="none"><line x1="1" y1="5" x2="9" y2="5" /></svg>
      </button>
      <button aria-label="最大化" title="最大化" className="win-traffic-light" onClick={() => void windowToggleMaximize()}>
        <svg viewBox="0 0 10 10" stroke="currentColor" strokeWidth="1.5" fill="none"><rect x="1" y="1" width="8" height="8" rx="1" /></svg>
      </button>
      <button aria-label="关闭" title="关闭" className="win-traffic-light close" onClick={() => void windowClose()}>
        <svg viewBox="0 0 10 10" stroke="currentColor" strokeWidth="1.5" fill="none"><line x1="1" y1="1" x2="9" y2="9" /><line x1="9" y1="1" x2="1" y2="9" /></svg>
      </button>
    </div>
  );
}

/**
 * 头部 —— codemoss 风格 33px titlebar,横向三区与下方三栏边界对齐:
 * - 左区:与左侧栏同宽(leftWidth 实测);macOS 红绿灯 inset 在左,折叠左栏按钮钉在左区最右缘
 * - 中区:项目面包屑靠左,占据剩余宽度
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
  /* 右区宽度换算:右栏宽 + 4px 手柄 - 12px 顶栏右 padding - Windows 自绘窗口控制区。
     Windows 额外扣 6px:WindowControls 入列后顶栏 flex gap 在 actions 与控制组之间
     生效(mac 无控制组无此 gap)。漏扣时右区 border-left 竖线比下方栏边界手柄线
     左移 6px,即 win 实测的"右侧竖线对不齐"。
     栏宽经 CSS 变量(--tmd-left/right-aside-w)消费:变量未写入时 var() 无效 → 宽度退化 auto,
     与旧 0=未测量/收起 行为一致;拖动期间不再触发本组件重渲染。 */
  const rightInset = platform === "windows" ? 122 : 0;
  return (
    <header className="titlebar" data-tauri-drag-region>
      {/* 左区域:与左侧栏同宽,折叠左栏按钮钉在左区最右缘(+4px 吞掉分隔手柄,与栏边界对齐) */}
      <div
        className={`titlebar-zone-left${leftOpen ? " is-expanded" : ""}`}
        data-tauri-drag-region
        style={leftOpen ? { width: "calc(var(--tmd-left-aside-w) + 4px)" } : undefined}
      >
        {platform === "macos" ? <div className="titlebar-leading" aria-hidden /> : null}
        <button
          type="button"
          className="titlebar-action"
          aria-label={leftOpen ? "收起左栏" : "展开左栏"}
          title={leftOpen ? "收起左栏" : "展开左栏"}
          onClick={onToggleLeft}
        >
          {leftOpen ? <PanelLeftClose size={14} aria-hidden /> : <PanelLeftOpen size={14} aria-hidden />}
        </button>
        {/* 插件市场(插排页):整页替换下方三栏,再点或页内关闭即回 */}
        <button
          type="button"
          className={`titlebar-action${marketOpen ? " is-active" : ""}`}
          aria-label="插件市场"
          title="插件市场"
          onClick={onToggleMarket}
        >
          <Plug size={14} aria-hidden />
        </button>
        {/* 入库(回 welcome):摘掉活跃 session 指针,MainPanel 兜底渲染 welcome;session 不删可唤回 */}
        <button
          type="button"
          className="titlebar-action"
          aria-label="回到首页"
          title="回到首页"
          onClick={() => host.setActiveSession(null)}
        >
          <Inbox size={14} aria-hidden />
        </button>
        {/* 插件贡献的左区按钮簇(内置终端等):经 activate(ctx) 挂点登记 */}
        <Mounts point="header.leftCluster" />
      </div>
      <div className="titlebar-center" data-tauri-drag-region>
        {/* 项目面包屑:中间区域靠左(codemoss 布局) */}
        <Mounts point="header.breadcrumb" />
        <Mounts point="header.left" />
      </div>
      <div
        className={`titlebar-actions${rightOpen ? " is-expanded" : ""}`}
        data-tauri-drag-region
        style={rightOpen ? { width: `max(calc(var(--tmd-right-aside-w) - ${8 + rightInset}px), 0px)` } : undefined}
      >
        {/* 折叠/展开右侧栏 */}
        <button
          type="button"
          className="titlebar-action"
          aria-label={rightOpen ? "收起右栏" : "展开右栏"}
          title={rightOpen ? "收起右栏" : "展开右栏"}
          onClick={onToggleRight}
        >
          {rightOpen ? <PanelRightClose size={14} aria-hidden /> : <PanelRightOpen size={14} aria-hidden />}
        </button>
        <TopBarPanelTabs />
        <Mounts point="header.right" />
      </div>
      <WindowControls />
    </header>
  );
}
