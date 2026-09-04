/**
 * 全局置顶区 —— 左侧栏顶部「已置顶」:跨工作区汇总 scope=global 的置顶会话。
 *
 * codemoss PinnedThreadList 适配:
 * - 平铺列表按置顶时间升序(tmd-cli 置顶规模小,不做 codemoss 的日历日分组);
 * - 段折叠态持久化 localStorage(纯 UI 态,不污染 settings schema);
 * - 行标题:手动命名覆盖层 > 置顶快照 > 短码;快照缺失或为短码垃圾(历史缺陷
 *   把 shortId 存成了快照)时读磁盘解析真标题并回填快照(节流重试,见下);
 * - 行点击:绑定的活会话 → 切到该会话;否则按原工作区恢复磁盘会话;
 * - 绑定活会话的行:meta 区亮状态 label(运行时/会话结束-未查看/已查看),
 *   正在查看时左侧引擎图标让位给 Eye,切走还原(与组内行同口径);
 * - 右键菜单无删除项:全局区不持有磁盘文件路径,删除回工作区分组操作
 *   (先「置顶到工作区内」迁移回组,或「取消置顶」后组内删除)。
 */

import { useEffect, useRef, useState } from "react";
import type { CliProfile } from "@kernel/cli";
/* 经 cli-shared 消费 jsonl 标题行型(无生命周期格式库,插件零直接依赖铁律
 * 下的合法通道,同 welcome/credentials.ts 的依赖声明)。 */
import { extractJsonlTitle, TITLE_HEAD_BYTES } from "../cli-shared/diskSessions";
import { host, useHost } from "@kernel/host";
import { ipc } from "@kernel/ipc";
import { useSettingsState } from "@kernel/settings";
import {
  listSessionPins,
  refreshPinTitle,
  toggleSessionPin,
  unpinSession,
  type SessionPinEntry,
} from "@kernel/sessionPins";
import { noteSessionTabTitle } from "@kernel/sessionTabs";
import { sessionTitleKey, setSessionTitle, shortId } from "@kernel/sessionTitles";
import { useWorkspaces, type Workspace } from "@kernel/workspace";
import { ChevronDown, ChevronRight, Eye, Pin } from "lucide-react";
import { SessionContextMenu } from "./SessionContextMenu";
import { realPinSnapshot } from "./utils";
import { PinToggle, RenameInput, SessionStatusLabel, type RenameTarget } from "./SessionRows";

/** 段折叠态存储 key(纯 UI 态,localStorage 即可,浏览器/Tauri 行为一致)。 */
const COLLAPSED_KEY = "tmd.pinnedSectionCollapsed";

/** 快照缺失/短码垃圾行的磁盘解析重试:3s 起步指数退避至 24s 封顶,
 * 8 次后放弃(共 ~2.4min)。omp 懒落盘晚 spawn 35-44s 在窗口内;文件已删
 * 的置顶不再永续扫描(此前固定 3s interval 无限轮询)。 */
const TITLE_RESOLVE_RETRY_MS = 3_000;
const TITLE_RESOLVE_MAX_BACKOFF_MS = 24_000;
const TITLE_RESOLVE_MAX_ATTEMPTS = 8;

/** 解析成功的全局置顶行:身份 + 所属工作区/CLI 均已就位。 */
interface PinnedRow {
  key: string;
  entry: SessionPinEntry;
  cliSessionId: string;
  workspace: Workspace;
  profile: CliProfile;
}

