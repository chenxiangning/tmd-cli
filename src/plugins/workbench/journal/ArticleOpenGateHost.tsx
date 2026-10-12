/**
 * 脏稿放行确认宿主(评审 M1)—— 挂在 JournalTab 主视图:任一文章 tab 带脏标记时,
 * openArticleTab(切日/切月/重开同日)先弹 WbConfirm 确认,确认才放行开页签。
 * 脏标记本体由 ArticleTab 经 kernel updateTab 通道上屏(脏圆点),此处只裁决放行。
 */
import { useEffect, useRef, useState } from "react";
import { t } from "@kernel/i18n";
import { WbConfirm } from "../ui";
import { installArticleOpenGate } from "./journalTabs";

export function ArticleOpenGateHost() {
  const [ask, setAsk] = useState(false);
  const settleRef = useRef<((ok: boolean) => void) | null>(null);
  useEffect(() => {
    installArticleOpenGate(() => {
      setAsk(true);
      return new Promise<boolean>((resolve) => {
        settleRef.current = resolve;
      });
    });
    return () => installArticleOpenGate(null);
  }, []);
  const settle = (ok: boolean) => {
    setAsk(false);
    settleRef.current?.(ok);
    settleRef.current = null;
  };
  return (
    <>
      {ask && (
        <WbConfirm
          open
          title={t("未保存的修改")}
          body={t("未保存的修改将丢失")}
          confirmLabel={t("丢弃")}
          onConfirm={() => settle(true)}
          onCancel={() => settle(false)}
        />
      )}
    </>
  );
}
