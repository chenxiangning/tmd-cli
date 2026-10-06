/**
 * 会话状态条(composer 正上方细横条,spec 2026-10-06-mobile-status-bar):
 * 模型 chip(点击写 /model 拉起 CLI picker)+ 思考 chip(thinkingLevel 在场才显,
 * 纯展示)+ 额度 chip(无 fetcher 不显,点击即刷新)。数据 = statusProbe
 * (桌面 cli-* 纯读取器,WS 桥远程直读);轮询 状态 30s + turnActive 下降沿补拉、
 * 额度 120s,卸载清定时器。三 chip 全不可显(未知引擎且无额度)整条不渲染。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { t } from "@kernel/i18n";
import type { CliSessionStatus } from "@kernel/cli";
import type { QuotaSnapshot } from "@kernel/quota";
import { engineOf, engineWire } from "./engines";
import { writeSession } from "./remote";
import {
  fetchMobileQuota,
  formatQuotaLine,
  hasMobileQuotaFetcher,
  readMobileSessionStatus,
} from "./statusProbe";

const STATUS_POLL_MS = 30_000;
const QUOTA_POLL_MS = 120_000;

export function StatusBar(props: {
  sessionId: string;
  profileId: string;
  cwd: string;
  cliSessionId?: string;
  /** 桌面守望投影的回合态;下降沿(回合收尾)补拉一次状态(模型可能刚切)。 */
  turnActive?: boolean;
}) {
  const { profileId, cwd, cliSessionId } = props;
  const [status, setStatus] = useState<CliSessionStatus | null>(null);
  const [quota, setQuota] = useState<QuotaSnapshot | null>(null);
  const quotaAble = hasMobileQuotaFetcher(profileId);

  const pullStatus = useCallback(() => {
    void readMobileSessionStatus(profileId, cwd, cliSessionId)
      .then((s) => setStatus(s))
      .catch(() => undefined);
  }, [profileId, cwd, cliSessionId]);

  /* 挂载即拉 + 30s 轮询;卸载清定时器。 */
  useEffect(() => {
    pullStatus();
    const timer = setInterval(pullStatus, STATUS_POLL_MS);
    return () => clearInterval(timer);
  }, [pullStatus]);

  /* turnActive 下降沿补拉(模型/思考在一回合内被 /model 切走是常态路径)。 */
  const wasActive = useRef(false);
  useEffect(() => {
    const fell = wasActive.current && props.turnActive === false;
    wasActive.current = props.turnActive === true;
    if (fell) pullStatus();
  }, [props.turnActive, pullStatus]);

  /* 额度:omp/pi 的供应商路由吃当前模型,模型变化重拉。 */
  const model = status?.model ?? null;
  const refreshQuota = useCallback(() => {
    if (!hasMobileQuotaFetcher(profileId)) return;
    fetchMobileQuota(profileId, { model, cwd, cliSessionId })
      .then((q) => setQuota(q))
      .catch(() => setQuota(null));
  }, [profileId, cwd, cliSessionId, model]);
  useEffect(() => {
    if (!quotaAble) return;
    refreshQuota();
    const timer = setInterval(refreshQuota, QUOTA_POLL_MS);
    return () => clearInterval(timer);
  }, [quotaAble, refreshQuota]);

  const modelLabel = status?.model || engineOf(profileId)?.name;
  const quotaText = quotaAble ? (quota ? formatQuotaLine(quota) : null) : undefined;
  if (!modelLabel && !status?.thinkingLevel && quotaText === undefined) return null;
  return (
    <div className="m-status">
      {modelLabel && (
        <button
          type="button"
          className="m-status-chip"
          aria-label={t("切模型")}
          onClick={() => void writeSession(props.sessionId, engineWire(profileId, "/model")).catch(() => undefined)}
        >
          {modelLabel}
        </button>
      )}
      {status?.thinkingLevel && (
        <span className="m-status-chip">{t("思考 {level}", { level: status.thinkingLevel })}</span>
      )}
      {quotaText !== undefined && (
        <button
          type="button"
          className="m-status-chip"
          aria-label={t("刷新额度")}
          onClick={refreshQuota}
        >
          {quotaText ?? t("额度 —")}
        </button>
      )}
    </div>
  );
}
