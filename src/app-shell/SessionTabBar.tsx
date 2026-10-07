/**
 * 会话标题 tab 条 —— 顶栏中央展示打开的会话(容量可配 settings.sessionTabsMax,见 kernel/sessionTabs)。
 *
 * 数据:kernel/sessionTabs MRU(纯事件驱动,打开次序稳定)+ host 活跃指针。
 * 交互:点击切会话;× = 摘 tab 不杀会话(PTY 继续跑,侧栏仍在,见 store 契约);
 * 行内钮收敛(2026-10-02):hover 只浮 ×,查看转录/置顶/定位收进右键菜单。
 * 溢出与编辑 tab 条统一:横滚走马灯 + 右缘渐隐(有溢出且未到头才挂)。
 * 单 tab 与菜单拆为本文件内 SessionTab/SessionTabMenu(no-high-complexity)。
 */

import { memo, useState, useCallback } from "react";
import { Cross } from "@phosphor-icons/react";
import { isSessionPinned, pinSession, sessionPinKey, unpinSession } from "@kernel/sessionPins";
import { PinIcon } from "@kernel/PinIcon";
import { isSessionViewAvailable, openSessionViewTab } from "@kernel/sessionViewTabs";
import { requestSessionReveal } from "@kernel/sessionReveal";
import { relayLiveRef } from "@kernel/relayBridge";
import { shellLeftEnsureOpen } from "./shortcutCommands";
import { sessionTabState } from "@kernel/sessionTabState";
import { host, useHost } from "@kernel/host";
import { t } from "@kernel/i18n";
import { RenameInput, type RenameTarget } from "@kernel/RenameInput";
import { useSettingsState } from "@kernel/settings";
import {
  closeAllSessionTabs,
  closeOtherSessionTabs,
  closeSessionTab,
  getSessionTabTitle,
  toggleSessionTile,
  useSessionTabs,
} from "@kernel/sessionTabs";
import { sessionTitleKey, setSessionTitle, shortId } from "@kernel/sessionTitles";
import { TabContextMenu } from "./TabContextMenu";

/** 标题解析:手动命名 > 打开快照 > meta 标题 > 短码(与渲染优先级同源);meta 缺席 = 会话已逝。 */
function resolveTabTitle(
  titleOverrides: Record<string, string>,
  id: string,
): string | undefined {
  const meta = host.getSessions().find((s) => s.id === id);
  if (!meta) return undefined;
  const cliSessionId = host.getCliSessionId(id);
  return (
    (cliSessionId
      ? titleOverrides[sessionTitleKey(meta.profileId, cliSessionId)]
      : undefined) ??
    getSessionTabTitle(id) ??
    meta.title ??
    shortId(meta.id)
  );
}

/** tab 悬停 title:等待确认/空闲态缀状态后缀(真值表见 kernel/sessionTabState)。 */
function hoverTitle(state: string, title: string): string {
  if (state === "waiting") return t("{title} · 等待确认", { title });
  return state === "idle" ? t("{title} · 空闲", { title }) : title;
}

/** 三态点/后缀:等待确认(呼吸绿)> 运行中(静止绿)> 未读(accent)> 空闲(灰);无对话基线不出点。 */
function tabDot(state: string) {
  if (state === "waiting") return <span className="session-tab-dot is-ask" aria-hidden />;
  if (state === "running") return <span className="session-tab-dot is-run" aria-hidden />;
  if (state === "unread") return <span className="session-tab-dot" aria-hidden />;
  if (state === "idle") return <span className="session-tab-dot is-idle" aria-hidden />;
  return null;
}

