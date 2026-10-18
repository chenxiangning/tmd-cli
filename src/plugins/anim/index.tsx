/**
 * anim —— tmd-anim 会话工作台薄插件:列出 ~/.tmd-anim/projects 下的动画项目,
 * 一键在 tmd-anim 应用打开,或按默认引擎拉起以项目目录为 cwd 的 AI 会话
 * (初始 prompt 引协议材料与自查命令,语义见 animProjects.ts)。
 *
 * 零内核/零 Rust 改动:全部走既有注册面(tab 内容 + 左 rail 动作)与
 * 既有 ipc/host 原语(fsListDir/fsReadFile/fsWriteFile/fsOpenWith/spawn)。
 * 工作台默认引擎逻辑复用 workbench/defaultEngine,不另设猜测。
 */
import { FilmSlate } from "@phosphor-icons/react";
import { lazySuspense } from "@kernel/lazyTab";
import type { Plugin, PluginContext } from "@kernel/plugin";
import {
  registerComposerEmptySendProvider,
  registerComposerSendTransform,
  registerComposerSendUndo,
} from "@kernel/composerExt";
import { getTabs, subscribeEditorTabs } from "@kernel/tabs";
import { ANIM_TAB_ID, ANIM_TAB_KIND, openAnimTab } from "./animStores";
import { getPendingRefs } from "./refStore";
import { animRefsSendTransform, undoAnimRefsSend } from "./sessionRefs";
import { AnimRefChips } from "./chip";
import "./locales"; /* 域词典随插件自带:import 即注册 */

export const animPlugin: Plugin = {
  id: "anim",
  meta: {
    name: "tmd-anim 动画",
    abbr: "动画",
    desc: "tmd-anim 动画项目列表:应用打开、AI 会话一键拉起",
    icon: FilmSlate,
    iconColor: "#C97BAF",
    category: "feature",
  },
  activate(ctx: PluginContext) {
    ctx.registerTabContent({ kind: ANIM_TAB_KIND, component: lazySuspense(() => import("./animProjectsTab").then((m) => ({ default: m.AnimProjectsTab }))), icon: FilmSlate });
    /* 左 rail 入口(active = 项目列表 tab 已开,重渲通知经 tabs store 桥接,
     *  先例 workbench/session-board;排序 45 = 看板 40 与工作区 50 之间)。 */
    ctx.registerSidebarAction({
      id: "anim",
      label: "动画项目",
      icon: FilmSlate,
      order: 45,
      leftRail: true,
      active: () => getTabs().some((tab) => tab.id === ANIM_TAB_ID),
      subscribeActive: subscribeEditorTabs,
      onSelect: () => openAnimTab(),
    });
    /* 卡片挂 composer 顶部 + 发送变换消费(引用清单块后置,失败回滚;空输入
     *  仅发卡片也放行 —— workbench 任务卡片同款管线)。初始提示词半区已上移
     *  kernel(@kernel/sessionPending),本插件只作生产者。 */
    ctx.contribute("composer.attachments", { component: AnimRefChips });
    const offs = [
      registerComposerSendTransform(animRefsSendTransform),
      registerComposerSendUndo(undoAnimRefsSend),
      registerComposerEmptySendProvider((sid) => !!sid && getPendingRefs(sid).length > 0),
    ];
    return () => {
      for (const off of offs) off();
    };
  },
};
