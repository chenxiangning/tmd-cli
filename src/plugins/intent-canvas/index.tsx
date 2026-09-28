/**
 * 意图画布插件 —— mossx intent-canvas 移植 + AI 作画 inbox 通道(tmd-cli 新能力)。
 *
 * 功能面:管理页(era 分组/搜索/缩略图/批量删除/治理角标)+ Excalidraw 编辑器
 * (双栏:画布信息/结构化关联 + AI Context/来源追溯)+ 会话关联(composer 附件
 * 芯片 + 发送注入结构化上下文)+ AI 作画(开关 + inbox 文件协议 + 2s 轮询导入)。
 *
 * 注册点:
 * - 中央 tab(kind `intent-canvas`)+ 侧栏动作 + 全局快捷键 Cmd+Alt+I;
 * - composer.attachments 附件芯片 + composerExt 发送变换(上下文注入/作画指令);
 * - 设置分区(AI 作画开关与收件箱说明)。
 *
 * 设计 spec:docs/superpowers/specs/2026-09-28-intent-canvas-plugin-design.md
 * 存储:sidecar ~/.tmd-cli/intent-canvas/<dirKey(root)>/(marks 先例,用户项目零污染)。
 */
import { Compass } from "@phosphor-icons/react";
import type { Plugin, PluginContext } from "@kernel/plugin";
import { openTab } from "@kernel/tabs";
import { t } from "@kernel/i18n";
import type { EditorTab } from "@kernel/tabs";
import type { IntentCanvasOpenRequest } from "./types";
import { IntentCanvasManager } from "./components/IntentCanvasManager";
import { CanvasComposerChips } from "./components/CanvasComposerChips";
import { ComposerDrawToggle } from "./components/ComposerDrawToggle";
import { IntentCanvasSettingsTab } from "./components/IntentCanvasSettingsTab";
import { registerIntentCanvasSendTransform } from "./sendTransform";
import { purgeSessionState } from "./store";
import { toggleSessionDrawMode } from "./aiDrawStore";
import { KernelTopics } from "@kernel/events";
import "./locales"; /* 域词典随插件自带:import 即注册 */
import "./intent-canvas.css";

function IntentCanvasTab({ tab }: { tab: EditorTab }) {
  /* payload 反链:composer 附件芯片等入口携带 canvasId 直达画布详情,
     requestId 每次点击新生成以驱动 useCanvasDocs 的去重消费链。 */
  const payload = tab.payload as { canvasId?: string; requestId?: number } | null;
  const openRequest: IntentCanvasOpenRequest | null =
    payload && typeof payload.canvasId === "string"
      ? { requestId: payload.requestId ?? 0, mode: "architect", canvasId: payload.canvasId }
      : null;
  return <IntentCanvasManager openRequest={openRequest} />;
}

function openIntentCanvasTab(): void {
  openTab({
    id: "intent-canvas",
    title: t("意图画布"),
    path: "intent-canvas",
    kind: "intent-canvas",
    payload: null,
  });
  /* 预热编辑器 chunk:prod 首开是 MB 级下载,趁打开 tab 就开始拉,
     点「新建/打开画布」时不再卡「正在加载画布」。 */
  void import("@excalidraw/excalidraw");
}

export const intentCanvasPlugin: Plugin = {
  id: "intent-canvas",
  meta: {
    name: "意图画布",
    abbr: "画布",
    desc: "Excalidraw 意图画布:结构化关联与来源追溯、会话上下文注入、对话中 AI 作画",
    icon: Compass,
    iconColor: "#C77FD4",
    category: "feature",
  },
  activate(ctx: PluginContext) {
    ctx.registerTabContent({ kind: "intent-canvas", component: IntentCanvasTab });
    ctx.registerSidebarAction({
      id: "intent-canvas",
      label: t("意图画布"),
      icon: Compass,
      order: 30,
      defaultPinned: true,
      /* rail 直挂:进侧栏钉住清单,⋯ 管理面板可勾选显隐(与内置终端/WSL 同款)。 */
      rail: true,
      opensCenterTab: true,
      onSelect: () => openIntentCanvasTab(),
    });
    ctx.registerCommand({
      id: "intentCanvas.open",
      title: t("打开意图画布"),
      keybinding: "Cmd+Alt+I",
      scope: "global",
      run: openIntentCanvasTab,
    });
    ctx.contribute("composer.attachments", { component: CanvasComposerChips });
    /* composer 左下作图标识:会话级 AI 作画开关(assets 唤醒图标同区,排其后)。 */
    ctx.contribute("composer.inputRail", { order: 2, component: ComposerDrawToggle });
    ctx.registerSettingsSection({
      id: "intent-canvas",
      title: t("意图画布"),
      description: t("Excalidraw 画布、会话上下文注入与对话中 AI 作画。"),
      icon: <Compass size="0.875rem" aria-hidden />,
      order: 48,
      tabs: [
        {
          id: "general",
          title: t("画布"),
          icon: <Compass size="0.875rem" aria-hidden />,
          order: 0,
          component: IntentCanvasSettingsTab,
        },
      ],
    });
    /* 会话退出:释放 pending 附件桶与作图标识(评审 P2 内存单调增长)。 */
    ctx.events.on<string>(KernelTopics.sessionExited, (sessionId) => {
      purgeSessionState(sessionId);
      toggleSessionDrawMode(sessionId, false);
    });
    /* 发送变换反注册钩交生命周期账本(熔断/重激活不留双份注入)。 */
    return registerIntentCanvasSendTransform();
  },
};
