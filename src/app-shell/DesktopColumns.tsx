/**
 * 桌面三栏布局(左 session 栏 / 中央幕布 / 文件预览 / 右文件面板,全部可拖)——
 * 自 AppShell 按「纯结构拆分 + 控制流复杂度」拆出;窄屏(手机)不走本组件。
 * 最大化语义:有 tab 时仅中央幕布零宽让位(.group-maximized 纯样式折叠,见
 * panel-handle.css),左右栏钉住实测宽度;幕布一律「样式折叠、永不卸载」——
 * 卸载会把 tab 条内全部 TerminalView 连 xterm 实例一起拆掉,还原时全量回放。
 * 右栏面板保活(仿 EditorCenter keepAlive):面板首次激活即常驻挂载,切换经
 * display:none 隐藏 —— 树位不换不卸载,展开态/滚动位/输入草稿跨切换存活;
 * 未访问过的面板不预挂(重面板零成本),右栏整体收起(rightOpen)仍整树卸载。
 */
import { useEffect, useState } from "react";
import { PanelActiveProvider } from "@kernel/panelActivity";
import { Group as PanelGroup, Panel, Separator as PanelResizeHandle, usePanelRef } from "react-resizable-panels";
import { Mounts } from "@kernel/Mounts";
import type { FilePanelContribution } from "@kernel/filePanel";
import { asideDragFactory, useElementWidth } from "./shellHooks";
import { SidebarSettingsCluster } from "./SidebarSettingsCluster";
import { EditorCenter } from "./EditorCenter";
import { MainPanel } from "./MainPanel";

export function DesktopColumns(props: {
  leftOpen: boolean;
  rightOpen: boolean;
  maximized: boolean;
  hasTabs: boolean;
  /** 注册表全量面板(kernel filePanel store;壳只渲染不认识业务面板)。 */
  filePanels: readonly FilePanelContribution[];
  /** 当前激活面板 id(渲染真值;失效 id 回落首注册项,同 AppShell 旧语义)。 */
  filePanelMode: string;
}) {
  const { leftOpen, rightOpen, maximized, hasTabs, filePanels, filePanelMode } = props;
  const leftAsideRef = useElementWidth("--tmd-left-aside-w", maximized);
  const rightAsideRef = useElementWidth("--tmd-right-aside-w", maximized);
  const leftPanelRef = usePanelRef();
  const rightPanelRef = usePanelRef();
  const startAsideDrag = asideDragFactory(maximized, leftPanelRef, rightPanelRef);

  /* 激活面板 = mode 命中项,回落首个注册项(面板拔出后 mode 可能悬空)。 */
  const mode = filePanels.some((p) => p.id === filePanelMode)
    ? filePanelMode
    : (filePanels[0]?.id ?? "");
  /* 保活清单(latched):激活过的面板 id,只增不减;插件拔出时渲染前按注册表
   * 过滤,陈旧 id 不再渲染。effect 落锁(而非渲染期写 ref):并发渲染丢弃的
   * 提交不得污染清单。 */
  const [latched, setLatched] = useState<ReadonlySet<string>>(() => new Set());
  useEffect(() => {
    if (!mode) return;
    setLatched((prev) => (prev.has(mode) ? prev : new Set(prev).add(mode)));
  }, [mode]);
  /* 注册表收缩时同步修剪保活集:防「拔出→同 id 重注册」被陈旧 latch 命中,
   * 违反「未访问不预挂」语义(评审 A2)。 */
  useEffect(() => {
    const ids = new Set(filePanels.map((p) => p.id));
    setLatched((prev) => {
      const next = new Set([...prev].filter((id) => ids.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [filePanels]);
  const keptPanels = filePanels.filter((p) => p.id === mode || latched.has(p.id));

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
              {/* 面板内容:按注册表路由,外壳不认识任何业务面板;保活集常驻挂载,
                  非激活 display:none(必须 flex 容器:内部 file-tree-panel 的
                  flex:1 才能拿到有界高度,否则列表无限长高被裁、永远滚不动)。 */}
              <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
                {keptPanels.map((panel) => {
                  const Content = panel.component;
                  const isActive = panel.id === mode;
                  return (
                    <div
                      key={panel.id}
                      data-panel-id={panel.id}
                      className={isActive ? "flex min-h-0 flex-1 flex-col" : "hidden"}
                      aria-hidden={!isActive}
                    >
                      {/* 面板活性注入:隐藏态轮询短路(panelActivity 契约) */}
                      <PanelActiveProvider value={isActive}>
                        <Content />
                      </PanelActiveProvider>
                    </div>
                  );
                })}
              </div>
              {/* 文件操作条已上移顶栏右区(TopBar titlebar-actions,2026-09-27) */}
            </aside>
          </Panel>
        </>
      )}
    </PanelGroup>
  );
}
