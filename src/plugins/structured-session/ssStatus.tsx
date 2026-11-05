/**
 * 结构化会话 header 右侧状态簇(从 ssHeader.tsx 拆出守 300 行铁则)——
 * sid/用量胶囊/极简开关/忙闲点/排队/状态行/中止,纯展示 + 设置开关。
 */
import { t } from "@kernel/i18n";
import { updateSettings } from "@kernel/settings";
import { Warning, X } from "@phosphor-icons/react";

/* 右侧状态簇:sid/极简开关/忙闲点/排队/启动告警/状态行/中止 —— 纯展示 + 设置开关。
 * 用量胶囊(上下文%/tokens)与项目地址已迁底部工具条(2026-11-05 用户裁决)。 */
export function StatusCluster(props: {
  sessionId: string | null;
  minimal: boolean;
  busy: boolean;
  queued: number;
  /** 告警胶囊组(帧丢弃/看门狗/启动 stderr;各占一槽,逐槽可关)。 */
  warns: string[];
  statusText: string | null;
  onDismissWarn: (index: number) => void;
  onAbort: () => void;
}) {
  const { sessionId, minimal, busy, queued, warns, statusText } = props;
  return (
    <>
      {sessionId ? <span className="ss-sid">{sessionId.slice(0, 8)}</span> : null}
      <button
        type="button"
        className={"ss-minimal" + (minimal ? " is-on" : "")}
        title={t("极简展示:每轮工作过程折叠为一行,只保留最终答复")}
        aria-pressed={minimal}
        onClick={() => updateSettings({ sessionViewerMinimal: !minimal })}
      >
        {t("极简")}
      </button>
      <span className={`ss-dot${busy ? " is-busy" : ""}`} title={busy ? t("生成中") : t("空闲")} />
      {queued > 0 ? <span className="ss-queued" title={t("当前轮结束后自动发送")}>{t("排队 {n}", { n: queued })}</span> : null}
      {warns.map((w, i) => (
        <span className="ss-warn" role="alert" title={w} key={w}>
          <Warning size="0.75rem" weight="fill" aria-hidden />
          <span className="ss-warn-text">{w}</span>
          <button
            type="button"
            className="ss-warn-x"
            title={t("忽略")}
            aria-label={t("忽略")}
            onClick={() => props.onDismissWarn(i)}
          >
            <X size="0.6875rem" aria-hidden />
          </button>
        </span>
      ))}
      {statusText ? <span className="ss-status" title={statusText}>{statusText.slice(0, 80)}</span> : null}
      {busy ? <button type="button" className="ss-abort" onClick={props.onAbort}>{t("中止")}</button> : null}
    </>
  );
}
