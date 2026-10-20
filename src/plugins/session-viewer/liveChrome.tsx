/**
 * 活会话转录浮层的 chrome 部件 —— 2026-10-20 从 liveOverlay.tsx 拆出的
 * 展示组件(守 300 行铁则,零语义改动):头部(引擎图标/标题/sid/极简钮/
 * 返回钮)、working 计时条、回底浮标与错误/空态块。轮询状态机与数据链
 * 留在 liveOverlay.tsx。
 */
import type { ReactNode } from "react";
import { Chats } from "@phosphor-icons/react";
import { t } from "@kernel/i18n";
import { Empty } from "@kernel/Empty";
import { Spinner } from "@kernel/Spinner";

export interface LiveHeaderProps {
  engineIcon: ReactNode;
  title: string;
  sid: string;
  engineName: string;
  truncated: boolean;
  minimal: boolean;
  onToggleMinimal: () => void;
  onClose: () => void;
}

export function LiveHeader({
  engineIcon,
  title,
  sid,
  engineName,
  truncated,
  minimal,
  onToggleMinimal,
  onClose,
}: LiveHeaderProps) {
  return (
    <header className="sv-header">
      {engineIcon}
      {/* 主标题 = 会话展示名;引擎会话 id 降为次要 mono 小字(此前 8 位哈希当标题) */}
      <span className="sv-title">{title}</span>
      <span className="sv-sid">{sid}</span>
      <span className="sv-engine-name">{engineName}</span>
      {truncated ? <span className="sv-truncated">{t("会话过大,已截断")}</span> : null}
      <button
        type="button"
        className={`sv-minimal${minimal ? " is-on" : ""}`}
        aria-pressed={minimal}
        title={t("极简展示:每轮工作过程折叠为一行,只保留最终答复")}
        onClick={onToggleMinimal}
      >
        {t("极简")}
      </button>
      <button
        type="button"
        className="lv-close"
        title={t("返回 PTY 实况")}
        onClick={onClose}
      >
        {t("PTY实况")}
      </button>
    </header>
  );
}

export function LiveWorkingBar({ name, elapsed }: { name: string; elapsed: number }) {
  return (
    <div className="lv-working">
      <span className="lv-spin" aria-hidden>
        {Array.from({ length: 9 }, (_, i) => <i key={i} />)}
      </span>
      <span className="lv-working-who">{name}</span>
      <span className="lv-working-for">{t("working for")}{elapsed}s</span>
    </div>
  );
}

export function LiveBackToBottom({ onBack }: { onBack: () => void }) {
  /* 上翻停跟后的回底出口(流式仍在涨,不拽用户视线,只给一键回底) */
  return (
    <button type="button" className="lv-backto" onClick={onBack}>
      {t("回到底部")}
    </button>
  );
}

/** 回溯加载钮(尾窗批次入口):hidden = 已全量,不渲染。 */
export function LiveLoadEarlier({ hidden, onLoad }: { hidden: boolean; onLoad: () => void }) {
  if (hidden) return null;
  return (
    <button type="button" className="sv-more" onClick={onLoad}>
      {t("载入更早")}
    </button>
  );
}

/** 错误持久条(含 unsupported)与空态块:错误走 role=alert + 重试,不抹已到转录。 */
export function LiveStatusBlocks({
  errMsg,
  locating,
  empty,
  onRetry,
}: {
  errMsg: string | null;
  locating: boolean;
  empty: boolean;
  onRetry: () => void;
}) {
  return (
    <>
      {errMsg !== null && (
        <div className="lv-error" role="alert"><span>{errMsg}</span><button type="button" className="lv-error-retry" onClick={onRetry}>{t("重试")}</button></div>
      )}
      {errMsg === null && locating && (
        <div className="sv-empty"><span className="inline-flex items-center gap-2"><Spinner />{t("定位会话文件中…")}</span></div>
      )}
      {errMsg === null && empty && (
        <div className="sv-empty"><Empty icon={<Chats size="0.875rem" />}>{t("会话没有可解析的对话内容")}</Empty></div>
      )}
    </>
  );
}
