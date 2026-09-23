/**
 * history 屏 —— 磁盘历史会话只读 transcript(对话/操作分层,复用 SessionScreen
 * 的解析与样式)+「继续对话」:resumeArgs spawn 出活 PTY 后切 session 屏
 * (手机续聊 = 桌面 openDiskSession 同语义;去重走日志指针,见 resume.ts)。
 */
import { useEffect, useState } from "react";
import { t } from "@kernel/i18n";
import { ConnBanner, HostChip } from "./ConnChip";
import { useMobile } from "./shared";
import { EngineMark } from "./EngineMark";
import { loadTranscriptAt } from "./sessionFile";
import { resumeDiskSession } from "./resume";
import { TurnsView } from "./TurnsView";
import type { TranscriptTurn } from "@kernel/transcript";

export function HistoryScreen(props: {
  profileId: string;
  path: string;
  title: string;
  cwd?: string;
  workspaceId?: string;
  cliSessionId?: string;
}) {
  const { go, sessions } = useMobile();
  const [turns, setTurns] = useState<TranscriptTurn[] | null>(null);
  const [resuming, setResuming] = useState(false);
  const [resumeErr, setResumeErr] = useState<string | null>(null);
  const resumable = !!props.cwd && !!props.cliSessionId;

  const resume = () => {
    setResuming(true);
    setResumeErr(null);
    void resumeDiskSession({
      profileId: props.profileId,
      cwd: props.cwd!,
      cliSessionId: props.cliSessionId!,
      workspaceId: props.workspaceId,
      sessions,
    })
      .then((id) => {
        if (id) go({ view: "session", sessionId: id });
        else setResumeErr(t("该引擎暂不支持手机续聊"));
      })
      .catch((e) => setResumeErr(String((e as Error)?.message ?? e)))
      .finally(() => setResuming(false));
  };
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
        <EngineMark profileId={props.profileId} />
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
      {resumable && (
        <div className="resume-bar">
          {resumeErr && <span className="m-err" style={{ margin: 0, flex: 1 }}>{resumeErr}</span>}
          <button type="button" className="m-btn resume-btn" disabled={resuming} onClick={resume}>
            {resuming ? t("启动中…") : t("继续对话")}
          </button>
        </div>
      )}
    </>
  );
}
