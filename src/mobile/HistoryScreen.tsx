/**
 * history 屏 —— 磁盘历史会话只读 transcript(对话/操作分层,复用 SessionScreen
 * 的解析与样式);无 PTY/审批/composer —— 历史会话的轻交互只有看。
 */
import { useEffect, useState } from "react";
import { t } from "@kernel/i18n";
import { ConnBanner, HostChip } from "./ConnChip";
import { useMobile } from "./shared";
import { glyphOf } from "./remote";
import { loadTranscriptAt } from "./sessionFile";
import { TurnsView } from "./TurnsView";
import type { TranscriptTurn } from "@kernel/transcript";

export function HistoryScreen(props: { profileId: string; path: string; title: string }) {
  const { go } = useMobile();
  const [turns, setTurns] = useState<TranscriptTurn[] | null>(null);
  const g = glyphOf(props.profileId);

  useEffect(() => {
    let alive = true;
    setTurns(null);
    void loadTranscriptAt(props.path).then((t) => {
      if (alive) setTurns(t ?? []);
    });
    return () => {
      alive = false;
    };
  }, [props.path]);

  return (
    <>
      <div className="nav">
        <button type="button" className="back" aria-label={t("返回列表")} onClick={() => go({ view: "home" })}>
          ‹
        </button>
        <span className={`glyph ${g.cls}`}>{g.text}</span>
        <span className="t">{props.title}</span>
        <span className="run">{t("历史")}</span>
        <HostChip />
      </div>
      <ConnBanner />
      <div className="live">
        {turns === null && <div className="empty">{t("加载中…")}</div>}
        {turns?.length === 0 && <div className="empty">{t("没有可解析的对话记录")}</div>}
        {turns != null && turns.length > 0 && <TurnsView turns={turns} />}
      </div>
    </>
  );
}
