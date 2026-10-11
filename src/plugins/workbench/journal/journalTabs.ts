/**
 * 每日文章 tab 契约 —— 主视图已并入工作台「工作日志」页签(2026-10-11),
 * 这里只剩文章深链(插件私有 kind;openTab 经 @kernel/tabs 运行时面直连)。
 */
import { openTab } from "@kernel/tabs";
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

/** 打开某日文章 tab(幂等聚焦;空日也开 —— 便签编辑态在 tab 内)。 */
export function openArticleTab(y: number, m: number, d: number, title?: string, autoEdit?: boolean): void {
  const key = dayKey(y, m, d);
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
}
