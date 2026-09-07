/**
 * 会话管理模式 —— CLI 分组内的批量管理面(GroupHeader 开关进入,per-group)。
 * - 行 = div(非 button,避免交互件嵌套):复选框 + 标题 + 行尾归档/删除按钮
 * - 多选:左键按下锚定行,按住滑动 → 锚点状态向扫过的行扩散(mail 式拖选),
 *   点按 = 单行 toggle;命中测试用 elementFromPoint,免受按钮/文本节点干扰
 * - 批量条:选中数 + 归档(归档视图为「恢复」)+ 删除;删除两步武装确认
 *   (与右键菜单删除同语义),行内删除按钮同样两步
 * - 归档/恢复 = kernel/sessionArchive 覆盖层写 settings,即时生效
 * - 数据(活/置顶/分页磁盘行)复用 useCliSessionGroup 装配,本组件只管交互
 */

import { useRef, useState } from "react";
import { Archive, TrayArrowUp, Check, Trash } from "@phosphor-icons/react";
import type { CliDiskSession, CliProfile } from "@kernel/cli";
import { host } from "@kernel/host";
import type { SessionMeta } from "@kernel/ipc";
import { useSettingsState } from "@kernel/settings";
import { t } from "@kernel/i18n";
import { formatRelativeTime } from "@kernel/relativeTime";
import {
  archiveSession,
  sessionArchiveKey,
  unarchiveSession,
} from "@kernel/sessionArchive";
import type { Workspace } from "@kernel/workspace";
import { PAGE_INITIAL } from "./utils";
import { DangerAction } from "./DangerAction";

/** 管理行:活会话(PTY 态)或磁盘会话(文件态);key 在本组行集内唯一。 */
type ManageRow =
  | { kind: "live"; key: string; session: SessionMeta; cliSessionId: string | undefined }
  | { kind: "disk"; key: string; session: CliDiskSession };

/** 拖选范围扩散:把 order[from..to] 按 val 增删,范围外保持不变;export 供单测。 */
export function selectRange(
  prev: Set<string>,
  order: string[],
  from: number,
  to: number,
  val: boolean,
): Set<string> {
  const next = new Set(prev);
  const lo = Math.min(from, to);
  const hi = Math.max(from, to);
  for (let i = lo; i <= hi; i++) {
    const key = order[i];
    if (key === undefined) continue;
    if (val) next.add(key);
    else next.delete(key);
  }
  return next;
}


