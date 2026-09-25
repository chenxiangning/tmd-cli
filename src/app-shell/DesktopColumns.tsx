/**
 * 桌面三栏布局(左 session 栏 / 中央幕布 / 文件预览 / 右文件面板,全部可拖)——
 * 自 AppShell 按「纯结构拆分 + 控制流复杂度」拆出;窄屏(手机)不走本组件。
 * 最大化语义:有 tab 时仅中央幕布零宽让位(.group-maximized 纯样式折叠,见
 * panel-handle.css),左右栏钉住实测宽度;幕布一律「样式折叠、永不卸载」——
 * 卸载会把 tab 条内全部 TerminalView 连 xterm 实例一起拆掉,还原时全量回放。
 */
import { Group as PanelGroup, Panel, Separator as PanelResizeHandle, usePanelRef } from "react-resizable-panels";
import { Mounts } from "@kernel/Mounts";
import type { FilePanelContribution } from "@kernel/filePanel";
import { asideDragFactory, useElementWidth } from "./shellHooks";
import { SidebarSettingsCluster } from "./SidebarSettingsCluster";
import { RightPanelToolbar } from "./RightPanelToolbar";
import { EditorCenter } from "./EditorCenter";
import { MainPanel } from "./MainPanel";

export function DesktopColumns(props: {
  leftOpen: boolean;
  rightOpen: boolean;
  maximized: boolean;
  hasTabs: boolean;
  filePanel: FilePanelContribution | undefined;
}) {
  const { leftOpen, rightOpen, maximized, hasTabs, filePanel } = props;
  const leftAsideRef = useElementWidth("--tmd-left-aside-w", maximized);
  const rightAsideRef = useElementWidth("--tmd-right-aside-w", maximized);
  const leftPanelRef = usePanelRef();
  const rightPanelRef = usePanelRef();
  const startAsideDrag = asideDragFactory(maximized, leftPanelRef, rightPanelRef);
  return (
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
      <Panel defaultSize={hasTabs ? 24 : 60} minSize={15} id="center">
        <MainPanel />
      </Panel>

      {/* 文件预览:有打开 tab 时出现,占满竖屏,位于中栏与右栏之间(可拖) */}
      {hasTabs && (
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
                {filePanel ? <filePanel.component /> : null}
              </div>
              {/* 底部文件操作条(新建/刷新/面板动作;工作区选择器已上移顶栏) */}
              <RightPanelToolbar />
            </aside>
          </Panel>
        </>
      )}
    </PanelGroup>
  );
}
