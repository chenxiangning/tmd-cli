/**
 * 会话异常退出通知 —— 右下角 toast 栈(复用 StartFailureToast 卡样式与栈纪律)。
 * 订阅 kernel sessionExitedDetail:非零退出码(崩溃/异常中止)才上卡,
 * 「续聊」= openDiskSession 按源会话元数据原样 resume(busy 态 + 失败直馈,
 * 不再只靠启动失败卡);「接力」经 relayBridge 开跨引擎对话框(摘要读磁盘,
 * 会话已逝读得到;插件停用桥 null 即无钮);0/130 不扰。
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowClockwise, ArrowSquareOut, Cross, Warning } from "@phosphor-icons/react";
import { host } from "@kernel/host";
import { t } from "@kernel/i18n";
import { KernelTopics, type SessionExitedDetailEvent, type SessionStartFailedEvent } from "@kernel/events";
import { relayOpenRef } from "@kernel/relayBridge";

/* 本文件文案的 en/ja 词典统一落 kernel/locales/<lang>/common.ts(与退出卡历史键
   同域;zh 恒等无词典)。 */

const NOTICE_TTL_MS = 12_000;
const NOTICE_MAX = 3;

/** 单条通知卡:TTL 自销;续聊 = 按快照元数据原样 resume 磁盘会话(带 busy/直馈)。 */
function NoticeCard({ n, onClose }: { n: Notice; onClose: (id: number) => void }) {
  useEffect(() => {
    const timer = setTimeout(() => onClose(n.id), NOTICE_TTL_MS);
    return () => clearTimeout(timer);
  }, [n.id, onClose]);
  const name = (n.profileId && host.getCliProfile(n.profileId)?.name) ?? n.profileId ?? "CLI";
  const canResume = n.kind !== "shell" && n.cliSessionId != null;
  /* 接力源限本地 CLI:ssh 磁盘身份在远端,本地读取器无源(远端接力二期)。 */
  const canRelay = n.kind === "cli" && n.cliSessionId != null && relayOpenRef.current != null;
  const [resuming, setResuming] = useState(false);
  const [resumeError, setResumeError] = useState("");
  const resume = (): void => {
    if (resuming) return;
    setResuming(true);
    setResumeError("");
    /* 失败直馈(openDiskSession reject 的兜底文案;成功路径由启动失败卡/会话面接管):
       卡不自动关,失败原因原地可读,重试不必等下一张卡。 */
    void host
      .openDiskSession(n.profileId, n.cwd, n.workspaceId, n.cliSessionId!)
      .then(() => onClose(n.id))
      .catch((e: unknown) => {
        setResumeError(e instanceof Error ? e.message : String(e));
        setResuming(false);
      });
  };
  return (
    <div className="sft-card">
      <div className="sft-head">
        <Warning size="0.875rem" className="sft-icon" aria-hidden />
        <span className="sft-title">
          {t("{name} 会话异常退出(code {code})", { name, code: n.exitCode ?? "?" })}
        </span>
        <button
          type="button"
          className="sft-close"
          aria-label={t("关闭退出通知")}
          onClick={() => onClose(n.id)}
        >
          <Cross size="0.75rem" aria-hidden />
        </button>
      </div>
      {canResume && (
        <button
          type="button"
          className="sft-resume"
          disabled={resuming}
          onClick={resume}
        >
          <ArrowClockwise size="0.75rem" aria-hidden className={resuming ? "animate-spin" : ""} />
          {resuming ? t("续聊中…") : t("一键续聊(恢复到该会话)")}
        </button>
      )}
      {resumeError && (
        <pre className="sft-reason">{t("续聊失败:{reason}", { reason: resumeError })}</pre>
      )}
      {canRelay && (
        <button
          type="button"
          className="sft-resume"
          onClick={() => {
            /* 非空断言禁:12s TTL 内插件可能被停用(cleanup 置 null);取局部,没了静默。 */
            const open = relayOpenRef.current;
            if (open)
              open({
                profileId: n.profileId,
                engineName: name,
                cliSessionId: n.cliSessionId,
                title: n.title,
                cwd: n.cwd || undefined,
                workspaceId: n.workspaceId,
              });
            onClose(n.id);
          }}
        >
          <ArrowSquareOut size="0.75rem" aria-hidden />
          {t("转其他引擎接力")}
        </button>
      )}
    </div>
  );
}

interface Notice extends SessionExitedDetailEvent {
  id: number;
}

/** 纯呈现面(测试 renderToStaticMarkup 断言;订阅在 ExitSessionToast)。 */
export function ExitSessionNotices({
  notices,
  onClose,
}: {
  notices: readonly Notice[];
  onClose: (id: number) => void;
}) {
  if (notices.length === 0) return null;
  return (
    <div className="sft-stack" role="alert">
      {notices.map((n) => (
        <NoticeCard key={n.id} n={n} onClose={onClose} />
      ))}
    </div>
  );
}

export function ExitSessionToast() {
  const [notices, setNotices] = useState<readonly Notice[]>([]);
  const seq = useRef(0);
  /* 与 StartFailureToast 的双卡去重:20s 窗外带崩溃特征的退出会同时发
   * sessionStartFailed(late) 与本 detail,启动失败卡已覆盖时不重复上卡。 */
  const startFailedIds = useRef(new Set<string>());

  useEffect(() => {
    const offFailed = host.events.on<SessionStartFailedEvent>(
      KernelTopics.sessionStartFailed,
      (e) => {
        if (e.sessionId) startFailedIds.current.add(e.sessionId);
      },
    );
    const off = host.events.on<SessionExitedDetailEvent>(
      KernelTopics.sessionExitedDetail,
      (e) => {
        /* 0 = 正常收尾,130 = 用户 kill,null = 未知(旧载荷/SSH 同步收尾竞态):
         * 三者都不打扰;只有确认非零异常才上卡(宁漏勿扰)。
         * 启动失败卡已覆盖同会话的,不再叠第二张。 */
        if (e.exitCode == null || e.exitCode === 0 || e.exitCode === 130) return;
        if (startFailedIds.current.has(e.sessionId)) return;
        const id = ++seq.current;
        setNotices((list) => [...list.slice(-(NOTICE_MAX - 1)), { ...e, id }]);
      },
    );
    return () => {
      offFailed();
      off();
    };
  }, []);

  const close = useCallback((id: number) => {
    setNotices((list) => list.filter((n) => n.id !== id));
  }, []);

  return <ExitSessionNotices notices={notices} onClose={close} />;
}
