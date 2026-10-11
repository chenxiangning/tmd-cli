/**
 * workbench 插件 —— 工作台:多项目管理(模块/状态/任务看板、日历、时间线、
 * 待跟进、资料文档、问答与提示词生成)。
 *
 * 注册点:
 * - overlay 挂点:插件市场/会话看板同款全屏覆盖层(不透明盖住三栏,下层零回放);
 * - 左缘 LeftRail 第一位入口(2026-10-10 用户口径:rail 重排为
 *   工作台 → 回到首页 → 插件市场 → 会话看板 → 切换工作区)。
 * 数据自持:`~/.tmd-cli/workbench/`(index.json + docs 目录实体),不经任何
 * CLI 会话通道;会话联动只走 kernel listSessions/openDiskSession 公共面。
 */
import { Kanban } from "@phosphor-icons/react";
import type { Plugin, PluginContext } from "@kernel/plugin";
import { getTabs, subscribeEditorTabs } from "@kernel/tabs";
import { WorkbenchTab } from "./WorkbenchTab";
import { ProjectTab } from "./ProjectTab";
import { openWorkbenchTab, WB_CONSOLE_TAB_KIND, WB_CONSOLE_TAB_ID, WB_PROJECT_TAB_KIND } from "./wbTabs";
import "./locales"; /* 域词典随插件自带:i18n.registerMessages(import 即注册) */
import "./workbench.css";
import "./workbench-dialogs.css";

export const workbenchPlugin: Plugin = {
  id: "workbench",
  meta: {
    name: "工作台",
    abbr: "工作台",
    desc: "多项目管理台:任务看板、项目列表、日历、时间线、资料文档与问一句",
    icon: Kanban,
    iconColor: "#C4885C",
    category: "feature",
  },
  activate(ctx: PluginContext) {
    /* 本页与项目详情都走中央 tab(kernel/tabs kind 路由注册表)。 */
    ctx.registerTabContent({ kind: WB_CONSOLE_TAB_KIND, component: WorkbenchTab, icon: Kanban, keepAlive: true });
    ctx.registerTabContent({ kind: WB_PROJECT_TAB_KIND, component: ProjectTab, icon: Kanban, keepAlive: true });
    /* 左 rail 顶部簇第一位入口:打开/激活工作台本页 tab;active = tab 已开,
     * 重渲通知经 useEditorTabs 的 store 订阅桥接(壳统一订阅,不 import 插件私有 store)。 */
    ctx.registerSidebarAction({
      id: "workbench",
      label: "工作台",
      icon: Kanban,
      order: 10,
      leftRail: true,
      active: () => getTabs().some((tab) => tab.id === WB_CONSOLE_TAB_ID),
      subscribeActive: subscribeEditorTabs,
      onSelect: () => openWorkbenchTab(),
    });
  },
};
