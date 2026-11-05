/**
 * 结构化会话 header 右侧状态簇(从 ssHeader.tsx 拆出守 300 行铁则)——
 * sid/用量胶囊/极简开关/忙闲点/排队/状态行/中止,纯展示 + 设置开关。
 */
import { t } from "@kernel/i18n";
import { updateSettings } from "@kernel/settings";

/* 右侧状态簇:sid/极简开关/忙闲点/排队/状态行/中止 —— 纯展示 + 设置开关。
 * 用量胶囊(上下文%/tokens)与项目地址已迁底部工具条(2026-11-05 用户裁决);
 * 告警已迁幕布内(sessionTab SsWarnList),header 胶囊曾横向撑破布局。 */
export function StatusCluster(props: {
  sessionId: string | null;
  minimal: boolean;
  busy: boolean;
  queued: number;
  statusText: string | null;
  onAbort: () => void;
}) {
  const { sessionId, minimal, busy, queued, statusText } = props;
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
      {statusText ? <span className="ss-status" title={statusText}>{statusText.slice(0, 80)}</span> : null}
      {busy ? <button type="button" className="ss-abort" onClick={props.onAbort}>{t("中止")}</button> : null}
    </>
  );
}
