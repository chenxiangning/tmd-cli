// AppShell 头部 titlebar(三区布局 + Windows 自绘窗口控件),自 AppShell.tsx 按「纯结构拆分、行为不变」拆出
import { CaretLineLeft, CaretLineRight } from "@phosphor-icons/react";
import { t } from "@kernel/i18n";
import { windowClose, windowMinimize, windowToggleMaximize } from "@kernel/ipc";
import { Mounts } from "@kernel/Mounts";
import { usePlatformKind } from "@kernel/platform";
import { TitlebarBranchLabel, WorkspaceSwitcher } from "./WorkspaceSwitcher";

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
 * - 左区:左缘 rail 宽 + 左侧栏宽(实测);macOS 红绿灯 inset 在左,折叠左栏按钮钉在左区最右缘
 * - 中区:会话/编辑 tab 条靠左,占据剩余宽度
 * - 右区:与右侧栏同宽(rightWidth 实测);折叠右栏按钮钉在右区最左缘,其余 icons 保持右对齐
 * 插件市场/回到首页/会话看板入口已迁左缘 LeftRail(2026-10-04 用户口径),
 * 顶栏左区只留插件挂点(header.leftCluster)+ 折叠左栏。
 */
export function TopBar({
  onToggleLeft,
  onToggleRight,
  leftOpen,
  rightOpen,
}: {
  onToggleLeft: () => void;
  onToggleRight: () => void;
  leftOpen: boolean;
  rightOpen: boolean;
}) {
  const platform = usePlatformKind();
  return (
    <header className="titlebar" data-tauri-drag-region>
      {/* 左区域:左缘 rail 宽 + 左侧栏宽(实测),折叠左栏按钮钉在左区最右缘
          (+4px 吞掉分隔手柄,与栏边界对齐;rail 常驻,公式恒含其宽) */}
      <div
        className={`titlebar-zone-left${leftOpen ? " is-expanded" : ""}`}
        data-tauri-drag-region
        style={leftOpen ? { width: "calc(var(--tmd-left-aside-w) + var(--tmd-rail-w) + 4px)" } : undefined}
      >
        {platform === "macos" ? <div className="titlebar-leading" aria-hidden /> : null}
        {/* 插件贡献的左区按钮簇(远程控制徽标等):经 activate(ctx) 挂点登记;
            会话看板/插件市场/回到首页已迁左缘 LeftRail(2026-10-04) */}
        <Mounts point="header.leftCluster" />
        <button
          type="button"
          className="titlebar-action"
          aria-label={t(leftOpen ? "收起左栏" : "展开左栏")}
          data-hint={t(leftOpen ? "收起左栏" : "展开左栏")}
          data-hint-cmd="shell.toggleLeftBar"
          title=""
          onClick={onToggleLeft}
        >
          {leftOpen ? <CaretLineLeft size="0.875rem" aria-hidden data-action-id="fold-left" /> : <CaretLineRight size="0.875rem" aria-hidden data-action-id="fold-left" />}
        </button>
      </div>
      <div className="titlebar-center" data-tauri-drag-region>
        {/* 会话/编辑 tab 条:中间区域靠左 */}
        <Mounts point="header.breadcrumb" />
        <Mounts point="header.left" />
        {/* 分支 label:中区右缘(margin-left:auto 钉边),自取活动工作区 */}
        <TitlebarBranchLabel />
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
          {rightOpen ? <CaretLineRight size="0.875rem" aria-hidden data-action-id="fold-right" /> : <CaretLineLeft size="0.875rem" aria-hidden data-action-id="fold-right" />}
        </button>
        {/* 工作区选择器(自右栏 subbar 上移):折叠钮之后;面板 tabs 已迁右缘 PanelRail。
            文件操作条已下放面板头工具条(FileTreeToolbar,2026-10-02),顶栏右区只剩
            折叠钮 + 工作区选择器 + 插件挂点,余白保留拖拽。 */}
        <WorkspaceSwitcher />
        <Mounts point="header.right" />
      </div>
      <WindowControls />
    </header>
  );
}
