/**
 * 每日日志子域装配 —— 2026-10-11 自独立插件并入工作台(spec:
 * docs/superpowers/specs/2026-10-11-workbench-journal-merge-design.md)。
 * 主视图(年/月/轴)由工作台「工作日志」页签托管(JournalTab),这里只装:
 * 域 store/调度/节假日/任务持久化 + 每日文章中央 tab(深链)。
 * 原设计:docs/superpowers/specs/2026-09-29-daily-journal-design.md
 */
import { CalendarCheck } from "@phosphor-icons/react";
import type { PluginContext } from "@kernel/plugin";
import { ArticleTab } from "./ArticleTab";
import { ARTICLE_TAB_KIND, askArticleDiscard } from "./journalTabs";
import { bootJournal, getJournalState, setMetaTasks } from "./journalStore";
import { bindTaskPersistence } from "./taskQueue";
import { bootJournalSchedule } from "./journalSchedule";
import { bindHolidayEnabled, ensureHolidays } from "./holidays";
import "./locales"; /* 域词典随子域自带:i18n.registerMessages(import 即注册) */
import "./daily-journal.css"; /* 域样式随装配:文章 tab 深链直开(footprint「打开日报 ↗」)时 JournalTab 未挂载也要有样式 */

/** workbench.activate 调用;返回退订(停定时器/事件/生成体)。 */
export function attachJournal(ctx: PluginContext): () => void {
  const ready = bootJournal().then(() => {
    bindHolidayEnabled(() => getJournalState().config.holidaysOn);
    void ensureHolidays(new Date().getFullYear());
  });
  bindTaskPersistence(setMetaTasks);
  const offSchedule = bootJournalSchedule(ctx.events, ready);
  /* keepAlive(评审 M1):便签草稿在组件态里,切走页签不再卸载 —— 切日/切月/
   * 去主视图导航草稿全存活;两条丢稿路径各有关口:重开带草稿空日由
   * openArticleTab 的确认闸把关,beforeClose 闸把关真关闭(关页签 / ⌘W /
   * 关其他 / 关全部,2026-10-13 收口上轮遗留)。 */
  ctx.registerTabContent({
    kind: ARTICLE_TAB_KIND,
    component: ArticleTab,
    icon: CalendarCheck,
    keepAlive: true,
    /* 判据 = kernel tab 的 dirty 标记(ArticleTab 同步镜像),不脏不过闸;
       闸本体按 tab id 注册在 ArticleTab 渲染的 ArticleDiscardGate 上
       —— tab 在挂 = 闸在,不依赖任何外部挂点的挂载时机 */
    beforeClose: (tab) => (tab.dirty ? askArticleDiscard(tab.id) : true),
  });
  return offSchedule;
}