export function PinnedSessionsSection() {
  useHost();
  const { list: workspaces } = useWorkspaces();
  const { settings } = useSettingsState();
  const [collapsed, setCollapsed] = useState(
    () => localStorage.getItem(COLLAPSED_KEY) === "1",
  );
  const [menu, setMenu] = useState<{ row: PinnedRow; x: number; y: number } | null>(
    null,
  );
  const [renaming, setRenaming] = useState<RenameTarget | null>(null);

  const profiles = host.getCliProfiles();
  const rows: PinnedRow[] = listSessionPins(settings.sessionPins, {
    scope: "global",
  }).flatMap((pin) => {
    const workspace = workspaces.find((w) => w.id === pin.workspaceId);
    const profile = profiles.find((p) => p.id === pin.profileId);
    return workspace && profile
      ? [{ key: pin.key, entry: pin.entry, cliSessionId: pin.cliSessionId, workspace, profile }]
      : [];
  });

  /* 快照缺失或为短码垃圾(历史缺陷)的置顶行:读磁盘解析真标题并经 refreshPinTitle
   * 回填 settings —— 回填后全局区恢复免磁盘扫描;解析不到(文件未落盘)节流重试。 */
  const rowsRef = useRef(rows);
  rowsRef.current = rows;
  const unresolvedKeys = rows
    .filter(
      (r) =>
        !settings.sessionTitles[sessionTitleKey(r.profile.id, r.cliSessionId)] &&
        !realPinSnapshot(r.entry.title, r.cliSessionId),
    )
    .map((r) => r.key)
    .join("|");

  useEffect(() => {
    if (!unresolvedKeys) return;
    const keys = new Set(unresolvedKeys.split("|"));
    let stale = false;
    let timer: number | undefined;
    let attempts = 0;
    const attempt = async () => {
      for (const row of rowsRef.current) {
        if (!keys.has(row.key) || !row.profile.listSessions) continue;
        const list = await row.profile.listSessions(row.workspace.root).catch(() => []);
        if (stale) return;
        const hit = list.find((s) => s.id === row.cliSessionId);
        const head = hit
          ? await ipc.fsReadHead(hit.path, TITLE_HEAD_BYTES).catch(() => "")
          : "";
        const title = head ? extractJsonlTitle(head) : undefined;
        if (stale) return;
        if (title) refreshPinTitle(row.key, title);
      }
    };
    const schedule = () => {
      if (stale || attempts >= TITLE_RESOLVE_MAX_ATTEMPTS) return;
      attempts += 1;
      const delay = Math.min(
        TITLE_RESOLVE_RETRY_MS * 2 ** (attempts - 1),
        TITLE_RESOLVE_MAX_BACKOFF_MS,
      );
      timer = window.setTimeout(() => {
        void attempt().then(schedule);
      }, delay);
    };
    void attempt().then(schedule);
    return () => {
      stale = true;
      window.clearTimeout(timer);
    };
  }, [unresolvedKeys]);

  if (rows.length === 0) return null;

  const toggleCollapsed = () => {
    const next = !collapsed;
    setCollapsed(next);
    localStorage.setItem(COLLAPSED_KEY, next ? "1" : "0");
  };


  /** 行标题:手动命名 > 置顶快照(短码垃圾视为无快照) > 短码。 */
  const titleOf = (row: PinnedRow): string =>
    settings.sessionTitles[sessionTitleKey(row.profile.id, row.cliSessionId)] ??
    realPinSnapshot(row.entry.title, row.cliSessionId) ??
    shortId(row.cliSessionId);

  /** 绑定的活会话(同工作区 + 同 CLI + 同磁盘身份);存在则点击 = 切会话。 */
  const liveOf = (row: PinnedRow) =>
    host
      .getSessions()
      .find(
        (s) =>
          s.workspaceId === row.workspace.id &&
          s.profileId === row.profile.id &&
          host.getCliSessionId(s.id) === row.cliSessionId,
      );

  const openRow = (row: PinnedRow) => {
    const live = liveOf(row);
    if (live) {
      noteSessionTabTitle(live.id, titleOf(row));
      host.setActiveSession(live.id);
      return;
    }
    void host
      .openDiskSession(
        row.profile.id,
        row.workspace.root,
        row.workspace.id,
        row.cliSessionId,
      )
      .then((meta) => noteSessionTabTitle(meta.id, titleOf(row)));
  };

  const commitRename = (value: string | null) => {
    if (renaming && value !== null) {
      setSessionTitle(renaming.profileId, renaming.cliSessionId, value);
    }
    setRenaming(null);
  };

  return (
    <div className="pinned-sessions" data-pinned-section="">
      <button
        type="button"
        className={`pinned-sessions-header${collapsed ? " is-collapsed" : ""}`}
        aria-expanded={!collapsed}
        title={collapsed ? "展开已置顶" : "收起已置顶"}
        onClick={toggleCollapsed}
      >
        <Pin size={11} className="pinned-sessions-header-icon" aria-hidden />
        <span className="pinned-sessions-header-label">已置顶</span>
        <span className="pinned-sessions-header-count">· {rows.length}</span>
        {collapsed ? (
          <ChevronRight size={12} className="pinned-sessions-header-chevron" aria-hidden />
        ) : (
          <ChevronDown size={12} className="pinned-sessions-header-chevron" aria-hidden />
        )}
      </button>

      {!collapsed &&
        rows.map((row) => {
          const live = liveOf(row);
          const isActive = live !== undefined && live.id === host.getActiveSessionId();
          if (
            renaming &&
            renaming.profileId === row.profile.id &&
            renaming.cliSessionId === row.cliSessionId
          ) {
            return (
              <div key={row.key} className="thread-row is-renaming">
                <span className="thread-engine-badge" title={row.profile.name}>
                  {row.profile.renderIcon?.(12)}
                </span>
                <RenameInput target={renaming} onCommit={commitRename} />
              </div>
            );
          }
          return (
            <button
              key={row.key}
              className={`thread-row${isActive ? " active" : ""}`}
              title={`${row.workspace.name} · ${row.profile.name} 会话 ${row.cliSessionId}`}
              onClick={() => openRow(row)}
              onContextMenu={(e) => {
                e.preventDefault();
                setMenu({ row, x: e.clientX, y: e.clientY });
              }}
            >
              {/* 正在查看:引擎图标槽位让位给 Eye,切走还原 */}
              <span className="thread-engine-badge" title={row.profile.name}>
                {isActive ? <Eye size={13} className="thread-viewing-eye" /> : row.profile.renderIcon?.(12)}
              </span>
              <span className="thread-name">{titleOf(row)}</span>
              <span className="thread-meta">
                {/* 绑定活会话:状态校准 label(与组内行同口径,实时刷新) */}
                {live ? <SessionStatusLabel sessionId={live.id} /> : null}
                {/* 绑定的活会话正等待确认:同组内行,置顶区也亮「等待确认」标签 */}
                {live && host.isWaitingConfirm(live.id) ? (
                  <span className="thread-ask-badge">等待确认</span>
                ) : null}
                <span className="thread-time">{row.workspace.name}</span>
                <PinToggle on onToggle={() => unpinSession(row.key)} />
              </span>
            </button>
          );
        })}

      {menu && (
        <SessionContextMenu
          position={{ x: menu.x, y: menu.y }}
          canRename
          pinScope="global"
          onCopyId={() => {
            void navigator.clipboard
              ?.writeText(menu.row.cliSessionId)
              .catch(() => undefined);
          }}
          onRename={() =>
            setRenaming({
              profileId: menu.row.profile.id,
              cliSessionId: menu.row.cliSessionId,
              current:
                settings.sessionTitles[
                  sessionTitleKey(menu.row.profile.id, menu.row.cliSessionId)
                ] ?? "",
            })
          }
          onPinScope={(scope) =>
            toggleSessionPin(menu.row.key, scope, titleOf(menu.row))
          }
          onClose={() => setMenu(null)}
        />
      )}
    </div>
  );
}