/** 单个 CLI 分组的管理行列表(含批量条与分页)。 */
export function ManageList({
  profile,
  workspace,
  orderedLive,
  pinnedDisk,
  visible,
  remaining,
  setLimit,
  activeSessionId,
  displayTitle,
  onDeleteLive,
  onDeleteDisk,
}: {
  profile: CliProfile;
  workspace: Workspace;
  orderedLive: SessionMeta[];
  pinnedDisk: CliDiskSession[];
  visible: CliDiskSession[];
  remaining: number;
  setLimit: (updater: (limit: number) => number) => void;
  activeSessionId: string | null | undefined;
  displayTitle: (cliSessionId: string | undefined, fallbackId: string) => string;
  onDeleteLive: (session: SessionMeta) => Promise<void>;
  onDeleteDisk: (session: CliDiskSession) => Promise<void>;
}) {
  const { settings } = useSettingsState();
  const archiveViewOn = settings.workspaceArchiveView;
  const [selected, setSelected] = useState<Set<string>>(new Set());

  /** 行装配顺序与展示一致:置顶块 → 活会话 → 分页磁盘(拖选扩散依赖此顺序)。 */
  const rows: ManageRow[] = [
    ...pinnedDisk.map((s) => ({ kind: "disk", key: s.id, session: s }) as ManageRow),
    ...orderedLive.map(
      (s) =>
        ({ kind: "live", key: s.id, session: s, cliSessionId: host.getCliSessionId(s.id) }) as ManageRow,
    ),
    ...visible.map((s) => ({ kind: "disk", key: s.id, session: s }) as ManageRow),
  ];
  const orderRef = useRef(rows.map((r) => r.key));
  orderRef.current = rows.map((r) => r.key);
  /** 拖选锚点存 key 而非下标:拖选途中重扫(listSessions 补扫/活会话退出)重排行集时,
   *  下标会指向别的行,key 经 indexOf 重解区间起点,天然免疫重排。 */
  const dragRef = useRef<{ anchorKey: string; val: boolean } | null>(null);
  const lastIdxRef = useRef(-1);

  const idxFromPoint = (x: number, y: number): number => {
    const row = document.elementFromPoint(x, y)?.closest("[data-mrow]");
    const idx = row ? Number(row.getAttribute("data-mrow")) : Number.NaN;
    return Number.isInteger(idx) ? idx : -1;
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    const idx = idxFromPoint(e.clientX, e.clientY);
    if (idx < 0) return;
    e.preventDefault();
    const anchorKey = orderRef.current[idx];
    const val = !selected.has(anchorKey);
    dragRef.current = { anchorKey, val };
    lastIdxRef.current = idx;
    setSelected((prev) => selectRange(prev, orderRef.current, idx, idx, val));
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragRef.current) return;
    const idx = idxFromPoint(e.clientX, e.clientY);
    if (idx < 0 || idx === lastIdxRef.current) return;
    lastIdxRef.current = idx;
    const anchor = orderRef.current.indexOf(dragRef.current.anchorKey);
    if (anchor < 0) {
      dragRef.current = null;
      return;
    }
    setSelected((prev) => selectRange(prev, orderRef.current, anchor, idx, dragRef.current!.val));
  };

  const setArchived = (row: ManageRow, archived: boolean) => {
    const cliId =
      row.kind === "disk" ? row.session.id : host.getCliSessionId(row.session.id);
    if (!cliId) return;
    const key = sessionArchiveKey(workspace.id, profile.id, cliId);
    if (archived) archiveSession(key);
    else unarchiveSession(key);
  };

  const runDelete = async (row: ManageRow) => {
    if (row.kind === "live") await onDeleteLive(row.session);
    else await onDeleteDisk(row.session);
    setSelected((prev) => {
      const next = new Set(prev);
      next.delete(row.key);
      return next;
    });
  };

  const selectedRows = rows.filter((r) => selected.has(r.key));
  const batchToggleArchive = () => {
    selectedRows.forEach((r) => setArchived(r, !archiveViewOn));
    setSelected(new Set());
  };
  const batchDelete = async () => {
    for (const r of selectedRows) await runDelete(r);
  };

  const renderRow = (row: ManageRow, idx: number) => {
    const title =
      row.kind === "disk"
        ? displayTitle(row.session.id, row.session.id)
        : displayTitle(row.cliSessionId, row.session.id);
    const on = selected.has(row.key);
    const cannotArchive = row.kind === "live" && row.cliSessionId === undefined;
    return (
      <div
        key={row.key}
        data-mrow={idx}
        className={`thread-row wm-row${on ? " is-selected" : ""}${
          row.kind === "live" && row.session.id === activeSessionId ? " active" : ""
        }`}
      >
        <span className={`wm-check${on ? " is-on" : ""}`} aria-hidden>
          {on ? <Check size={10} /> : null}
        </span>
        <span className={`thread-name${row.kind === "disk" ? " is-disk" : ""}`}>{title}</span>
        <span className="thread-meta">
          {row.kind === "disk" ? (
            <span className="thread-time">{formatRelativeTime(row.session.modifiedAt)}</span>
          ) : null}
          <button
            type="button"
            className="wm-act"
            disabled={cannotArchive}
            title={
              archiveViewOn
                ? t("恢复到默认视图")
                : cannotArchive
                  ? t("会话尚未落盘,暂不可归档")
                  : t("归档(默认视图隐藏)")
            }
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              setArchived(row, !archiveViewOn);
            }}
          >
            {archiveViewOn ? <TrayArrowUp size={12} /> : <Archive size={12} />}
          </button>
          <DangerAction
            className="wm-act wm-danger"
            title={t("删除会话(物理删除)")}
            armedTitle={t("再击确认物理删除")}
            armedChildren={<span className="wm-danger-arm">{t("确认")}</span>}
            onConfirm={() => void runDelete(row)}
          >
            <Trash size={12} />
          </DangerAction>
        </span>
      </div>
    );
  };

  return (
    <div
      className="wm-list"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={() => (dragRef.current = null)}
      onPointerCancel={() => (dragRef.current = null)}
      onPointerLeave={() => (dragRef.current = null)}
    >
      {rows.map(renderRow)}
      {selectedRows.length > 0 && (
        <div className="wm-bar">
          <span className="wm-bar-count">{t("已选 {n}", { n: selectedRows.length })}</span>
          <button
            type="button"
            className="wm-bar-btn"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => batchToggleArchive()}
          >
            {archiveViewOn ? t("恢复") : t("归档")}
          </button>
          <DangerAction
            className="wm-bar-btn wm-danger"
            title={t("删除选中会话(物理删除)")}
            armedTitle={t("再击确认物理删除")}
            armedChildren={t("确认删除?")}
            onConfirm={() => void batchDelete()}
          >
            {t("删除")}
          </DangerAction>
        </div>
      )}
      {remaining > 0 && (
        <button
          className="thread-more"
          onClick={() => setLimit((l) => (l > 0 ? l * 2 : PAGE_INITIAL))}
        >
          {t("更多... (还有 {n} 条)", { n: remaining })}
        </button>
      )}
    </div>
  );
}
