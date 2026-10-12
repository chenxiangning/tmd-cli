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
import { ARTICLE_TAB_KIND } from "./journalTabs";
import { bootJournal, getJournalState, setMetaTasks } from "./journalStore";
import { bindTaskPersistence } from "./taskQueue";
import { bootJournalSchedule } from "./journalSchedule";
import { bindHolidayEnabled, ensureHolidays } from "./holidays";
import "./locales"; /* 域词典随子域自带:i18n.registerMessages(import 即注册) */

/** workbench.activate 调用;返回退订(停定时器/事件/生成体)。 */
export function attachJournal(ctx: PluginContext): () => void {
  const ready = bootJournal().then(() => {
    bindHolidayEnabled(() => getJournalState().config.holidaysOn);
    void ensureHolidays(new Date().getFullYear());
  });
  bindTaskPersistence(setMetaTasks);
  const offSchedule = bootJournalSchedule(ctx.events, ready);
  /* keepAlive(评审 M1):便签草稿在组件态里,切走页签不再卸载 —— 切日/切月/
   * 去主视图导航草稿全存活;唯一丢稿路径(重开带草稿空日 autoEdit 重挂)由
   * openArticleTab 的 WbConfirm 闸把关,真正关闭仍由内核 tab 条负责。 */
  ctx.registerTabContent({ kind: ARTICLE_TAB_KIND, component: ArticleTab, icon: CalendarCheck, keepAlive: true });
  return offSchedule;
}
