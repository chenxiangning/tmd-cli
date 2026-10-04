/**
 * 结构化会话 header 右侧状态簇(从 ssHeader.tsx 拆出守 300 行铁则)——
 * sid/用量胶囊/极简开关/忙闲点/排队/状态行/中止,纯展示 + 设置开关。
 */
import { t } from "@kernel/i18n";
import { updateSettings } from "@kernel/settings";
import type { PiRpcStats } from "../cli-shared/piRpc";

/* 用量胶囊:settled 后显示 上下文% · 累计 tokens(1k 进位;title 给全量)。 */
function StatsPill({ stats }: { stats: PiRpcStats }) {
  const tok = stats.totalTokens;
  return (
    <span className="ss-stats" title={t("上下文占用 {p}%,本轮会话累计 {n} tokens", { p: stats.contextPercent?.toFixed(1) ?? "—", n: tok ?? "—" })}>
      {(stats.contextPercent ?? 0).toFixed(1)}% · {tok != null ? (tok >= 1000 ? `${(tok / 1000).toFixed(1)}k` : String(tok)) : "—"}
    </span>
  );
}

/* 右侧状态簇:sid/用量/极简开关/忙闲点/排队/状态行/中止 —— 纯展示 + 设置开关。 */
export function StatusCluster(props: {
  sessionId: string | null;
  stats: PiRpcStats | null;
  minimal: boolean;
  busy: boolean;
  queued: number;
  statusText: string | null;
  onAbort: () => void;
}) {
  const { sessionId, stats, minimal, busy, queued, statusText } = props;
  return (
    <>
      {sessionId ? <span className="ss-sid">{sessionId.slice(0, 8)}</span> : null}
      {stats ? <StatsPill stats={stats} /> : null}
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
