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
import { sendOsNotification, type SessionMeta } from "@kernel/ipc";
import { t } from "@kernel/i18n";
import { getSettingsState } from "@kernel/settings";
import type { Plugin } from "@kernel/plugin";
import { NotifySettingsTab } from "./NotifySettingsTab";
import { NotifyCenterPanel } from "./NotifyCenterPanel";
import { bootNotifyLog, recordNotifyEntry, type NotifyEntry } from "./log";
import { notifyText, shouldNotify, type NotifyKind } from "./logic";
import { isExitMuted, isSessionMuted } from "./mute";
import { clearSnooze, tmdSessionMuteKey } from "@kernel/sessionMutes";
import { startQuotaPoll } from "./quotaPoll";
import "./locales"; /* 域词典随插件自带:import 即注册 */

/** 统一发送闸:分类开关 + 失焦判定,过了才走 OS 通道。
 *  onClick = 通知点击深链(聚焦主窗后激活对应会话;桌面最小档语义见 ipc.ts 注)。
 *  流水 = 全量历史:聚焦静默/免打扰也记,OS 通道才受闸;去重沿用事件边沿与
 *  waitingNotified/warned 集合语义(边沿一次 = 流水一条)。 */
/** 本地 CLI 会话的磁盘身份快照(通知中心行据此在 tab 已关/重启后 resume 重开;
 *  ssh/shell 或尚未绑定身份的会话无磁盘语义,不记)。 */
function diskRef(
  s: Pick<SessionMeta, "kind" | "cliSessionId" | "cwd" | "workspaceId"> | undefined,
): Pick<NotifyEntry, "cliSessionId" | "cwd" | "workspaceId"> | undefined {
  if (!s || (s.kind ?? "cli") !== "cli" || !s.cliSessionId) return undefined;
  return { cliSessionId: s.cliSessionId, cwd: s.cwd, workspaceId: s.workspaceId };
}

/** 返回是否真发了 OS 通知(闸放行);调用方据此维护去重集合 —— 被闸拦下的
 *  ask 不能记入 waitingNotified,否则失焦补扫会把它当「已提醒」跳过。 */
function dispatch(kind: NotifyKind, sessionId: string): boolean {
  const { settings } = getSettingsState();
  const { title, body } = notifyText(kind, sessionId, host);
  const meta = host.getSessions().find((s) => s.id === sessionId);
  recordNotifyEntry(
    {
      kind: kind === "turnEnd" ? "turn" : "ask",
      sessionId,
      profileId: meta?.profileId,
      ...diskRef(meta),
      title,
      snippet: body,
    },
    settings.notifyLogDays,
  );
  /* 会话级静音闸:流水已记,只拦 OS/声音;未落盘会话 = 不静音,行为与现状一致。 */
  if (isSessionMuted(sessionId, kind)) return false;
  if (!shouldNotify(kind, settings, host.isWindowFocused(), settings)) return false;
  void sendOsNotification(title, body, () => {
    host.events.emit(KernelTopics.sessionViewRequested, null); /* 点通知 = 用户手势,摘最大化 */
    host.setActiveSession(sessionId);
  });
  return true;
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
        /* 只在 OS 通知真发出时记入去重集合;聚焦期被闸拦下的 ask 留给失焦补扫 */
        if (dispatch("ask", id)) waitingNotified.add(id);
      }),
      ctx.events.on<{ sessionId: string; unviewed: boolean }>(
        KernelTopics.turnSettled,
        (e) => {
          waitingNotified.delete(e.sessionId);
          if (e.unviewed) dispatch("turnEnd", e.sessionId);
          /* snooze 到期自清:全会话都清(不止 unviewed);先闸后清,结算这轮仍被拦。
             只清 snooze 档,mute/full 手动档不受事件影响。 */
          const muteKey = tmdSessionMuteKey(e.sessionId, host);
          if (muteKey !== undefined) clearSnooze(muteKey);
        },
      ),
      ctx.events.on<SessionExitedDetailEvent>(KernelTopics.sessionExitedDetail, (e) => {
        const { settings } = getSettingsState();
        const name = e.title || host.getCliProfile(e.profileId)?.name || e.profileId;
        const { title, body } = notifyText("exit", e.sessionId, host, name);
        /* 流水先记(全量历史,免打扰也记),OS 才受闸。 */
        recordNotifyEntry(
          { kind: "exit", sessionId: e.sessionId, profileId: e.profileId, ...diskRef(e), title, snippet: body },
          settings.notifyLogDays,
        );
        /* 会话级静音闸:身份取自移除前快照;snooze 放行 exit(语义见 mute.ts)。 */
        if (isExitMuted(e)) return;
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
        /* 完全静音的 ask 不补扫不补记(边沿流水已在 dispatch 记过一条)。 */
        if (isSessionMuted(s.id, "ask")) continue;
        waitingNotified.add(s.id);
        const { title, body } = notifyText("ask", s.id, host);
        recordNotifyEntry(
          { kind: "ask", sessionId: s.id, profileId: s.profileId, ...diskRef(s), title, snippet: body },
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

    /* 额度侧:轻轮询三腿判定(窗口% / 余额 / claude 重置),实现见 quotaPoll.ts。 */
    const stopQuotaPoll = startQuotaPoll();

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
      stopQuotaPoll();
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("focus", onFocus);
      for (const off of offs) off();
    };
  },
};
