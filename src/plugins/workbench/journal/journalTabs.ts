/**
 * 每日文章 tab 契约 —— 主视图已并入工作台「工作日志」页签(2026-10-11),
 * 这里只剩文章深链(插件私有 kind;openTab 经 @kernel/tabs 运行时面直连)。
 */
import { useState } from "react";
import { getTabs, openTab, type EditorTab } from "@kernel/tabs";
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

/** 文章 tab 编辑重入信号(从 ArticleTab 拆出守组件复杂度):mount 时 autoEdit
 *  起始,同 tab 深链 refresh(payload 换引用)再跳变;重挂即重开,onRefresh
 *  供调用方同步归零脏态——放行闸确认弃稿后不归零会留幻影脏圆点且闸判据失真
 *  (提交后评审 M2)。渲染期调整(ProjectTab 同款),不过 effect。 */
export function useArticleEditSignal(tab: EditorTab, onRefresh: () => void): number {
  const p = tab.payload as ArticleTabPayload;
  const [signal, setSignal] = useState(() => (p.autoEdit ? 1 : 0));
  const [lastPayload, setLastPayload] = useState(tab.payload);
  if (lastPayload !== tab.payload) {
    setLastPayload(tab.payload);
    if (p.autoEdit) {
      onRefresh();
      setSignal((v) => v + 1);
    }
  }
  return signal;
}

/** 脏稿弃稿闸 —— 按 **tab id** 注册,由文章 tab 自身装/摘(ArticleDiscardGate)。
 *  两个触发点共用同一闸:
 *  - 开:openArticleTab 重开「带未保存草稿的空日」(autoEdit 重挂必弃稿);
 *  - 关:tab 内容贡献的 beforeClose(关页签 / ⌘W / 关其他 / 关全部),
 *    判据即 kernel tab 的 dirty 标记。
 *
 *  为什么按 id 而不是全局单闸:问「要不要丢稿」问的是**这个 tab 的**草稿,
 *  答话的确认弹窗也就该由这个 tab 自己渲染 —— tab 在挂 = 闸在,不依赖任何
 *  外部挂点(overlay / 工作日志页签)此刻在不在场。曾两版都挂在别处
 *  (JournalTab 内 / 常驻 overlay),每版都要额外论证「宿主此刻在不在」,
 *  少一个论证环节就退化成静默丢稿。keepAlive 保证切走的 tab 仍常驻挂载,
 *  且闸在 closeTab 之前结算:问话时组件必然在挂。
 *
 *  无闸(未挂 / 未注册)按放行,与旧语义一致;tab 条脏圆点始终如实显示。 */
const gates = new Map<string, () => Promise<boolean>>();

/** 文章 tab 挂载期装闸;返回卸载摘除(幂等,只摘自己那一个)。 */
export function installArticleDiscardGate(
  tabId: string,
  gate: () => Promise<boolean>,
): () => void {
  gates.set(tabId, gate);
  return () => {
    if (gates.get(tabId) === gate) gates.delete(tabId);
  };
}

/** 问该 tab 的弃稿闸:无闸 = 放行。开/关两条路径共用。 */
export function askArticleDiscard(tabId: string): Promise<boolean> {
  return gates.get(tabId)?.() ?? Promise.resolve(true);
}

/** 打开某日文章 tab(幂等聚焦;空日也开 —— 便签编辑态在 tab 内)。
 *  页签 keepAlive(attach.ts):切日/切月草稿随页签存活不丢;两条丢稿路径
 *  各有关口 —— 重开带草稿的空日(payload 换引用触发 autoEdit 重挂)在此先
 *  确认再放行;真关闭(关页签 / ⌘W / 关其他 / 关全部)由 tab 内容贡献的
 *  beforeClose 闸把关(2026-10-13,契约 docs/architecture/24-tab-close-guard.md)。 */
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
  void askArticleDiscard(target.id).then((ok) => {
    if (ok) proceed();
  });
}
