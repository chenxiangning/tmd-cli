/**
 * 文章 tab 的脏稿弃稿确认闸(按 tab id 注册;2026-10-13)—— 由 ArticleTab
 * **自己渲染**:tab 在挂 = 闸在。此前两版都把确认宿主挂在别处(JournalTab 内
 * → 常驻 overlay 挂点),每版都要额外论证「宿主此刻在不在场」,少一个环节就
 * 退化成静默丢稿(实测命中:关页签无二次确认)。
 * - 开:openArticleTab 重开带草稿的空日(autoEdit 重挂必弃稿)先确认;
 * - 关:文章 tab 的 beforeClose 闸(关页签 / ⌘W / 关其他 / 关全部)先确认。
 * 脏标记本体由 ArticleTab 经 kernel updateTab 通道上屏(脏圆点),此处只裁决放行。
 */
import { useEffect, useRef, useState } from "react";
import { t } from "@kernel/i18n";
import { WbConfirm } from "../ui";
import { installArticleDiscardGate } from "./journalTabs";

export function ArticleDiscardGate({ tabId }: { tabId: string }) {
  const [ask, setAsk] = useState(false);
  const settleRef = useRef<((ok: boolean) => void) | null>(null);
  useEffect(() => {
    const off = installArticleDiscardGate(tabId, () => {
      /* 重入兜底:上一问未结算就再来一问(kernel 已按 tab 串行化,正常不发生),
       * 旧请求按不放行结算 —— 悬挂 Promise 会卡住整条关闭链。 */
      settleRef.current?.(false);
      setAsk(true);
      return new Promise<boolean>((resolve) => {
        settleRef.current = resolve;
      });
    });
    return () => {
      off();
      /* 卸载(该 tab 已关 / 应用退出)未结算:按不放行结算,不留悬挂 */
      settleRef.current?.(false);
      settleRef.current = null;
    };
  }, [tabId]);
  const settle = (ok: boolean) => {
    setAsk(false);
    settleRef.current?.(ok);
    settleRef.current = null;
  };
  if (!ask) return null;
  return (
    <WbConfirm
      open
      title={t("未保存的修改")}
      body={t("未保存的修改将丢失")}
      confirmLabel={t("丢弃")}
      onConfirm={() => settle(true)}
      onCancel={() => settle(false)}
    />
  );
}
