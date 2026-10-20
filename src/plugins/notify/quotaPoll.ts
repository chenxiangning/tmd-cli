/**
 * 额度撞墙预警轮询 ── 自 activate 抽出的额度侧(首查 30s,此后 10 分钟一次)。
 * 三腿判定:窗口已用%腿 / 余额低水位腿(仅 deepseek/relay 透传数值)/ claude
 * 本地窗口重置腿。去重键持久化在 notify-log.json 头部 quotaSeen,重启不失忆。
 */

import { host } from "@kernel/host";
import { KernelTopics } from "@kernel/events";
import { sendOsNotification, type SessionMeta } from "@kernel/ipc";
import { getSessionTabs } from "@kernel/sessionTabs";
import { t } from "@kernel/i18n";
import { getSettingsState } from "@kernel/settings";
import { getQuotaProvider } from "@kernel/quota";
/* kept 公式唯一源消费(与平铺广播目标同构):平铺幕布集合不自抄一份防漂移。 */
import { keptSessionIds } from "@plugins/composer/view/broadcastTargets";
import { markQuotaSeen, quotaSeenKeys, recordNotifyEntry } from "./log";
import { shouldNotify } from "./logic";
import { isSessionMuted } from "./mute";
import {
  QUOTA_POLL_FIRST_MS,
  QUOTA_POLL_INTERVAL_MS,
  pickBalanceWarning,
  pickQuotaWarnings,
  quotaWindowKey,
  watchedQuotaSessions,
} from "./quotaWatch";
import { claudeResetWarning } from "./claudeWindow";

/** 发一条额度预警:流水照记(全量历史,免打扰也记),OS 走与事件类同款三闸 ——
 *  quota 曾绕过免打扰窗直发 OS 通知(真 bug,此处修复)。 */
function fireQuota(session: Pick<SessionMeta, "id">, profileId: string, title: string, body: string): void {
  const { settings } = getSettingsState();
  recordNotifyEntry(
    { kind: "quota", sessionId: session.id, profileId, title, snippet: body },
    settings.notifyLogDays,
  );
  /* 会话级静音闸:流水已记;绝不写 quotaSeen(那是跨周期去重键,误写 = 永久静默),
     markQuotaSeen 由 poll 判定侧维护,与本闸无关。 */
  if (isSessionMuted(session.id, "quota")) return;
  if (!shouldNotify("quota", settings, host.isWindowFocused(), settings)) return;
  void sendOsNotification(title, body, () => {
    host.events.emit(KernelTopics.sessionViewRequested, null); /* 点通知 = 用户手势 */
    host.setActiveSession(session.id);
  });
}

function poll(): void {
  const { settings } = getSettingsState();
  const threshold = settings.notifyQuotaWarnPercent;
  const below = settings.notifyQuotaBalanceBelow;
  const resetMin = settings.notifyQuotaResetMinutes;
  if (threshold <= 0 && below <= 0 && resetMin <= 0) return;
  /* 失焦闸与事件类通知同口径(设置分区描述「仅在窗口失焦时发送」;
     聚焦时 chip 已有红灯,不叠 OS 通知)。 */
  if (host.isWindowFocused()) return;
  /* 监控面 = 运行中会话 ∪ 平铺幕布(kept 公式与广播目标同源)按 id 去重,
     供应商去重在下方按 profileId 归并(每家取首个在跑会话作抓取参数)——
     只盯激活会话供应商时,平铺多幕布撞墙不预警(audit B4)。 */
  const seenProfile = new Set<string>();
  for (const session of watchedQuotaSessions(
    host.getSessions(),
    keptSessionIds(getSessionTabs(), host.getActiveSessionId()),
  )) {
    const profileId = session.engine ?? session.profileId;
    if (seenProfile.has(profileId)) continue; /* 供应商去重:每家查一次 */
    seenProfile.add(profileId);
    /* claude 腿:官方 OAuth 无 HTTP 面,本地尾读推算(异步,失败静默)。
       每轮新取去重集副本:判定插入与磁盘持久化(markQuotaSeen)分离。 */
    if (resetMin > 0 && profileId === "claude") {
      void claudeResetWarning(
        session,
        host.getCliProfile(profileId),
        host.getCliSessionId(session.id),
        resetMin,
        Date.now(),
        quotaSeenKeys(),
      ).then((w) => {
        if (!w) return;
        markQuotaSeen([w.key], getSettingsState().settings.notifyLogDays);
        fireQuota(session, profileId, w.title, w.body);
      });
    }
    const provider = getQuotaProvider(profileId);
    if (!provider) continue; /* 无 fetchQuota 的家保持跳过,不猜 */
    provider
      .fetch({
        model: host.getSessionStatus(session.id)?.model ?? null,
        cwd: session.cwd,
        cliSessionId: host.getCliSessionId(session.id),
      })
      .then((snapshot) => {
        const now = Date.now();
        const seen = quotaSeenKeys();
        /* 窗口腿:键带引擎前缀,持久化与判定共用 quotaWindowKey 公式。 */
        if (threshold > 0) {
          const fired = pickQuotaWarnings(snapshot.windows, threshold, seen, `${profileId}:`);
          if (fired.length > 0) {
            markQuotaSeen(fired.map((w) => quotaWindowKey(w, `${profileId}:`)), getSettingsState().settings.notifyLogDays);
          }
          for (const win of fired) {
            fireQuota(
              session,
              profileId,
              t("额度预警 · {provider}", { provider: snapshot.providerLabel }),
              t("{title}:{label} 窗口已用 {pct}%", {
                title: snapshot.title,
                label: win.label,
                pct: win.displayPercent,
              }),
            );
          }
        }
        /* 余额腿:仅 deepseek/relay 有 balanceValue;键 = 引擎前缀 + 越线小时桶。 */
        if (below > 0) {
          const key = `${profileId}:bal:${Math.floor(now / 3_600_000)}`;
          if (pickBalanceWarning(snapshot.balanceValue, below, key, seen)) {
            markQuotaSeen([key], getSettingsState().settings.notifyLogDays);
            fireQuota(
              session,
              profileId,
              t("额度预警 · {provider}", { provider: snapshot.providerLabel }),
              t("{title}:余额 {amount} 已低于下限 {below}", {
                title: snapshot.title,
                amount: snapshot.balanceText ?? String(snapshot.balanceValue),
                below,
              }),
            );
          }
        }
      })
      .catch(() => {
        /* 额度查询失败不告警(chip 已有失败警示,通知侧静默)。 */
      });
  }
}

/** 启动轮询;返回停表(插件 deactivate 调)。 */
export function startQuotaPoll(): () => void {
  const first = setTimeout(poll, QUOTA_POLL_FIRST_MS);
  const timer = setInterval(poll, QUOTA_POLL_INTERVAL_MS);
  return () => {
    clearTimeout(first);
    clearInterval(timer);
  };
}
