/**
 * 客户端主页外壳 —— 横向多栏可拖布局(文件预览为条件通栏) + composer 高度可拖 + 顶栏 macOS 融合。
 * 桌面专属:手机远程 UI 在 src/mobile/(独立代码树,不共享组件;数据面才共享 transport)。
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
 */

import { useCallback, useEffect, useState } from "react";
import { useHost } from "@kernel/host";
import { Mounts } from "@kernel/Mounts";
import { useEditorTabs } from "@kernel/tabs";
import { useFilePanel } from "@kernel/filePanel";
import { usePlatformKind } from "@kernel/platform";
import { PluginMarketPage } from "./PluginMarketPage";
import { StartFailureToast } from "./StartFailureToast";
import { ExitSessionToast } from "./ExitSessionToast";
import { SettingsPersistToast } from "./SettingsPersistToast";
import { useEditorMaximized } from "./editorMaximized";
import { shellBarToggles, shellLeftEnsureOpen, shellMarketClose, shellMarketToggle } from "./shortcutCommands";
import { installShortcutDispatcher } from "@kernel/shortcuts";
import { usePersistedToggle, useScrollbarProbe } from "./shellHooks";
import { DesktopColumns } from "./DesktopColumns";
import { LeftRail } from "./LeftRail";
import { PanelRail } from "./PanelRail";
import { TopBar } from "./TopBar";
import "./zoomCommands"; /* 界面缩放键位(⌘+/⌘−/⌘0):模块级注册,随壳装配生效 */

export function AppShell() {
  useHost();
  const platform = usePlatformKind();
  const { mode: filePanelMode, panels: filePanels } = useFilePanel();
  const [leftOpen, toggleLeft, setLeftOpen] = usePersistedToggle("shell.left", true);
  const [rightOpen, toggleRight, setRightOpen] = usePersistedToggle("shell.right", true);
  /* 插件市场页开关:打开时以不透明覆盖层盖住三栏(见下方 JSX 注释),关掉零回放即回。 */
  const [marketOpen, setMarketOpen] = useState(false);
  const toggleMarket = useCallback(() => setMarketOpen((v) => !v), []);
  /* 设置菜单开合(2026-10-04 触发钮迁左 rail 底):AppShell 持有,左 rail 钮与
   * 左下簇(菜单本体)双端受控;工作区显隐菜单开合同收此处 —— 两菜单同角落,
   * 互斥在各自开/关事件源做,不设 prop→state effect。左栏收起时菜单随簇卸载,
   * 开态一并复位,防重开左栏时菜单凭空挂着。 */
  const [settingsMenuOpen, setSettingsMenuOpen] = useState(false);
  const [visMenuOpen, setVisMenuOpen] = useState(false);
  useEffect(() => {
    if (!leftOpen) {
      setSettingsMenuOpen(false);
      setVisMenuOpen(false);
    }
  }, [leftOpen]);
  const toggleSettingsMenu = useCallback(() => {
    if (!leftOpen) toggleLeft(); /* 栏收起先弹回:菜单本体随左下簇挂载 */
    setVisMenuOpen(false); /* 互斥:开设置先收显隐 */
    setSettingsMenuOpen((v) => !v);
  }, [leftOpen, toggleLeft]);
  const changeVisMenu = useCallback((o: boolean) => {
    if (o) setSettingsMenuOpen(false); /* 互斥:开显隐先收设置 */
    setVisMenuOpen(o);
  }, []);
  const { tabs } = useEditorTabs();
  /* 编辑区最大化(editorMaximized store,持久化):有 tab 时仅中央幕布零宽
     让位(.group-maximized 纯样式折叠,见 panel-handle.css),左栏与右栏钉住
     实测宽度 —— 编辑区只在中间区域撑满;无 tab 时标志不生效。 */
  const maximized = useEditorMaximized() && tabs.length > 0;
  useScrollbarProbe();

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
      />
      {/* 插件市场为不透明覆盖层,三栏保持挂载且可见地留在下层:会话现场/文件
          tab/分栏尺寸零回放零重排;也不可 display:none 隐藏三栏 —— 顶栏左右区
          宽度实测自侧栏(useElementWidth 写 CSS 变量),隐藏后 RO 上报 0 会把
          顶栏 icon 挤叠。市场页实底背景,盖住下层即可。 */}
      <div className="relative flex min-h-0 flex-1">
        {/* 左缘入口 rail:常驻竖条(左栏收起也在),会话看板/市场/回首页/
            工作区切换在顶簇,设置触发钮钉底簇;市场页打开时与三栏一起被覆盖。 */}
        <LeftRail
          marketOpen={marketOpen}
          onToggleMarket={toggleMarket}
          settingsOpen={settingsMenuOpen}
          onToggleSettings={toggleSettingsMenu}
        />
        <DesktopColumns
          leftOpen={leftOpen}
          rightOpen={rightOpen}
          maximized={maximized}
          hasTabs={tabs.length > 0}
          filePanels={filePanels}
          filePanelMode={filePanelMode}
          settingsMenuOpen={settingsMenuOpen}
          onSettingsMenuOpenChange={setSettingsMenuOpen}
          visMenuOpen={visMenuOpen}
          onVisMenuOpenChange={changeVisMenu}
        />
        {/* 右缘面板 rail:常驻竖条(右栏收起也在),点击切面板并展开右栏,
            再点已激活面板 = 折叠右栏(hub 类顺带关中央 tab);
            插件市场页打开时与三栏一起被覆盖层盖住。 */}
        <PanelRail rightOpen={rightOpen} setRightOpen={setRightOpen} />
        {marketOpen && (
          <div className="absolute inset-0 z-50">
            <PluginMarketPage onClose={() => setMarketOpen(false)} />
          </div>
        )}
      </div>

      <Mounts point="overlay" />
      {/* 会话启动失败通知:进程秒退静默闪退的兜底呈现(见 kernel/sessionSpawn.ts) */}
      <SettingsPersistToast />
      <StartFailureToast />
      <ExitSessionToast />
    </div>
  );
}
