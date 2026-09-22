/**
 * 客户端主页外壳 —— 横向多栏可拖布局(文件预览为条件通栏) + composer 高度可拖 + 顶栏 macOS 融合。
 *
 * 布局(横向最多 4 栏,全部可拖):
 * ┌────────────────────────────────────────────────────────┐
 * │ 头部(macOS 红黄绿 + 面包屑 + 挂点)                       │
 * ├──────────┬───────────────────┬───────────┬─────────────┤
 * │ session  │  幕布(terminal)  │           │  files      │
 * │ (可拖)   │  ─────────────  │  文件预览  │  (可拖)     │
 * │          │  composer       │ (占满竖屏) │             │
 * ├──────────┴───────────────────┴───────────┴─────────────┤
 * │ 底部状态栏                                              │
 * └────────────────────────────────────────────────────────┘
 *
 * 关键不变量:
 * - 无左右 rail(用户要求去掉)
 * - 三栏都挂 react-resizable-panels,可拖
 * - composer 高度可拖(PanelResizeHandle)
 * - 文件 tab 与会话独立:无 session 也能打开文件
 * - SessionList/TopBar 面包屑等通过挂点贡献(见 contributions.tsx),非硬编码
 */

import { useCallback, useEffect, useState } from "react";
import { host, useHost } from "@kernel/host";
import { Mounts } from "@kernel/Mounts";
import { useEditorTabs } from "@kernel/tabs";
import { useFilePanel } from "@kernel/filePanel";
import { usePlatformKind } from "@kernel/platform";
import { DesktopColumns } from "./DesktopColumns";
import { PluginMarketPage } from "./PluginMarketPage";
import { StartFailureToast } from "./StartFailureToast";
import { SettingsPersistToast } from "./SettingsPersistToast";
import { useEditorMaximized } from "./editorMaximized";
import { shellBarToggles, shellLeftEnsureOpen, shellMarketClose, shellMarketToggle } from "./shortcutCommands";
import { installShortcutDispatcher } from "@kernel/shortcuts";
import { useIsNarrow } from "@kernel/uiBreakpoint";
import { usePersistedToggle, useScrollbarProbe, useViewportHeight } from "./shellHooks";
import { MainPanel } from "./MainPanel";
import { RemoteHostBar } from "./RemoteHostBar";
import { NarrowDrawer } from "./NarrowDrawer";
import { TopBar } from "./TopBar";
import { isRemote } from "@kernel/transport";
import { AskFloatingBadge, AskNotifier } from "./AskMobile";

