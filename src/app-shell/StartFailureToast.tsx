/**
 * 会话启动失败通知 —— 右下角 toast 栈,订阅 kernel sessionStartFailed。
 *
 * 背景:pty://exit 秒删 tab、removeSession 即清输出缓冲,CLI 配置错误等
 * 启动失败在界面上静默闪退(症状:新建会话后"直接回退首页",报错不可见)。
 * 报错摘录由 kernel/sessionSpawn.ts 在缓冲清空前摘取,这里只管呈现:
 * 12s 自动消失,多则叠放(最多 3 条),手点 X 可立即关。
 */

import { useEffect, useRef, useState } from "react";
import { Warning, Cross } from "@phosphor-icons/react";
import { host } from "@kernel/host";
import { t } from "@kernel/i18n";
import { KernelTopics, type SessionStartFailedEvent } from "@kernel/events";

interface Notice extends SessionStartFailedEvent {
  id: number;
}

/** 自动消失时长(报错要读,比命令抽屉的 1.8s 长)。 */
const NOTICE_TTL_MS = 12_000;
/** 同时叠放上限,超出挤掉最旧。 */
const NOTICE_MAX = 3;

/** 纯呈现面(测试用 renderToStaticMarkup 断言;订阅/计时在 StartFailureToast)。 */
export function StartFailureNotices({
  notices,
  onClose,
}: {
  notices: readonly Notice[];
  onClose: (id: number) => void;
}) {
  if (notices.length === 0) return null;
  return (
    <div className="sft-stack" role="alert">
      {notices.map((n) => {
        const name =
          (n.profileId && host.getCliProfile(n.profileId)?.name) ?? n.profileId ?? "CLI";
        return (
          <div className="sft-card" key={n.id}>
            <div className="sft-head">
              <Warning size={14} className="sft-icon" aria-hidden />
              <span className="sft-title">{t("{name} 会话启动失败", { name })}</span>
              <button
                type="button"
                className="sft-close"
                aria-label={t("关闭启动失败通知")}
                onClick={() => onClose(n.id)}
              >
                <Cross size={12} aria-hidden />
              </button>
            </div>
            <pre className="sft-reason">{n.reason}</pre>
          </div>
        );
      })}
    </div>
  );
}

export function StartFailureToast() {
  const [notices, setNotices] = useState<readonly Notice[]>([]);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  useEffect(() => {
    let seq = 0;
    const dismiss = (id: number) => {
      const t = timers.current.get(id);
      if (t) clearTimeout(t);
      timers.current.delete(id);
      setNotices((list) => list.filter((n) => n.id !== id));
    };
    const off = host.events.on<SessionStartFailedEvent>(
      KernelTopics.sessionStartFailed,
      (e) => {
        const id = ++seq;
        setNotices((list) => [...list.slice(-(NOTICE_MAX - 1)), { ...e, id }]);
        timers.current.set(id, setTimeout(() => dismiss(id), NOTICE_TTL_MS));
      },
    );
    return () => {
      off();
      timers.current.forEach((t) => clearTimeout(t));
      timers.current.clear();
    };
  }, []);

  return (
    <StartFailureNotices
      notices={notices}
      onClose={(id) =>
        setNotices((list) => {
          const t = timers.current.get(id);
          if (t) clearTimeout(t);
          timers.current.delete(id);
          return list.filter((n) => n.id !== id);
        })
      }
    />
  );
}
