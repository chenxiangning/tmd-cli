/**
 * structured-session 插件 —— RPC 驱动的结构化会话(omp/pi `--mode rpc`,
 * token 级流式;PTY 零涉及)。入口:侧栏 rail 图标 → 中央 tab;数据链 =
 * cli-shared/piRpc(协议)← kernel proc_stream(通用原语)。
 * 设计:docs/superpowers/specs/2026-09-30-structured-session-rpc-design.md
 */
import type { Plugin, PluginContext } from "@kernel/plugin";
import { Chats } from "@phosphor-icons/react";
import { getActiveTab } from "@kernel/tabs";
import { host } from "@kernel/host";
import { t } from "@kernel/i18n";
import { STRUCTURED_SESSION_TAB_KIND, openStructuredSessionTab } from "./tabs";
import { StructuredSessionTab } from "./sessionTab";
import "./locales";
export const structuredSessionPlugin: Plugin = {
  id: "structured-session",
  meta: {
    name: "结构化会话",
    abbr: "结构",
    desc: "RPC 直连的独立会话(omp/pi):token 级流式转录 + 内联审批,无幕布;PTY 会话内的「结构化视图」是只读转录切换,同名不同物",
    icon: Chats,
    iconColor: "#4C8DFF",
    category: "feature",
  },
  activate(ctx: PluginContext) {
    ctx.registerTabContent({
      kind: STRUCTURED_SESSION_TAB_KIND,
      component: StructuredSessionTab,
      icon: Chats,
      /* 保活:tab 切走不卸载,RPC 子进程与转录不丢;关闭 tab 才 kill
       * (unmount cleanup 语义随保活自动收窄为真关 tab)。 */
      keepAlive: true,
    });
    ctx.registerSidebarAction({
      id: "structured-session",
      label: t("结构化会话"),
      icon: Chats,
      order: 24, /* 机器组之后的功能位 */
      rail: true,
      railGroup: "machine",
      opensCenterTab: true,
      active: () => getActiveTab()?.kind === STRUCTURED_SESSION_TAB_KIND,
      onSelect: () => {
        /* 引擎门:声明 structuredRpc 的 profile 才有入口;多家时选当前活跃
         * 引擎优先,缺省第一家(omp)。 */
        const capable = host
          .getCliProfiles()
          .filter((p) => p.structuredRpc);
        if (capable.length === 0) return;
        const activeEngine = host.getSessions()
          .map((s) => host.getCliProfile(s.engine ?? s.profileId))
          .find((p) => p?.structuredRpc);
        openStructuredSessionTab((activeEngine ?? capable[0]).id);
      },
    });
  },
};