/** 单会话 tab:三态点/标题/置顶常亮指示/× 与重命名态全在此;菜单经 onOpenMenu 上抛。 */
function SessionTab({
  id,
  renaming,
  onRenameCommit,
  onOpenMenu,
}: {
  id: string;
  renaming: RenameTarget | null;
  onRenameCommit: (value: string | null) => void;
  onOpenMenu: (e: React.MouseEvent) => void;
}) {
  const { settings } = useSettingsState(); /* 手动命名覆盖层 */
  /* 竞态防御:sessionsChanged 广播前先卸载消失 tab。 */
  const meta = host.getSessions().find((s) => s.id === id);
  if (!meta) return null;
  const resolved = resolveTabTitle(settings.sessionTitles, id);
  const title = resolved ?? shortId(meta.id);
  const active = host.getActiveSessionId() === id;
  const cliSessionId = host.getCliSessionId(id);
  const pinKey =
    cliSessionId !== undefined && meta.workspaceId
      ? sessionPinKey(meta.workspaceId, meta.profileId, cliSessionId)
      : undefined;
  const pinned = pinKey !== undefined && isSessionPinned(pinKey);
  /* 三态点:等待确认 > 运行中 > 未读 > 空闲(真值表见 kernel/sessionTabState)。 */
  const tabState = sessionTabState(host.isWaitingConfirm(id), host.isTurnActive(id), host.isUnread(id), host.getLastActivityAt(id));
  return (
    /* tab 语义在内层 switch 原生 button;外层仅容器。 */
    <div
      className={`session-tab${active ? " is-active" : ""}`}
      onContextMenu={onOpenMenu}
    >
      {renaming ? (
        <RenameInput
          className="session-tab-rename-input"
          target={renaming}
          onCommit={onRenameCommit}
        />
      ) : (
        <>
          <button
            type="button"
            role="tab"
            aria-selected={active}
            className="session-tab-switch"
            title={hoverTitle(tabState, title)}
            onClick={() => host.setActiveSession(id)}
          >
            {host.getCliProfile(meta.profileId)?.renderIcon?.("0.75rem")}
            {tabDot(tabState)}
            <span className="session-tab-label">{title}</span>
          </button>
          {/* 已置顶常亮实心指示(行内钮收敛的唯一例外:状态可见性优先);
              点击即取消,置顶入口走右键菜单。 */}
          {pinned ? (
            <button
              type="button"
              className="session-tab-pin"
              aria-label={t("取消置顶")}
              title={t("取消置顶")}
              onClick={() => {
                if (!pinKey) return;
                unpinSession(pinKey);
              }}
            >
              <PinIcon size="0.75rem" />
            </button>
          ) : null}
          <button
            type="button"
            className="session-tab-remove"
            aria-label={t("从标签条移除:{title}", { title })}
            title={t("从标签条移除(会话保持运行)")}
            onClick={() => closeSessionTab(id)}
          >
            {/* R7 归档:tab 行内钮 10px→12px */}
            <Cross size="0.75rem" aria-hidden />
          </button>
        </>
      )}
    </div>
  );
}

/** 右键菜单挂接:重命名(行内输入,未落盘禁用)/ 查看转录(可用才显)/ 置顶(未落盘
 *  禁用)/ 定位 / 平铺(全局开关)/ 关闭族 —— 菜单项契约见 TabContextMenu。 */
function SessionTabMenu({
  menu,
  tile,
  onRenaming,
  onClose,
}: {
  menu: { x: number; y: number; id: string };
  tile: boolean;
  onRenaming: (target: { id: string; target: RenameTarget }) => void;
  onClose: () => void;
}) {
  /* 菜单存活期会话可能已退出/落盘未绑定,项级动作各自防御。 */
  const { settings } = useSettingsState();
  const meta = host.getSessions().find((s) => s.id === menu.id);
  const cliSessionId = host.getCliSessionId(menu.id);
  const pinKey = meta && cliSessionId !== undefined && meta.workspaceId
    ? sessionPinKey(meta.workspaceId, meta.profileId, cliSessionId) : undefined;
  /* 转录查看项:磁盘可读且查看器在册才显(session-viewer 注册面)。 */
  const canView =
    meta != null &&
    cliSessionId !== undefined &&
    host.getCliProfile(meta.profileId)?.readSessionTranscript != null &&
    isSessionViewAvailable();
  const resolved = resolveTabTitle(settings.sessionTitles, menu.id);
  /* pin 快照只存真实标题,短码兜底不入库(与侧栏 PinToggle 同语义)。 */
  const pinSnapshot = resolved !== shortId(menu.id) ? resolved : undefined;
  return (
    <TabContextMenu
      position={{ x: menu.x, y: menu.y }}
      canRename={cliSessionId != null}
      onToggleTile={toggleSessionTile}
      tileActive={tile}
      onView={
        canView && meta && cliSessionId !== undefined
          ? () =>
              openSessionViewTab({
                profileId: meta.profileId,
                cliSessionId,
                title: resolved ?? shortId(menu.id),
                cwd: meta.cwd,
              })
          : undefined
      }
      onRelay={meta?.kind === "cli" && relayLiveRef.current ? () => relayLiveRef.current?.(menu.id) : undefined}
      onTogglePin={() =>
        pinKey && (isSessionPinned(pinKey) ? unpinSession(pinKey) : pinSession(pinKey, "global", pinSnapshot))
      }
      canPin={pinKey != null}
      pinned={pinKey !== undefined && isSessionPinned(pinKey)}
      onLocate={() => {
        shellLeftEnsureOpen.current?.(); requestSessionReveal(menu.id);
      }}
      onRename={() => {
        if (!meta || !cliSessionId) return;
        onRenaming({
          id: menu.id,
          target: {
            profileId: meta.profileId,
            cliSessionId,
            current: resolved ?? "",
          },
        });
      }}
      onCloseTab={() => closeSessionTab(menu.id)}
      onCloseOthers={() => closeOtherSessionTabs(menu.id)}
      onCloseAll={() => closeAllSessionTabs()}
      onClose={onClose}
    />
  );
}

