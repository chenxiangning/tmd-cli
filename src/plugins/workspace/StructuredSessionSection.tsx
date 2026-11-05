/**
 * 带渲染的会话区 —— RPC 结构化会话行投影分区(RPC 会话体系对齐规划批次 1/2/5,
 * docs/brainstorm/2026-11-05-rpc-session-parity-plan.md)。
 *
 * 形态(2026-11-05 真机反馈定稿,参考设计稿 docs/design/rpc-session-parity.html
 * 图 2 结构):不做左栏全局置顶分区;每个工作区卡片内自组「带渲染的会话」小节,
 * 与终端会话(引擎分组)/远程组并列,行按 cwd === workspace.root 归属
 * (tab 开启时 cwd 即工作区根快照,身份同源)。无 workspace prop = 孤儿兜底
 * 渲染:只出 cwd 已不属于任何在册工作区的行(工作区被移除后,在途 RPC 会话
 * 不丢呈现面;常态渲染 null)。早期「工作区内嵌行」方案曾实施后回撤 —— 彼时
 * 与全局分区双份渲染;本次回撤全局分区,内嵌成为唯一呈现面,无双份问题。
 *
 * 数据 = kernel structuredSessionTabs 行投影(tab open 即出行)+ 结束账本
 * (structuredSessionEnded:tab 关闭后存续,点行 resume 重开,X 移除回落
 * 磁盘历史);不进 workspace sessions 派生链(R-PTY0:分组折叠/归档视图/
 * hygiene 扫描不波及本区,本区也不影响它们)。行点击激活中央 structured tab
 * (R-ISO2);关闭钮 = closeTab(kill 链路既有)。行右键菜单(跳转/重命名/
 * 静音/关闭)—— 覆盖层走 kernel 自有键,不接 sessionTitles/sessionMutes
 * (PTY sessionId 键,零共享)。
 */

import { useEffect, useState } from "react";
import { Chats } from "@phosphor-icons/react";
import { useHost } from "@kernel/host";
import { t } from "@kernel/i18n";
import { updateTab, useEditorTabs } from "@kernel/tabs";
import { getWorkspaces, useWorkspaces, type Workspace } from "@kernel/workspace";
import {
  noteSsTitleOverride,
  readSsTitleOverride,
  useStructuredSessionRows,
  type StructuredSessionRow,
} from "@kernel/structuredSessionTabs";
import { useClosedSsSessions } from "@kernel/structuredSessionEnded";
import { SsEndedRow, SsRow, SsRowMenu } from "./SsRow";
import { SectionLabel } from "./SectionLabel";
import { clampMenuPosition } from "./utils";

export function StructuredSessionSection({ workspace }: { workspace?: Workspace }) {
  useHost(); /* profile 注册变化(引擎图标/名称) */
  useWorkspaces(); /* 工作区增删 → 孤儿判据(cwd 归属全集)重算触发重渲 */
  const allRows = useStructuredSessionRows();
  const allClosed = useClosedSsSessions();
  /* 行归属:带 prop = 本工作区的行;无 prop = 孤儿兜底( cwd 已不匹配任何
   * 在册工作区根的行 —— 只此一处兜底渲染,常态为空)。 */
  const roots = new Set(getWorkspaces().map((w) => w.root));
  const inWorkspace = (cwd: string) =>
    workspace ? cwd === workspace.root : !roots.has(cwd);
  const rows = allRows.filter((r) => inWorkspace(r.cwd));
  /* 结束存续行隐藏判据:被活行认领(行绑定 sessionId 或 tab id 的 # resume
   * 目标 —— 握手期 sessionId 尚空,只认后者)即隐藏,避免双行。 */
  const claimedBy = new Set([
    ...rows.flatMap((r) => (r.sessionId ? [r.sessionId] : [])),
    ...rows.flatMap((r) => {
      const hash = r.tabId.lastIndexOf("#");
      return hash > 0 ? [r.tabId.slice(hash + 1)] : [];
    }),
  ]);
  const closed = allClosed.filter((c) => inWorkspace(c.cwd) && !claimedBy.has(c.sessionId));
  const activeId = useEditorTabs().activeId;
  /* working 计时:存在 busy 行才起 1s tick(行数少,分区级单 interval)。 */
  const [now, setNow] = useState(() => Date.now());
  const anyBusy = rows.some((r) => r.busy);
  useEffect(() => {
    if (!anyBusy) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [anyBusy]);
  /* 右键菜单与改名态(单例:同时至多一行在改名,PTY startRename 同律)。 */
  const [menu, setMenu] = useState<{ row: StructuredSessionRow; x: number; y: number } | null>(null);
  const [renamingTab, setRenamingTab] = useState<{ id: string; initial: string } | null>(null);
  if (rows.length === 0 && closed.length === 0) return null;
  return (
    <div className="ws-ss-section" data-structured-section="">
      {/* 小节头(静态标签,折叠由工作区卡片统一管辖;分组标识 = 通道缩写 RPC,
          全称「带渲染的会话」走悬浮提示;图标列对齐工作区文件夹图标)。 */}
      <SectionLabel
        icon={<Chats size="0.75rem" className="pinned-sessions-header-icon" aria-hidden />}
        text="RPC"
        count={rows.length + closed.length}
        title={t("带渲染的会话")}
      />
      {rows.map((row) => (
        <SsRow
          key={row.tabId}
          row={row}
          active={row.tabId === activeId}
          now={now}
          renaming={renamingTab?.id === row.tabId ? { profileId: row.profileId, cliSessionId: row.cwd, current: renamingTab.initial } : null}
          onCommitRename={(value) => {
            setRenamingTab(null);
            if (value === null) return; /* Esc = 取消 */
            const next = value.trim();
            if (next && next !== row.title) {
              noteSsTitleOverride(row.profileId, row.cwd, next);
              updateTab(row.tabId, { title: next });
            }
          }}
          onContextMenu={(e) => {
            e.preventDefault();
            setMenu({ row, ...clampMenuPosition(e.clientX, e.clientY) });
          }}
        />
      ))}
      {closed.map((c) => <SsEndedRow key={c.sessionId} row={c} active={false} />)}
      {menu && (
        <SsRowMenu
          row={menu.row}
          position={{ x: menu.x, y: menu.y }}
          onRename={() => {
            setRenamingTab({
              id: menu.row.tabId,
              initial: readSsTitleOverride(menu.row.profileId, menu.row.cwd) ?? menu.row.title,
            });
          }}
          onClose={() => setMenu(null)}
        />
      )}
    </div>
  );
}
