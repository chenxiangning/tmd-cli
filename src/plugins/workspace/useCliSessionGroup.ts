/**
 * CLI 会话分组数据 hook —— 自 SessionList.tsx 拆出(文件规模铁则)。
 *
 * 职责:磁盘历史扫描(listSessions 适配 + 身份绑定跳变补扫)、配额分页、
 * 置顶投影(workspace 组顶块 / global 离组)、活会话排序与行标题解析。
 * 纯数据装配,不含 JSX;菜单/重命名/删除等交互留在 SessionList 组件内。
 */

import { useEffect, useRef, useState } from "react";
import type { CliDiskSession, CliProfile } from "@kernel/cli";
import { host, useHost } from "@kernel/host";
import { resolveCliSessionQuota, useSettingsState } from "@kernel/settings";
import { listSessionPins } from "@kernel/sessionPins";
import { sessionTitleKey, shortId } from "@kernel/sessionTitles";
import type { Workspace } from "@kernel/workspace";
import { compareLiveSessions } from "./utils";

export function useCliSessionGroup({
  profile,
  workspace,
  refreshTick,
  onScanned,
}: {
  profile: CliProfile;
  workspace: Workspace;
  /** 外部刷新信号(工作区行刷新/菜单单项刷新):值变化即重扫。 */
  refreshTick: number;
  /** 扫描完成回调(驱动菜单刷新按钮的 spin 停止)。 */
  onScanned: () => void;
}) {
  useHost();
  const [sessions, setSessions] = useState<CliDiskSession[] | null>(null);
  const { settings } = useSettingsState();
  /**
   * 初始露出条数 = 显示预算解析配额(断裂修复:曾硬编码 PAGE_INITIAL,
   * settings.sessionListBudget 从不被消费,设置改了列表没反应)。
   * 预算数据归 kernel/settings 所有,session-budget 插件只是编辑器:
   * 拔出编辑器不改变数据语义(与拔出其它编辑器插件一致),
   * workspace 不感知该插件存在(零字符串 id 门控)。
   */
  const initialLimit = resolveCliSessionQuota(
    settings.sessionListBudget,
    profile.id,
    host.getCliProfiles().map((p) => p.id),
  );
  const [limit, setLimit] = useState(initialLimit);
  /** 预算修改响应式生效:按新配额重新起步(已展开的「更多」随之重置)。 */
  useEffect(() => {
    setLimit(initialLimit);
  }, [initialLimit]);
  /** 本地重扫信号:删除磁盘会话后立刻反映(不等外部刷新)。 */
  const [rescanTick, setRescanTick] = useState(0);
  /* 命名覆盖层变化(重命名提交)需重渲行标题 */
  const titleOverrides = settings.sessionTitles;
  const pins = settings.sessionPins;

  const liveSessions = host
    .getSessions()
    .filter((s) => s.workspaceId === workspace.id && s.profileId === profile.id);
  const activeSessionId = host.getActiveSessionId();
  /** 活会话已绑定的磁盘身份:磁盘行据此过滤,同一会话全局只出现一次。 */
  const liveCliIds = new Set(
    liveSessions
      .map((s) => host.getCliSessionId(s.id))
      .filter((id): id is string => id !== undefined),
  );

  /* 身份绑定跳变 → 磁盘重扫:omp 实证懒落盘晚于 spawn 35s+,spawn 时点的扫描看不到
   * 文件与标题;绑定成功即文件已出生,立即补扫,并延迟再补一次(自动命名晚 birth ~1s)。 */
  const boundCount = liveCliIds.size;
  const prevBoundCount = useRef(boundCount);
  useEffect(() => {
    if (boundCount === prevBoundCount.current) return;
    prevBoundCount.current = boundCount;
    setRescanTick((t) => t + 1);
    const catchUp = setTimeout(() => setRescanTick((t) => t + 1), 3_000);
    return () => clearTimeout(catchUp);
  }, [boundCount]);

  useEffect(() => {
    let stale = false;
    if (!profile.listSessions) return;
    void profile
      .listSessions(workspace.root)
      .then((list) => {
        if (!stale) setSessions(list);
      })
      .catch(() => {
        if (!stale) setSessions([]);
      })
      .finally(() => {
        if (!stale) onScanned();
      });
    return () => {
      stale = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- onScanned 为稳定引用语义,不作为依赖
  }, [profile, workspace.root, liveSessions.length, refreshTick, rescanTick]);

  /** 磁盘扫描出的原生标题索引(含活会话已绑定条目,活行据此同形显示)。 */
  const diskTitleByCliId = new Map(
    (sessions ?? [])
      .filter((s) => s.title)
      .map((s) => [s.id, s.title as string]),
  );

  /** 真标题:手动命名 > 磁盘原生标题。短码兜底不是标题 —— 置顶快照只收这里的结果。 */
  const realTitle = (cliSessionId: string | undefined): string | undefined => {
    if (!cliSessionId) return undefined;
    return (
      titleOverrides[sessionTitleKey(profile.id, cliSessionId)] ??
      diskTitleByCliId.get(cliSessionId)
    );
  };

  /** 行标题解析:手动命名 > 磁盘原生标题 > 短码。 */
  const displayTitle = (cliSessionId: string | undefined, fallbackId: string): string =>
    realTitle(cliSessionId) ?? shortId(cliSessionId ?? fallbackId);

  /** 本组置顶投影:workspace scope → 组顶块;global scope → 离组进全局区。 */
  const workspacePins = listSessionPins(pins, {
    workspaceId: workspace.id,
    profileId: profile.id,
    scope: "workspace",
  });
  const pinnedOutIds = new Set(
    listSessionPins(pins, {
      workspaceId: workspace.id,
      profileId: profile.id,
      scope: "global",
    }).map((p) => p.cliSessionId),
  );
  const workspacePinnedIds = new Set(workspacePins.map((p) => p.cliSessionId));

  /** 活会话排序:完成未读置顶,其余 spawn 时间倒序(比较器见 utils —— 稳定键防抖动);
   *  scope=global 的活会话离组,汇入全局「已置顶」区,不在本组显示。
   *  pinnedOutIds 已按本工作区+本 CLI 过滤,存裸 cliSessionId(与磁盘过滤的 s.id 同构)。 */
  const orderedLive = [...liveSessions]
    .filter((s) => {
      const cliSessionId = host.getCliSessionId(s.id);
      return cliSessionId === undefined || !pinnedOutIds.has(cliSessionId);
    })
    .sort((a, b) => compareLiveSessions(a, b, (id) => host.isUnread(id)));

  const disk = (sessions ?? []).filter((s) => !liveCliIds.has(s.id));
  /* 工作区置顶块:按置顶时间升序;磁盘已消失的置顶(外部删文件)自然缺席。 */
  const pinnedDisk = workspacePins.flatMap((p) => {
    const entry = disk.find((d) => d.id === p.cliSessionId);
    return entry ? [entry] : [];
  });
  /* 时间轴语义:显式按修改时间倒序,不依赖各 CLI listSessions 的返回顺序。 */
  const unpinnedDisk = disk
    .filter((s) => !workspacePinnedIds.has(s.id) && !pinnedOutIds.has(s.id))
    .sort((a, b) => b.modifiedAt - a.modifiedAt);
  const visible = unpinnedDisk.slice(0, limit);
  const remaining = unpinnedDisk.length - visible.length;

  return {
    sessions,
    limit,
    setLimit,
    setRescanTick,
    titleOverrides,
    pins,
    activeSessionId,
    orderedLive,
    disk,
    pinnedDisk,
    visible,
    remaining,
    realTitle,
    displayTitle,
  };
}
