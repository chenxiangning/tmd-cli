/**
 * 每日文章 tab 契约 —— 主视图已并入工作台「工作日志」页签(2026-10-11),
 * 这里只剩文章深链(插件私有 kind;openTab 经 @kernel/tabs 运行时面直连)。
 */
import { getTabs, openTab } from "@kernel/tabs";
import { dayKey } from "./journalFiles";
import { dayTitleOf } from "./dateTitle";

export const ARTICLE_TAB_KIND = "daily-article";
export interface ArticleTabPayload {
  y: number;
  m: number;
  d: number;
  /** 预期标题(tab 条;生成结算成功后经 updateTab 回写实际标题,见 genSession.finalize)。 */
  title?: string;
  /** 空日直开即进便签编辑态(月格空日点击语义;refresh 重开重入)。 */
  autoEdit?: boolean;
}

/** 脏稿放行闸宿主桥(评审 M1):JournalTab 挂载安装、卸载摘除。openArticleTab
 *  重开「带未保存草稿的空日」(autoEdit 重挂必弃稿)先经宿主 WbConfirm 确认。
 *  无宿主(如 docgen 深链而日志页签未挂)按放行 —— tab 条脏圆点仍如实显示。 */
let openGate: (() => Promise<boolean>) | null = null;

export function installArticleOpenGate(gate: (() => Promise<boolean>) | null): void {
  openGate = gate;
}

/** 打开某日文章 tab(幂等聚焦;空日也开 —— 便签编辑态在 tab 内)。
 *  页签 keepAlive(attach.ts):切日/切月草稿随页签存活不丢;唯一丢稿路径 =
 *  重开带草稿的空日(payload 换引用触发 autoEdit 重挂),此处先确认再放行。 */
export function openArticleTab(y: number, m: number, d: number, title?: string, autoEdit?: boolean): void {
  const key = dayKey(y, m, d);
  const proceed = () =>
    openTab(
      {
        id: `${ARTICLE_TAB_KIND}:${key}`,
        kind: ARTICLE_TAB_KIND,
        title: title || dayTitleOf(y, m, d),
        path: key,
        payload: { y, m, d, title, autoEdit } satisfies ArticleTabPayload,
      },
      { refresh: true },
    );
  const target = getTabs().find((tb) => tb.id === `${ARTICLE_TAB_KIND}:${key}`);
  if (!target?.dirty || !autoEdit) {
    proceed();
    return;
  }
  void (openGate?.() ?? Promise.resolve(true)).then((ok) => {
    if (ok) proceed();
  });
}
