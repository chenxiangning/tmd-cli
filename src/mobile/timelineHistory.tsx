/**
 * 历史定位视图(桌面 jumpToAnchor「不在 buffer 时逐页加载」的手机对应,spec
 * 2026-10-05-mobile-session-timeline 二轮)—— 时间线任意条目(offset 锚)的
 * 前后文快照:加载 → 渲染 turns + 顶条「正在查看历史位置/回到最新」→ 滚到
 * 锚行(clipText 同口径文本匹配,与尾窗 jumpToMsg 同法)。互斥单视图:挂载即
 * 替代尾窗 turns,返回按钮回实时尾窗,零拼接零去重。
 */
import { useEffect, useRef, useState } from "react";
import { t } from "@kernel/i18n";
import { clipText, type TranscriptTurn } from "@kernel/transcript";
import { loadHistoryRange, type TimelineEntry } from "./timelineData";
import { TurnsView } from "./TurnsView";

export function TimelineHistory(props: {
  path: string;
  entry: TimelineEntry;
  liveRef: React.RefObject<HTMLDivElement | null>;
  onBack: () => void;
}) {
  const [state, setState] = useState<
    { kind: "loading" } | { kind: "error"; message: string } | { kind: "done"; turns: TranscriptTurn[]; anchorText: string }
  >({ kind: "loading" });
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    setState({ kind: "loading" });
    void loadHistoryRange(props.path, props.entry)
      .then((r) => alive.current && setState({ kind: "done", turns: r.turns, anchorText: r.anchorText }))
      .catch((e: unknown) =>
        alive.current && setState({ kind: "error", message: e instanceof Error ? e.message : String(e) }),
      );
  }, [props.path, props.entry]);
  /* 锚定:turns 渲染后在实况容器里找同口径 .tr-user 滚到视口顶(倒序取最新
   * 位置,与尾窗跳转同律);找不到静默(防御,快照必含目标行)。 */
  useEffect(() => {
    if (state.kind !== "done") return;
    const needle = state.anchorText;
    requestAnimationFrame(() => {
      const rows = props.liveRef.current?.querySelectorAll(".tr-user");
      if (!rows) return;
      for (let i = rows.length - 1; i >= 0; i--) {
        if (rows[i].textContent === clipText(needle)) {
          rows[i].scrollIntoView({ behavior: "smooth", block: "start" });
          return;
        }
      }
    });
  }, [state, props.liveRef]);

  return (
    <div className="tl-hist">
      <div className="tl-hist-bar">
        <span>{state.kind === "loading" ? t("正在载入历史…") : t("正在查看历史位置")}</span>
        <button type="button" className="lnk-btn" onClick={props.onBack}>{t("回到最新")}</button>
      </div>
      {state.kind === "loading" && <div className="list-note">{t("加载中…")}</div>}
      {state.kind === "error" && (
        <div className="list-note">
          {t("历史加载失败")} <span className="tl-err-detail">{state.message.slice(0, 120)}</span>
        </div>
      )}
      {state.kind === "done" && <TurnsView turns={state.turns} />}
    </div>
  );
}
