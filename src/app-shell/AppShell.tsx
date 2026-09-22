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
import { SettingsPersistToast } from "./SettingsPersistToast";
import { useEditorMaximized } from "./editorMaximized";
import { shellBarToggles, shellLeftEnsureOpen, shellMarketClose, shellMarketToggle } from "./shortcutCommands";
import { installShortcutDispatcher } from "@kernel/shortcuts";
import { usePersistedToggle, useScrollbarProbe } from "./shellHooks";
import { DesktopColumns } from "./DesktopColumns";
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
        marketOpen={marketOpen}
        onToggleMarket={toggleMarket}
      />
      {/* 插件市场为不透明覆盖层,三栏保持挂载且可见地留在下层:会话现场/文件
          tab/分栏尺寸零回放零重排;也不可 display:none 隐藏三栏 —— 顶栏左右区
          宽度实测自侧栏(useElementWidth 写 CSS 变量),隐藏后 RO 上报 0 会把
          顶栏 icon 挤叠。市场页实底背景,盖住下层即可。 */}
      <div className="relative min-h-0 flex-1">
        <DesktopColumns
          leftOpen={leftOpen}
          rightOpen={rightOpen}
          maximized={maximized}
          hasTabs={tabs.length > 0}
          filePanel={activeFilePanel}
        />
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
    </div>
  );
}
