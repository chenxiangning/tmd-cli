/**
 * notify 插件 —— 系统通知(桌面 OS 级)与额度撞墙预警。
 *
 * 解决「走开 → 回来发现卡在等审批 / 早已撞墙」的离开工位盲区:
 * - 事件侧:消费内核既有状态信号(askDetected / turnSettled / sessionExited),
 *   窗口失焦才发 OS 通知,检测零新增;
 * - 额度侧:周期轮询「激活会话供应商」的额度快照(复用 kernel/quota 注册表,
 *   与 QuotaChip 同一抓取通道),窗口已用过阈值触发一次 OS 通知/窗口周期。
 *
 * 通知通道 = kernel/ipc.sendOsNotification(R3 薄包装,web 态恒不发射)。
 * 发送闸与阈值判定抽在 logic.ts / quotaWatch.ts(模块级纯函数,单测覆盖)。
 */

import { BellRinging } from "@phosphor-icons/react";
import { host } from "@kernel/host";
import { KernelTopics, type SessionExitedDetailEvent } from "@kernel/events";
import { sendOsNotification } from "@kernel/ipc";
import { t } from "@kernel/i18n";
import { getSettingsState } from "@kernel/settings";
import { getQuotaProvider } from "@kernel/quota";
import type { Plugin } from "@kernel/plugin";
import { NotifySettingsTab } from "./NotifySettingsTab";
import { notifyText, shouldNotify, type NotifyKind } from "./logic";
import { QUOTA_POLL_FIRST_MS, QUOTA_POLL_INTERVAL_MS, pickQuotaWarnings } from "./quotaWatch";
import "./locales"; /* 域词典随插件自带:import 即注册 */

/** 统一发送闸:分类开关 + 失焦判定,过了才走 OS 通道。 */
function dispatch(kind: NotifyKind, sessionId: string): void {
  const { settings } = getSettingsState();
  if (!shouldNotify(kind, settings, host.isWindowFocused())) return;
  const { title, body } = notifyText(kind, sessionId, host);
  void sendOsNotification(title, body);
}

export const notifyPlugin: Plugin = {
  id: "notify",
  meta: {
    name: "系统通知",
    abbr: "NT",
    desc: "离开窗口时的桌面提醒:Ask 等待 / 轮次结束 / 会话退出 / 额度撞墙预警",
    icon: BellRinging,
    iconColor: "#F5A623",
    category: "feature",
  },
  activate(ctx) {
    /* 事件侧:三类内核信号,边沿触发,检测零新增。
       turnSettled 只提醒"未被查看"的结算(查看过的轮次不值得打断);
       退出走 sessionExitedDetail(payload 是移除前快照,名字档位才可达)。 */
    const waitingNotified = new Set<string>();
    const offs = [
      ctx.events.on<string>(KernelTopics.askDetected, (id) => {
        waitingNotified.add(id);
        dispatch("ask", id);
      }),
      ctx.events.on<{ sessionId: string; unviewed: boolean }>(
        KernelTopics.turnSettled,
        (e) => {
          waitingNotified.delete(e.sessionId);
          if (e.unviewed) dispatch("turnEnd", e.sessionId);
        },
      ),
      ctx.events.on<SessionExitedDetailEvent>(KernelTopics.sessionExitedDetail, (e) => {
        const { settings } = getSettingsState();
        if (!shouldNotify("exit", settings, host.isWindowFocused())) return;
        const name = e.title || host.getCliProfile(e.profileId)?.name || e.profileId;
        void sendOsNotification(t("会话退出"), t("「{name}」已退出", { name }));
      }),
    ];

    /* 镜像时序补扫:「提问先于失焦」的场景 askDetected 边沿已被聚焦期消费,
       失焦那一刻扫一遍等待中的会话补发(去重按会话,聚焦恢复即清账)。 */
    const onBlur = (): void => {
      const { settings } = getSettingsState();
      if (!settings.notifyOsAsk || host.isWindowFocused()) return;
      for (const s of host.getSessions()) {
        if (!host.isWaitingConfirm?.(s.id) || waitingNotified.has(s.id)) continue;
        waitingNotified.add(s.id);
        const { title, body } = notifyText("ask", s.id, host);
        void sendOsNotification(title, body);
      }
    };
    const onFocus = (): void => waitingNotified.clear();
    window.addEventListener("blur", onBlur);
    window.addEventListener("focus", onFocus);

    /* 额度侧:轻轮询(首查 30s,此后 10 分钟一次;激活会话供应商),过阈去重后发 OS 通知。 */
    const warned = new Set<string>();
    const poll = () => {
      const { settings } = getSettingsState();
      const threshold = settings.notifyQuotaWarnPercent;
      if (threshold <= 0) return;
      const sessionId = host.getActiveSessionId();
      const session = sessionId ? host.getSessions().find((s) => s.id === sessionId) : null;
      if (!sessionId || !session) return;
      const profileId = session.engine ?? session.profileId;
      const provider = getQuotaProvider(profileId);
      if (!provider) return;
      provider
        .fetch({
          model: host.getSessionStatus(sessionId)?.model ?? null,
          cwd: session.cwd,
          cliSessionId: host.getCliSessionId(sessionId),
        })
        .then((snapshot) => {
          if (!snapshot.windows.length) return; // 余额型(无窗口)不参与
          for (const win of pickQuotaWarnings(snapshot.windows, threshold, warned)) {
            void sendOsNotification(
              t("额度预警 · {provider}", { provider: snapshot.providerLabel }),
              t("{title}:{label} 窗口已用 {pct}%", {
                title: snapshot.title,
                label: win.label,
                pct: win.displayPercent,
              }),
            );
          }
        })
        .catch(() => {
          /* 额度查询失败不告警(chip 已有失败警示,通知侧静默)。 */
        });
    };
    const first = setTimeout(poll, QUOTA_POLL_FIRST_MS);
    const timer = setInterval(poll, QUOTA_POLL_INTERVAL_MS);

    ctx.registerSettingsSection({
      id: "notify",
      title: t("系统通知"),
      description: t("离开窗口时的桌面级提醒(仅在窗口失焦时发送)。"),
      icon: <BellRinging size="0.875rem" aria-hidden />,
      order: 46,
      tabs: [
        {
          id: "general",
          title: t("通知"),
          icon: <BellRinging size="0.875rem" aria-hidden />,
          order: 0,
          component: NotifySettingsTab,
        },
      ],
    });

    return () => {
      clearTimeout(first);
      clearInterval(timer);
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("focus", onFocus);
      for (const off of offs) off();
    };
  },
};