export function AppShell() {
  useHost();
  const platform = usePlatformKind();
  const { mode: filePanelMode, panels: filePanels } = useFilePanel();
  /* 激活面板 = mode 命中项,回落首个注册项(插件 activate 顺序) */
  const activeFilePanel =
    filePanels.find((p) => p.id === filePanelMode) ?? filePanels[0];
  const [leftOpen, toggleLeft, setLeftOpen] = usePersistedToggle("shell.left", true);
  const [rightOpen, toggleRight] = usePersistedToggle("shell.right", true);
  /* 窄屏(手机):单栏 + 左栏抽屉;桌面专属栏(文件预览/右文件面板)隐藏。 */
  const narrow = useIsNarrow();
  const [drawerOpen, setDrawerOpen] = useState(false);
  /* 窄屏抽屉联动:抽屉里选中会话(活跃指针移动)即收起 —— 否则抽屉盖着幕布。 */
  const activeSessionId = host.getActiveSessionId();
  useEffect(() => {
    if (activeSessionId) setDrawerOpen(false);
  }, [activeSessionId]);
  /* 插件市场页开关:打开时以不透明覆盖层盖住三栏(见下方 JSX 注释),关掉零回放即回。 */
  const [marketOpen, setMarketOpen] = useState(false);
  const toggleMarket = useCallback(() => setMarketOpen((v) => !v), []);
  const { tabs } = useEditorTabs();
  /* 编辑区最大化(editorMaximized store,持久化):有 tab 时仅中央幕布零宽
     让位(.group-maximized 纯样式折叠,见 panel-handle.css),左栏与右栏钉住
     实测宽度 —— 编辑区只在中间区域撑满;无 tab 时标志不生效。
     幕布一律「样式折叠、永不卸载」:卸载会把 tab 条内全部 TerminalView
     连 xterm 实例一起拆掉,还原时全量回放输出缓冲(大会话秒级「加载会话输出」
     遮罩);折叠是纯尺寸变化,幕布现场零回放,还原后分栏尺寸逐位复原。 */
  const maximized = useEditorMaximized() && tabs.length > 0;
  useScrollbarProbe();
  useViewportHeight();

  /* 全局快捷键分发器:挂载期安装一次,卸载退订;命令本体在 ./shortcutCommands 模块级注册。 */
  useEffect(() => installShortcutDispatcher(), []);
  /* 栏折叠是组件局部状态:经 ref 桥喂给模块级命令(同 TerminalView 的 findRequestRef)。 */
  useEffect(() => {
    shellBarToggles.left = toggleLeft;
    shellBarToggles.right = toggleRight;
    shellMarketToggle.current = toggleMarket;
    shellMarketClose.current = () => setMarketOpen(false);
    shellLeftEnsureOpen.current = () => setLeftOpen(true);
    return () => {
      shellBarToggles.left = null;
      shellBarToggles.right = null;
      shellMarketToggle.current = null;
      shellMarketClose.current = null;
      shellLeftEnsureOpen.current = null;
    };
  }, [toggleLeft, toggleRight, toggleMarket, setLeftOpen]);

  const shell = (
    <div
      className={`app ${platform}-desktop flex h-screen w-screen flex-col bg-(--tmd-bg-base) text-(--tmd-fg)`}
      style={narrow ? { height: "var(--tmd-vvh, 100dvh)" } : undefined}
    >
      <TopBar
        onToggleLeft={narrow ? () => setDrawerOpen((v) => !v) : toggleLeft}
        onToggleRight={toggleRight}
        leftOpen={narrow ? drawerOpen : leftOpen}
        rightOpen={narrow ? false : rightOpen}
        marketOpen={marketOpen}
        onToggleMarket={toggleMarket}
        hideRightToggle={narrow}
      />
      {/* 移动壳:主机状态条(连接态/重试);桌面态不渲染 */}
      {narrow && isRemote() && <RemoteHostBar />}
      {/* 插件市场为不透明覆盖层,三栏保持挂载且可见地留在下层:会话现场/文件
          tab/分栏尺寸零回放零重排;也不可 display:none 隐藏三栏 —— 顶栏左右区
          宽度实测自侧栏(useElementWidth 写 CSS 变量),隐藏后 RO 上报 0 会把
          顶栏 icon 挤叠。市场页实底背景,盖住下层即可。 */}
      <div className="relative min-h-0 flex-1">
        {narrow ? (
          /* 窄屏单栏:中央幕布占满;左栏成抽屉(遮罩覆盖层),桌面专属栏隐藏。
             幕布与桌面共用同一 MainPanel 实例树 —— 切栏不卸载,xterm 零回放。 */
          <div className="h-full w-full">
            <MainPanel />
          </div>
        ) : (
          <DesktopColumns
            leftOpen={leftOpen}
            rightOpen={rightOpen}
            maximized={maximized}
            hasTabs={tabs.length > 0}
            filePanel={activeFilePanel}
          />
        )}
        {narrow && drawerOpen && <NarrowDrawer onClose={() => setDrawerOpen(false)} />}
        {marketOpen && (
          <div className="absolute inset-0 z-50">
            <PluginMarketPage onClose={() => setMarketOpen(false)} />
          </div>
        )}
      </div>

      <Mounts point="overlay" />
      {/* 窄屏审批浮标 + 等待边沿本地通知(壳态;桌面态 no-op) */}
      <AskFloatingBadge />
      <AskNotifier />
      {/* 会话启动失败通知:进程秒退静默闪退的兜底呈现(见 kernel/sessionSpawn.ts) */}
      <SettingsPersistToast />
      <StartFailureToast />
    </div>
  );
  return shell;
}
