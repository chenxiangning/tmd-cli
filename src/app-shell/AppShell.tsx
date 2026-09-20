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

import { useCallback, useEffect, useState, type PointerEvent as ReactPointerEvent } from "react";
import { Group as PanelGroup, Panel, Separator as PanelResizeHandle, usePanelRef } from "react-resizable-panels";
import { useHost } from "@kernel/host";
import { Mounts } from "@kernel/Mounts";
import { useEditorTabs } from "@kernel/tabs";
import { useFilePanel } from "@kernel/filePanel";
import { usePlatformKind } from "@kernel/platform";
import { EditorCenter } from "./EditorCenter";
import { RightPanelToolbar } from "./RightPanelToolbar";
import { SidebarSettingsCluster } from "./SidebarSettingsCluster";
import { PluginMarketPage } from "./PluginMarketPage";
import { StartFailureToast } from "./StartFailureToast";
import { useEditorMaximized } from "./editorMaximized";
import { shellBarToggles, shellLeftEnsureOpen, shellMarketClose, shellMarketToggle } from "./shortcutCommands";
import { installShortcutDispatcher } from "@kernel/shortcuts";
import { useElementWidth, usePersistedToggle } from "./shellHooks";
import { MainPanel } from "./MainPanel";
import { TopBar } from "./TopBar";

