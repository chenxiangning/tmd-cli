/**
 * daily-journal 插件入口 —— 每日工作日志:年/月双视图日历 + 每日一篇 AI 汇总
 * 文章(生成会话直写 md)+ 每日便签 + 节假日关联 + 后台生成任务;
 * 轴视图(脊柱叙事流)宿主右栏面板。
 * 设计:docs/superpowers/specs/2026-09-29-daily-journal-design.md
 * 注册点:右栏面板(rail 入口 + centerTab 联动)+ 中央双 kind tab(主视图/文章)。
 */
import { CalendarCheck } from "@phosphor-icons/react";
import type { Plugin, PluginContext } from "@kernel/plugin";
import { t } from "@kernel/i18n";
import { JournalPanel } from "./JournalPanel";
import { JournalTab } from "./JournalTab";
import { ArticleTab } from "./ArticleTab";
import { ARTICLE_TAB_KIND, JOURNAL_TAB_KIND, openJournalTab } from "./journalTabs";
import { bootJournal, getJournalState, setMetaTasks } from "./journalStore";
import { bindTaskPersistence } from "./taskQueue";
import { bootJournalSchedule } from "./journalSchedule";
import { bindHolidayEnabled, ensureHolidays } from "./holidays";
import "./locales"; /* 域词典随插件自带:i18n.registerMessages(import 即注册) */

export const dailyJournalPlugin: Plugin = {
  id: "daily-journal",
  meta: {
    name: "每日工作日志",
    abbr: "日志",
    desc: "年/月双视图日历 + 每日一篇 AI 汇总文章 + 每日便签 + 右栏轴视图 + 后台生成",
    icon: CalendarCheck,
    iconColor: "#B48FBF",
    category: "feature",
  },
  activate(ctx: PluginContext) {
    const ready = bootJournal().then(() => {
      bindHolidayEnabled(() => getJournalState().config.holidaysOn);
      void ensureHolidays(new Date().getFullYear());
    });
    bindTaskPersistence(setMetaTasks);
    const offSchedule = bootJournalSchedule(ctx.events, ready);
    ctx.registerFilePanel({
      id: "daily-journal",
      label: t("每日工作日志"),
      icon: CalendarCheck,
      component: JournalPanel,
      showFileSubbar: false,
      order: 36,
      railGroup: "ecosystem",
      railBottom: true,
      centerTab: { open: openJournalTab },
    });
    ctx.registerTabContent({ kind: JOURNAL_TAB_KIND, component: JournalTab, icon: CalendarCheck });
    ctx.registerTabContent({ kind: ARTICLE_TAB_KIND, component: ArticleTab, icon: CalendarCheck });
    return offSchedule;
  },
};
