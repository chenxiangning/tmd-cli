/**
 * 会话行右键菜单 —— 活会话/磁盘会话/全局置顶区共用。
 * 复刻 wsmenu 视觉(portal + fixed + backdrop + Escape);删除为两步确认
 * (首击武装 → 再击执行),防误删物理文件。
 *
 * 置顶双作用域(codemoss 复刻):置顶到全局 / 置顶到工作区内。
 * 当前作用域带 ✓ 前缀,点当前 = 取消置顶,点另一 = 迁移作用域。
 * (worktree 入口已收编到工作区右键菜单,会话级入口按 2026-10-18 反馈移除。)
 */

import { useState } from "react";
import { createPortal } from "react-dom";
import { Bell, BellSlash, Copy, DownloadSimple, Pencil, Timer, Trash } from "@phosphor-icons/react";
import { useEscClose } from "@kernel/DialogShell";
import { useSettingsState } from "@kernel/settings";
import {
  SESSION_MUTE_MODES,
  muteSession,
  sessionMuteModeLabel,
  unmuteSession,
  type SessionMuteMode,
} from "@kernel/sessionMutes";
import type { SessionPinScope } from "@kernel/sessionPins";
import type { ReactNode } from "react";
import { t } from "@kernel/i18n";
import { clampMenuPosition } from "./utils";
import { PinIcon } from "@kernel/PinIcon";

/** 静音档位图标:静音通知 = 铃(ask 仍响)/ 完全静音 = 斜铃 / snooze = 计时。 */
const MUTE_MODE_ICONS: Record<SessionMuteMode, ReactNode> = {
  mute: <Bell size="0.8125rem" />,
  full: <BellSlash size="0.8125rem" />,
  snooze: <Timer size="0.8125rem" />,
};

