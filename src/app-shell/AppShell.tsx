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
import { Group as PanelGroup, Panel, Separator as PanelResizeHandle } from "react-resizable-panels";
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
import { shellBarToggles, shellLeftEnsureOpen, shellMarketToggle } from "./shortcutCommands";
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
  /* 插件市场页开关:打开时整页替换下方三栏(session 现场不丢,关掉即回)。 */
  const [marketOpen, setMarketOpen] = useState(false);
  const toggleMarket = useCallback(() => setMarketOpen((v) => !v), []);
  const { tabs } = useEditorTabs();
  /* 编辑区最大化(editorMaximized store,持久化):有 tab 时隐藏左栏与中央幕布,
     编辑区 + 右文件面板并占通栏(右栏不参与);无 tab 时标志不生效。 */
  const maximized = useEditorMaximized() && tabs.length > 0;
  const leftAsideRef = useElementWidth("--tmd-left-aside-w");
  const rightAsideRef = useElementWidth("--tmd-right-aside-w");
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
    shellLeftEnsureOpen.current = () => setLeftOpen(true);
    return () => {
      shellBarToggles.left = null;
      shellBarToggles.right = null;
      shellMarketToggle.current = null;
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
      {marketOpen ? (
        <PluginMarketPage onClose={() => setMarketOpen(false)} />
      ) : (

      <PanelGroup orientation="horizontal" id="tmd.outer">
        {/* 左侧 session 栏 */}
        {!maximized && leftOpen && (
          <>
            <Panel defaultSize={18} minSize={12} id="left">
              <aside ref={leftAsideRef} className="flex h-full flex-col">
                <div className="min-h-0 flex-1 overflow-auto">
                  <Mounts point="leftSidebar.section" />
                </div>
                {/* 左下角:设置齿轮 + pinned 快捷 + 版本号(复刻 codemoss) */}
                <SidebarSettingsCluster />
              </aside>
            </Panel>
            <PanelResizeHandle className="panel-handle panel-handle-v panel-handle-line-r" />
          </>
        )}

        {/* 中央幕布 */}
        {!maximized && (
        <Panel defaultSize={tabs.length > 0 ? 24 : 60} minSize={15} id="center">
          <MainPanel />
        </Panel>
        )}

        {/* 文件预览:有打开 tab 时出现,占满竖屏,位于中栏与右栏之间(可拖) */}
        {tabs.length > 0 && (
          <>
            {!maximized && (
              <PanelResizeHandle className="panel-handle panel-handle-v panel-handle-line-l" />
            )}
            <Panel defaultSize={36} minSize={15} id="editor">
              <EditorCenter />
            </Panel>
          </>
        )}

        {/* 右文件面板:最大化时不参与隐藏(用户微调:文件树保持可见) */}
        {rightOpen && (
          <>
            <PanelResizeHandle className="panel-handle panel-handle-v panel-handle-line-l" />
            <Panel defaultSize={22} minSize={12} id="right">
              <aside ref={rightAsideRef} className="flex h-full flex-col">
                {/* 顶部 toolbar:右侧面板控制器(folder/git/...) */}
                <RightPanelToolbar />
                {/* 面板内容:按注册表路由,外壳不认识任何业务面板 */}
                <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
                  {/* 必须 flex 容器:内部 file-tree-panel 的 flex:1 才能拿到有界高度,
                      否则文件树内容无限长高被裁掉,列表永远滚不动。 */}
                  {activeFilePanel ? <activeFilePanel.component /> : null}
                </div>
              </aside>
            </Panel>
          </>
        )}
      </PanelGroup>
      )}

      <Mounts point="overlay" />
      {/* 会话启动失败通知:进程秒退静默闪退的兜底呈现(见 kernel/sessionSpawn.ts) */}
      <StartFailureToast />
    </div>
  );
}
