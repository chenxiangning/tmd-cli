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
 * 另挂通知中心右栏面板(log.ts 单文件流水):全量历史含聚焦静默,
 * OS/提示音才受失焦与免打扰窗闸(kernel/dnd)。
 */

import { BellRinging, Bell } from "@phosphor-icons/react";
import { host } from "@kernel/host";
import { KernelTopics, type SessionExitedDetailEvent } from "@kernel/events";
import { sendOsNotification } from "@kernel/ipc";
import { getSessionTabs } from "@kernel/sessionTabs";
import { t } from "@kernel/i18n";
import { getSettingsState } from "@kernel/settings";
import { getQuotaProvider } from "@kernel/quota";
import type { Plugin } from "@kernel/plugin";
/* kept 公式唯一源消费(与平铺广播目标同构):平铺幕布集合不自抄一份防漂移。 */
import { keptSessionIds } from "@plugins/composer/view/broadcastTargets";
import { NotifySettingsTab } from "./NotifySettingsTab";
import { NotifyCenterPanel } from "./NotifyCenterPanel";
import { bootNotifyLog, recordNotifyEntry } from "./log";
import { notifyText, shouldNotify, type NotifyKind } from "./logic";
import { QUOTA_POLL_FIRST_MS, QUOTA_POLL_INTERVAL_MS, pickQuotaWarnings, watchedQuotaSessions } from "./quotaWatch";
import "./locales"; /* 域词典随插件自带:import 即注册 */

/** 统一发送闸:分类开关 + 失焦判定,过了才走 OS 通道。
 *  onClick = 通知点击深链(聚焦主窗后激活对应会话;桌面最小档语义见 ipc.ts 注)。
 *  流水 = 全量历史:聚焦静默/免打扰也记,OS 通道才受闸;去重沿用事件边沿与
 *  waitingNotified/warned 集合语义(边沿一次 = 流水一条)。 */
function dispatch(kind: NotifyKind, sessionId: string): void {
  const { settings } = getSettingsState();
  const { title, body } = notifyText(kind, sessionId, host);
  recordNotifyEntry(
    {
      kind: kind === "turnEnd" ? "turn" : "ask",
      sessionId,
      profileId: host.getSessions().find((s) => s.id === sessionId)?.profileId,
      title,
      snippet: body,
    },
    settings.notifyLogDays,
  );
  if (!shouldNotify(kind, settings, host.isWindowFocused(), settings)) return;
  void sendOsNotification(title, body, () => {
    host.events.emit(KernelTopics.sessionViewRequested, null); /* 点通知 = 用户手势,摘最大化 */
    host.setActiveSession(sessionId);
  });
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
    /* 流水装载(单文件 ~/.tmd-cli/notify-log.json;失败按空流水,面板仍可用)。 */
    bootNotifyLog();
    /* 通知中心右栏面板:三/四处 dispatch 的旁挂流水的回看面(含聚焦静默记录)。 */
    ctx.registerFilePanel({
      id: "notify-center",
      label: t("通知中心"),
      icon: Bell,
      component: NotifyCenterPanel,
      order: 14, /* 紧随审批收件箱(13),语义相邻 */
      railGroup: "session",
    });

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
        const name = e.title || host.getCliProfile(e.profileId)?.name || e.profileId;
        const { title, body } = notifyText("exit", e.sessionId, host, name);
        /* 流水先记(全量历史,免打扰也记),OS 才受闸。 */
        recordNotifyEntry(
          { kind: "exit", sessionId: e.sessionId, profileId: e.profileId, title, snippet: body },
          settings.notifyLogDays,
        );
        if (!shouldNotify("exit", settings, host.isWindowFocused(), settings)) return;
        void sendOsNotification(title, body);
      }),
    ];

    /* 镜像时序补扫:「提问先于失焦」的场景 askDetected 边沿已被聚焦期消费,
       失焦那一刻扫一遍等待中的会话补发(去重按会话,聚焦恢复即清账)。 */
    const onBlur = (): void => {
      const { settings } = getSettingsState();
      /* 与 dispatch 同闸(失焦 + 分类开关 + 免打扰窗);补盲会话无边沿流水,记一条。 */
      if (!shouldNotify("ask", settings, host.isWindowFocused(), settings)) return;
      for (const s of host.getSessions()) {
        if (!host.isWaitingConfirm?.(s.id) || waitingNotified.has(s.id)) continue;
        waitingNotified.add(s.id);
        const { title, body } = notifyText("ask", s.id, host);
        recordNotifyEntry(
          { kind: "ask", sessionId: s.id, profileId: s.profileId, title, snippet: body },
          settings.notifyLogDays,
        );
        void sendOsNotification(title, body, () => {
          host.events.emit(KernelTopics.sessionViewRequested, null); /* 点通知 = 用户手势 */
          host.setActiveSession(s.id);
        });
      }
    };
    const onFocus = (): void => waitingNotified.clear();
    window.addEventListener("blur", onBlur);
    window.addEventListener("focus", onFocus);

    /* 额度侧:轻轮询(首查 30s,此后 10 分钟一次;监控面见 poll 内注),过阈去重后发 OS 通知。 */
    const warned = new Set<string>();
    const poll = () => {
      const { settings } = getSettingsState();
      const threshold = settings.notifyQuotaWarnPercent;
      if (threshold <= 0) return;
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
        const provider = getQuotaProvider(profileId);
        if (!provider) continue; /* 无 fetchQuota 的家保持跳过,不猜 */
        provider
          .fetch({
            model: host.getSessionStatus(session.id)?.model ?? null,
            cwd: session.cwd,
            cliSessionId: host.getCliSessionId(session.id),
            })
          .then((snapshot) => {
            if (!snapshot.windows.length) return; // 余额型(无窗口)不参与
            for (const win of pickQuotaWarnings(snapshot.windows, threshold, warned)) {
              const title = t("额度预警 · {provider}", { provider: snapshot.providerLabel });
              const body = t("{title}:{label} 窗口已用 {pct}%", {
                title: snapshot.title,
                label: win.label,
                pct: win.displayPercent,
              });
              /* 流水照记(OS 闸已在 poll 口);quota 行不支持回跳,面板置灰。 */
              recordNotifyEntry(
                { kind: "quota", sessionId: session.id, profileId, title, snippet: body },
                getSettingsState().settings.notifyLogDays,
              );
              void sendOsNotification(title, body, () => {
                host.events.emit(KernelTopics.sessionViewRequested, null); /* 点通知 = 用户手势 */
                host.setActiveSession(session.id);
              });
            }
          })
          .catch(() => {
            /* 额度查询失败不告警(chip 已有失败警示,通知侧静默)。 */
          });
      }
    };
    const first = setTimeout(poll, QUOTA_POLL_FIRST_MS);
    const timer = setInterval(poll, QUOTA_POLL_INTERVAL_MS);

    ctx.registerSettingsSection({
      id: "notify",
      title: t("系统通知"),
      description: t("离开屏幕也能第一时间知道:桌面通知、应用内提示音与额度预警。"),
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
