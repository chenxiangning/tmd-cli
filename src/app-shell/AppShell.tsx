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

import { useCallback, useEffect, useRef, useState } from "react";
import { Group as PanelGroup, Panel, Separator as PanelResizeHandle, useGroupRef } from "react-resizable-panels";
import {
  Inbox,
  Plug,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
} from "lucide-react";
import { host, useHost } from "@kernel/host";
import {
  COMPOSER_RESIZE_STEP,
  COMPOSER_STAGE_SIZE,
  useComposerStage,
} from "@kernel/composerStage";
import { windowClose, windowMinimize, windowToggleMaximize } from "@kernel/ipc";
import { Mounts } from "@kernel/Mounts";
import { TerminalView } from "@kernel/TerminalView";
import { useEditorTabs } from "@kernel/tabs";
import { useFilePanel } from "@kernel/filePanel";
import { usePlatformKind } from "@kernel/platform";
import { EditorCenter } from "./EditorCenter";
import { RightPanelToolbar, TopBarPanelTabs } from "./RightPanelToolbar";
import { SidebarSettingsCluster } from "./SidebarSettingsCluster";
import { PluginMarketPage } from "./PluginMarketPage";
import { useEditorMaximized } from "./editorMaximized";

function usePersistedToggle(key: string, initial: boolean) {
  const [open, setOpen] = useState(
    () => localStorage.getItem(key) !== "0" && initial,
  );
  useEffect(() => {
    localStorage.setItem(key, open ? "1" : "0");
  }, [key, open]);
  return [open, () => setOpen((v) => !v)] as const;
}
/**
 * 测量元素宽度并直写 CSS 变量(随拖动实时更新)。
 * 直写 var 而非 setState:分栏拖动每帧触发,避免顶栏整树重渲染(顶栏经 var() 消费);
 * 元素卸载时移除变量 —— 消费端 var() 无回退即 computed-value 无效,退化 auto(= 旧 0=未测量语义)。
 */
function useElementWidth(cssVar: string) {
  const observerRef = useRef<ResizeObserver | null>(null);
  const lastWidthRef = useRef(-1);
  const ref = useCallback(
    (el: HTMLElement | null) => {
      observerRef.current?.disconnect();
      observerRef.current = null;
      if (!el) {
        lastWidthRef.current = -1;
        document.documentElement.style.removeProperty(cssVar);
        return;
      }
      const ro = new ResizeObserver((entries) => {
        const w = Math.round(entries[0]?.contentRect.width ?? 0);
        if (w === lastWidthRef.current) return;
        lastWidthRef.current = w;
        document.documentElement.style.setProperty(cssVar, `${w}px`);
      });
      ro.observe(el);
      observerRef.current = ro;
    },
    [cssVar],
  );
  useEffect(
    () => () => {
      observerRef.current?.disconnect();
      document.documentElement.style.removeProperty(cssVar);
    },
    [cssVar],
  );
  return ref;
}


/**
 * 中央幕布 —— 上下结构:terminal(无 session 时占位) + composer,高度可拖。
 * 文件预览不在此层:提升为外层水平 group 的独立通栏面板(见 AppShell),
 * 打开文件时 terminal 不再被横向压缩。
 */
function MainPanel() {
  const activeId = host.getActiveSessionId();
  /* SSH 会话无 composer:幕布即输入面(触发符/审批线等都是 CLI 语义)。 */
  const activeKind = host.getSessions().find((s) => s.id === activeId)?.kind;
  /* 对话框四段式高度:composer 插件工具栏的 ↑↓ 写 kernel composerStage,这里消费。
     实测本库命令式 setLayout/panelRef.resize 在嵌套 group 下会被静默回滚,不可用;
     separator 键盘路径(每键 5%)走库自身状态更新,可靠 —— 借它驱动:
     键数 = round((目标% − 当前%)/5),从 groupRef.getLayout() 读当前值。 */
  const stage = useComposerStage();
  const groupRef = useGroupRef();

  useEffect(() => {
    /* activeId 入依赖:切会话时 PanelGroup 重挂载回 defaultSize,需按当前 stage 重放 */
    const group = document.querySelector('[data-group][id="tmd.main.vertical"]');
    const sep = group?.querySelector(":scope > [data-separator]");
    const current = groupRef.current?.getLayout().composer ?? 30;
    const steps = Math.round((COMPOSER_STAGE_SIZE[stage] - current) / COMPOSER_RESIZE_STEP);
    const key = steps > 0 ? "ArrowUp" : "ArrowDown";
    for (let i = 0; i < Math.abs(steps); i++) {
      sep?.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
    }
  }, [stage, activeId, groupRef]);

  /* 无活跃 session:整页渲染 welcome(引擎探针/安装 + 近期会话),
     terminal 与 composer 一并替换 —— 首页即初始形态。 */
  if (!activeId) {
    return <Mounts point="editorCenter.welcome" />;
  }

  return (
    <PanelGroup orientation="vertical" id="tmd.main.vertical" groupRef={groupRef}>
      <Panel defaultSize={70} minSize={30} id="canvas">
        <TerminalView key={activeId} sessionId={activeId} />
      </Panel>
      {activeKind === "ssh" ? null : (
        <>
          <PanelResizeHandle className="panel-handle panel-handle-h" />
          <Panel defaultSize={30} minSize={10} id="composer">
            <Mounts point="editorCenter.composer" />
          </Panel>
        </>
      )}
    </PanelGroup>
  );
}

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
function TopBar({
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
export function AppShell() {
  useHost();
  const platform = usePlatformKind();
  const { mode: filePanelMode, panels: filePanels } = useFilePanel();
  /* 激活面板 = mode 命中项,回落首个注册项(插件 activate 顺序) */
  const activeFilePanel =
    filePanels.find((p) => p.id === filePanelMode) ?? filePanels[0];
  const [leftOpen, toggleLeft] = usePersistedToggle("shell.left", true);
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
    </div>
  );
}