export function AppShell() {
  useHost();
  const platform = usePlatformKind();
  const { mode: filePanelMode, panels: filePanels } = useFilePanel();
  /* 激活面板 = mode 命中项,回落首个注册项(插件 activate 顺序) */
  const activeFilePanel =
    filePanels.find((p) => p.id === filePanelMode) ?? filePanels[0];
  const [leftOpen, toggleLeft, setLeftOpen] = usePersistedToggle("shell.left", true);
  const [rightOpen, toggleRight] = usePersistedToggle("shell.right", true);
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
  const leftAsideRef = useElementWidth("--tmd-left-aside-w", maximized);
  const rightAsideRef = useElementWidth("--tmd-right-aside-w", maximized);
  const leftPanelRef = usePanelRef();
  const rightPanelRef = usePanelRef();
  /* 最大化下的侧栏拖拽:钉宽(!important flex-basis = var)压住库行内布局,库原生
     拖拽只改内部布局、视觉纹丝不动,故最大化时三条 handle 全 disabled(库在组级
     原生捕获监听,React stopPropagation 拦不到),改由这里手动驱动双通道:
     var 直写(钉宽即时跟随)+ panelRef.resize(库内部布局同步,还原后拖拽
     结果保留)。非最大化不拦截,走库原生拖拽。 */
  const startAsideDrag = (e: ReactPointerEvent, side: "left" | "right") => {
    if (!maximized) return;
    e.preventDefault();
    const varName = side === "left" ? "--tmd-left-aside-w" : "--tmd-right-aside-w";
    const panel = (side === "left" ? leftPanelRef : rightPanelRef).current;
    const startX = e.clientX;
    const startW = parseFloat(getComputedStyle(document.documentElement).getPropertyValue(varName)) || 240;
    const sign = side === "left" ? 1 : -1;
    const onMove = (ev: PointerEvent) => {
      const w = Math.round(startW + sign * (ev.clientX - startX));
      const clamped = Math.min(Math.max(160, w), Math.round(window.innerWidth * 0.6));
      document.documentElement.style.setProperty(varName, `${clamped}px`);
      panel?.resize(clamped);
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };
  /* 经典滚动条会吃掉滚动容器的内容宽度:实测一次,供顶栏折叠按钮让位对齐。 */
  useEffect(() => {
    const probe = document.createElement("div");
    probe.style.cssText =
      "position:absolute;top:-99px;left:-99px;width:100px;height:100px;overflow:scroll";
    document.body.appendChild(probe);
    document.documentElement.style.setProperty(
      "--tmd-scrollbar-w",
      `${probe.offsetWidth - probe.clientWidth}px`,
    );
    probe.remove();
  }, []);

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

  return (
    <div className={`app ${platform}-desktop flex h-screen w-screen flex-col bg-(--tmd-bg-base) text-(--tmd-fg)`}>
      <TopBar
        onToggleLeft={toggleLeft}
        onToggleRight={toggleRight}
        leftOpen={leftOpen}
        rightOpen={rightOpen}
        marketOpen={marketOpen}
        onToggleMarket={toggleMarket}
      />
      {/* 插件市场为不透明覆盖层,三栏保持挂载且可见地留在下层:会话现场/文件
          tab/分栏尺寸零回放零重排;也不可 display:none 隐藏三栏 —— 顶栏左右区
          宽度实测自侧栏(useElementWidth 写 CSS 变量),隐藏后 RO 上报 0 会把
          顶栏 icon 挤叠。市场页实底背景,盖住下层即可。 */}
      <div className="relative min-h-0 flex-1">
        <PanelGroup orientation="horizontal" id="tmd.outer" className={maximized ? "group-maximized" : undefined}>
        {/* 左侧 session 栏:leftOpen 独占挂载开关,最大化不折叠(钉宽不动) */}
        {leftOpen && (
          <>
            <Panel defaultSize={18} minSize={12} id="left" panelRef={leftPanelRef}>
              <aside ref={leftAsideRef} className="flex h-full flex-col">
                <div className="min-h-0 flex-1 overflow-auto">
                  <Mounts point="leftSidebar.section" />
                </div>
                {/* 左下角:设置齿轮 + pinned 快捷 + 版本号(复刻 codemoss) */}
                <SidebarSettingsCluster />
              </aside>
            </Panel>
            <PanelResizeHandle className="panel-handle panel-handle-v panel-handle-line-r" disabled={maximized} />
          </>
        )}

        {/* 中央幕布:始终挂载,最大化经 .group-maximized 零宽折叠(不卸载) */}
        <Panel defaultSize={tabs.length > 0 ? 24 : 60} minSize={15} id="center">
          <MainPanel />
        </Panel>

        {/* 文件预览:有打开 tab 时出现,占满竖屏,位于中栏与右栏之间(可拖) */}
        {tabs.length > 0 && (
          <>
            <PanelResizeHandle className="panel-handle panel-handle-v panel-handle-line-l" disabled={maximized} onPointerDownCapture={(e) => startAsideDrag(e, "left")} />
            <Panel defaultSize={36} minSize={15} id="editor">
              <EditorCenter />
            </Panel>
          </>
        )}

        {/* 右文件面板:最大化时不参与隐藏(用户微调:文件树保持可见) */}
        {rightOpen && (
          <>
            <PanelResizeHandle className="panel-handle panel-handle-v panel-handle-line-l" disabled={maximized} onPointerDownCapture={(e) => startAsideDrag(e, "right")} />
            <Panel defaultSize={22} minSize={12} id="right" panelRef={rightPanelRef}>
              <aside ref={rightAsideRef} className="flex h-full flex-col">
                {/* 面板内容:按注册表路由,外壳不认识任何业务面板 */}
                <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
                  {/* 必须 flex 容器:内部 file-tree-panel 的 flex:1 才能拿到有界高度,
                      否则文件树内容无限长高被裁掉,列表永远滚不动。 */}
                  {activeFilePanel ? <activeFilePanel.component /> : null}
                </div>
                {/* 底部文件操作条(新建/刷新/面板动作;工作区选择器已上移顶栏) */}
                <RightPanelToolbar />
              </aside>
            </Panel>
          </>
        )}
      </PanelGroup>
        {marketOpen && (
          <div className="absolute inset-0 z-50">
            <PluginMarketPage onClose={() => setMarketOpen(false)} />
          </div>
        )}
      </div>

      <Mounts point="overlay" />
      {/* 会话启动失败通知:进程秒退静默闪退的兜底呈现(见 kernel/sessionSpawn.ts) */}
      <StartFailureToast />
    </div>
  );
}
