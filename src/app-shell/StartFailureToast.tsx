/**
 * 会话启动失败通知 —— 右下角 toast 栈,订阅 kernel sessionStartFailed。
 *
 * 背景:pty://exit 秒删 tab、removeSession 即清输出缓冲,CLI 配置错误等
 * 启动失败在界面上静默闪退(症状:新建会话后"直接回退首页",报错不可见)。
 * 报错摘录由 kernel/sessionSpawn.ts 在缓冲清空前摘取,这里只管呈现:
 * 12s 自动消失,多则叠放(最多 3 条),手点 X 可立即关。
 */

import { useCallback, useEffect, useRef, useState } from "react";
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

/** 单条通知卡:自持 TTL 定时器,effect cleanup 直接 clearTimeout(卸载即销)。
    静态渲染(renderToStaticMarkup)不跑 effect,测试看到的标记不变。 */
function NoticeCard({ n, onClose }: { n: Notice; onClose: (id: number) => void }) {
  useEffect(() => {
    const timer = setTimeout(() => onClose(n.id), NOTICE_TTL_MS);
    return () => clearTimeout(timer);
  }, [n.id, onClose]);
  const name = (n.profileId && host.getCliProfile(n.profileId)?.name) ?? n.profileId ?? "CLI";
  return (
    <div className="sft-card">
      <div className="sft-head">
        <Warning size="0.875rem" className="sft-icon" aria-hidden />
        <span className="sft-title">{t("{name} 会话启动失败", { name })}</span>
        <button
          type="button"
          className="sft-close"
          aria-label={t("关闭启动失败通知")}
          onClick={() => onClose(n.id)}
        >
          <Cross size="0.75rem" aria-hidden />
        </button>
      </div>
      <pre className="sft-reason">{n.reason}</pre>
    </div>
  );
}

/** 纯呈现面(测试用 renderToStaticMarkup 断言;订阅在 StartFailureToast)。 */
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
      {notices.map((n) => (
        <NoticeCard key={n.id} n={n} onClose={onClose} />
      ))}
    </div>
  );
}

export function StartFailureToast() {
  const [notices, setNotices] = useState<readonly Notice[]>([]);
  const seq = useRef(0);

  useEffect(() => {
    const off = host.events.on<SessionStartFailedEvent>(
      KernelTopics.sessionStartFailed,
      (e) => {
        const id = ++seq.current;
        setNotices((list) => [...list.slice(-(NOTICE_MAX - 1)), { ...e, id }]);
      },
    );
    return () => off();
  }, []);

  /* 纯 updater:定时器由 NoticeCard 的 effect cleanup 在卸载时自销,这里只过滤列表。 */
  const close = useCallback((id: number) => {
    setNotices((list) => list.filter((n) => n.id !== id));
  }, []);

  return <StartFailureNotices notices={notices} onClose={close} />;
}

