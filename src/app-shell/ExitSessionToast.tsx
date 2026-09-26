/**
 * 会话异常退出通知 —— 右下角 toast 栈(复用 StartFailureToast 卡样式与栈纪律)。
 * 订阅 kernel sessionExitedDetail:非零退出码(崩溃/异常中止)才上卡,
 * 「续聊」= openDiskSession 按源会话元数据原样 resume;0/130(kill)不扰。
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowClockwise, Cross, Warning } from "@phosphor-icons/react";
import { host } from "@kernel/host";
import { t } from "@kernel/i18n";
import { KernelTopics, type SessionExitedDetailEvent } from "@kernel/events";

const NOTICE_TTL_MS = 12_000;
const NOTICE_MAX = 3;

/** 单条通知卡:TTL 自销;续聊 = 按快照元数据原样 resume 磁盘会话。 */
function NoticeCard({ n, onClose }: { n: Notice; onClose: (id: number) => void }) {
  useEffect(() => {
    const timer = setTimeout(() => onClose(n.id), NOTICE_TTL_MS);
    return () => clearTimeout(timer);
  }, [n.id, onClose]);
  const name = (n.profileId && host.getCliProfile(n.profileId)?.name) ?? n.profileId ?? "CLI";
  const canResume = n.kind !== "shell" && n.cliSessionId != null;
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
          onClick={() => {
            void host.openDiskSession(n.profileId, n.cwd, n.workspaceId, n.cliSessionId!);
            onClose(n.id);
          }}
        >
          <ArrowClockwise size="0.75rem" aria-hidden />
          {t("一键续聊(恢复到该会话)")}
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

  useEffect(() => {
    const off = host.events.on<SessionExitedDetailEvent>(
      KernelTopics.sessionExitedDetail,
      (e) => {
        /* 0 = 正常收尾,130 = 用户 kill;只有异常退出才打扰 */
        if (e.exitCode === 0 || e.exitCode === 130) return;
        const id = ++seq.current;
        setNotices((list) => [...list.slice(-(NOTICE_MAX - 1)), { ...e, id }]);
      },
    );
    return () => off();
  }, []);

  const close = useCallback((id: number) => {
    setNotices((list) => list.filter((n) => n.id !== id));
  }, []);

  return <ExitSessionNotices notices={notices} onClose={close} />;
}