function SessionTabBarImpl() {
  /* 溢出感知:可滚且未到头才挂右缘渐隐 fade-end(评审 B2,常驻会裁最后一张)。 */
  const [fadeEnd, setFadeEnd] = useState(false);
  const updateFade = (el: HTMLDivElement) =>
    setFadeEnd(el.scrollWidth - el.clientWidth - el.scrollLeft > 1);
  const tabsRef = useCallback(
    (el: HTMLDivElement | null) => {
      if (el) updateFade(el);
    },
    [],
  );
  useHost(); /* 活跃指针 / 会话存活 / 身份绑定 / 未读标记变化 */
  const { settings } = useSettingsState(); /* 开关(手动命名覆盖层随子组件订阅) */
  const { ids, tile } = useSessionTabs();
  /** 右键菜单目标:null 关闭。 */
  const [menu, setMenu] = useState<{ x: number; y: number; id: string } | null>(null);
  /** 行内重命名目标:tmd 会话 id + 磁盘身份 key(重命名态替换 tab 标签为输入框)。 */
  const [renaming, setRenaming] = useState<{ id: string; target: RenameTarget } | null>(null);

  /** 重命名提交:null=取消;空串=清除命名回归默认标题。会话中途退出则丢弃。 */
  const commitRename = (value: string | null) => {
    if (renaming && value !== null) {
      const alive = host.getSessions().some((s) => s.id === renaming.id);
      if (alive) {
        setSessionTitle(
          renaming.target.profileId,
          renaming.target.cliSessionId,
          value,
        );
      }
    }
    setRenaming(null);
  };

  if (!settings.sessionTabsEnabled || ids.length === 0) return null;

  return (
    <div
      ref={tabsRef}
      className={`session-tabs${fadeEnd ? " fade-end" : ""} tmd-scroll-hide`}
      role="tablist"
      aria-label={t("打开的会话")}
      /* 竖向滚轮转横向走马灯(与编辑 tab 条同款);scroll/wheel 后复算渐隐挂否。 */
      onWheel={(e) => {
        e.currentTarget.scrollLeft += e.deltaY + e.deltaX;
        updateFade(e.currentTarget);
      }}
      onScroll={(e) => updateFade(e.currentTarget)}
    >
      {ids.map((id) => (
        <SessionTab
          key={id}
          id={id}
          renaming={renaming?.id === id ? renaming.target : null}
          onRenameCommit={commitRename}
          onOpenMenu={(e) => {
            e.preventDefault();
            setMenu({ x: e.clientX, y: e.clientY, id });
          }}
        />
      ))}
      {menu ? (
        <SessionTabMenu
          menu={menu}
          tile={tile}
          onRenaming={setRenaming}
          onClose={() => setMenu(null)}
        />
      ) : null}
    </div>
  );
}

export const SessionTabBar = memo(SessionTabBarImpl);