export function SessionContextMenu({
  position,
  /** 未绑定磁盘身份的活会话:不可重命名/置顶(覆盖层以 CLI 身份为 key)。 */
  canRename,
  /** 当前置顶作用域;null = 未置顶;undefined = 不可置顶(未落盘)。 */
  pinScope,
  /** 静音覆盖层 key;undefined = 不可静音(未落盘,整组隐藏,同 pinScope 前例)。 */
  muteKey,
  onExportSnapshot,
  onCopyId,
  onRename,
  onPinScope,
  onDelete,
  onClose,
}: {
  position: { x: number; y: number };
  canRename: boolean;
  pinScope: SessionPinScope | null | undefined;
  /** undefined = 未落盘整组隐藏;null = 未静音;有值 = 已静音(档位见 entry)。 */
  muteKey?: string;
  /** 导出转录快照(当前磁盘快照,单文件另存);undefined = 隐藏(无磁盘绑定/ssh/shell)。 */
  onExportSnapshot?: () => void;
  onCopyId: () => void;
  onRename: () => void;
  onPinScope: (scope: SessionPinScope) => void;
  /** 缺省时隐藏删除项(全局置顶区不持有磁盘文件路径,删除回工作区分组操作)。 */
  onDelete?: () => void;
  onClose: () => void;
}) {
  /** 删除武装态:首击仅进入确认,再击执行物理删除。 */
  const [armed, setArmed] = useState(false);
  const pos = clampMenuPosition(position.x, position.y);
  /* 静音档随 settings 订阅实时(菜单存活期内他处改动同步)。 */
  const { settings } = useSettingsState();
  const muteEntry = muteKey === undefined ? undefined : (settings.sessionMutes[muteKey] ?? null);

  useEscClose(onClose);

  const pinItem = (scope: SessionPinScope, label: string) => (
    <button
      className="wsmenu-item"
      disabled={pinScope === undefined}
      title={pinScope === undefined ? t("会话尚未落盘,暂不可置顶") : undefined}
      onClick={() => {
        onPinScope(scope);
        onClose();
      }}
    >
      <span className="wsmenu-item-icon">
        <PinIcon size="0.8125rem" />
      </span>
      <span className="wsmenu-item-label">
        {pinScope === scope ? `✓ ${label}` : label}
      </span>
    </button>
  );

  return createPortal(
    <>
      {/* 透明背板:纯点外关闭(左键/右键皆关),role=presentation 豁免静态元素交互规则 */}
        <div
          className="wsmenu-backdrop"
          role="presentation"
          onClick={onClose}
          onContextMenu={(e) => {
            e.preventDefault();
            onClose();
          }}
        />
        <div className="wsmenu session-menu" data-icon-decor="menu" style={{ left: pos.x, top: pos.y }}>
        <button
          className="wsmenu-item"
          onClick={() => {
            onCopyId();
            onClose();
          }}
        >
          <span className="wsmenu-item-icon">
            <Copy size="0.8125rem" />
          </span>
          <span className="wsmenu-item-label">{t("复制 Session ID")}</span>
        </button>
        <button
          className="wsmenu-item"
          disabled={!canRename}
          title={canRename ? undefined : t("会话尚未落盘,暂不可命名")}
          onClick={() => {
            onRename();
            onClose();
          }}
        >
          <span className="wsmenu-item-icon">
            <Pencil size="0.8125rem" />
          </span>
          <span className="wsmenu-item-label">{t("重命名")}</span>
        </button>
        {pinItem("global", t("置顶到全局"))}
        {pinItem("workspace", t("置顶到工作区内"))}
        {muteEntry !== undefined ? (
          <>
            <div className="wsmenu-divider" />
            {/* 已静音:首项 = 取消静音(当前档位括注);档位行可换档,当前档禁用。 */}
            {muteEntry ? (
              <button
                className="wsmenu-item"
                onClick={() => {
                  if (muteKey !== undefined) unmuteSession(muteKey);
                  onClose();
                }}
              >
                <span className="wsmenu-item-icon">
                  <BellSlash size="0.8125rem" />
                </span>
                <span className="wsmenu-item-label">
                  {t("取消静音({mode})", { mode: sessionMuteModeLabel(muteEntry.mode) })}
                </span>
              </button>
            ) : null}
            {SESSION_MUTE_MODES.map((mode) => (
              <button
                key={mode}
                className="wsmenu-item"
                disabled={muteEntry?.mode === mode}
                onClick={() => {
                  if (muteKey !== undefined) muteSession(muteKey, mode);
                  onClose();
                }}
              >
                <span className="wsmenu-item-icon">{MUTE_MODE_ICONS[mode]}</span>
                <span className="wsmenu-item-label">
                  {muteEntry?.mode === mode
                    ? `✓ ${sessionMuteModeLabel(mode)}`
                    : sessionMuteModeLabel(mode)}
                </span>
              </button>
            ))}
          </>
        ) : null}
        {onExportSnapshot ? (
          <>
            <div className="wsmenu-divider" />
            <button
              className="wsmenu-item"
              onClick={() => {
                onExportSnapshot();
                onClose();
              }}
            >
              <span className="wsmenu-item-icon">
                <DownloadSimple size="0.8125rem" />
              </span>
              <span className="wsmenu-item-label">{t("导出转录快照")}</span>
            </button>
          </>
        ) : null}
        {onDelete ? (
          <>
            <div className="wsmenu-divider" />
            <button
              className={`wsmenu-item is-danger${armed ? " is-armed" : ""}`}
              onClick={() => {
                if (!armed) {
                  setArmed(true);
                  return;
                }
                onDelete();
                onClose();
              }}
            >
              <span className="wsmenu-item-icon">
                <Trash size="0.8125rem" data-icon-keep />
              </span>
              <span className="wsmenu-item-label">
                {armed ? t("确认删除?") : t("删除会话")}
              </span>
            </button>
          </>
        ) : null}
      </div>
    </>,
    document.body,
  );
}
