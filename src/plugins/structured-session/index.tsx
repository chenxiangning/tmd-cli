/**
 * structured-session 插件 —— RPC 驱动的结构化会话(omp/pi `--mode rpc`,
 * token 级流式;PTY 零涉及)。G-01:新建入口迁入「新建会话」菜单;
 * 2026-11-05 三分区重构:入「带渲染的会话」组(workspace.newSessionMenu.rendered
 * 挂点,与 PTY 网格/「远程与其他」组并列),右 rail 直挂动作撤除;
 * 数据链 = cli-shared/piRpc(协议)← kernel proc_stream(通用原语)。
 * 设计:docs/superpowers/specs/2026-09-30-structured-session-rpc-design.md
 */
import type { Plugin, PluginContext } from "@kernel/plugin";
import { Chats } from "@phosphor-icons/react";
import { STRUCTURED_SESSION_TAB_KIND } from "@kernel/structuredSessionTabs";
import { StructuredSessionTab } from "./sessionTab";
import { adoptOrphanStreams } from "./adoptBoot";
import { NewSessionEntry } from "./NewSessionEntry";
import "./locales";
export const structuredSessionPlugin: Plugin = {
  id: "structured-session",
  meta: {
    name: "结构化会话",
    abbr: "结构",
    desc: "RPC 直连的独立会话(omp/pi):token 级流式转录 + 内联审批,无幕布;PTY 会话内的「转录视图」是只读转录切换,同名不同物",
    icon: Chats,
    iconColor: "#4C8DFF",
    category: "feature",
  },
  activate(ctx: PluginContext) {
    /* boot 收养:枚举 detach 存活流按 label 重建 tab/行(无人认领流兜底收割)。
     * activate 期一次;tab 表此时恒空,无重复收养面。 */
    adoptOrphanStreams();
    ctx.registerTabContent({
      kind: STRUCTURED_SESSION_TAB_KIND,
      component: StructuredSessionTab,
      icon: Chats,
      /* 保活:tab 切走不卸载,RPC 子进程与转录不丢;关闭 tab 才 kill
       * (unmount cleanup 语义随保活自动收窄为真关 tab)。 */
      keepAlive: true,
    });
    /* 新建入口:「带渲染的会话」组(workspace.newSessionMenu.rendered 挂点,
       2026-11-05 自「更多来源」拆出与 PTY 网格分区);只列声明 structuredRpc
       的引擎(组件内能力门,无死入口)。右 rail 不再直挂(减法:入口归新建菜单)。 */
    ctx.contribute("workspace.newSessionMenu.rendered", { order: 21, component: NewSessionEntry });
  },
};
