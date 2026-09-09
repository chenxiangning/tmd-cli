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
import { listSessionPins, sessionPinKey } from "@kernel/sessionPins";
import { isSessionArchived, sessionArchiveKey } from "@kernel/sessionArchive";
import { isSessionDeleted, sessionDeletedKey } from "@kernel/sessionDeleted";
import { noteSessionTabTitle } from "@kernel/sessionTabs";
import { sessionTitleKey } from "@kernel/sessionTitles";
import type { Workspace } from "@kernel/workspace";
import type { SessionMeta } from "@kernel/ipc";
import {
  compareLiveSessions,
  isRunningZoneCandidate,
  orShortId,
  TITLE_RESOLVE_MAX_ATTEMPTS,
  titleRetryDelay,
} from "./utils";
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
  /** 分页水位按视图独立:默认/归档各自从配额起步、「更多」各自翻倍。
   *  曾共享单值 —— 默认视图翻页找旧会话(limit 涨到 160)后切归档视图,
   *  归档列表一次性摊出 160 条,形同全量显示(2026-09-07 用户实测)。 */
  const archivedView = settings.workspaceArchiveView;
  const [limits, setLimits] = useState<[number, number]>([initialLimit, initialLimit]);
  const limit = archivedView ? limits[1] : limits[0];
  const setLimit = (updater: (l: number) => number) =>
    setLimits((prev) =>
      archivedView ? [prev[0], updater(prev[1])] : [updater(prev[0]), prev[1]],
    );
  /** 预算修改响应式生效:两视图按新配额重新起步(已展开的「更多」随之重置)。 */
  useEffect(() => {
    setLimits([initialLimit, initialLimit]);
  }, [initialLimit]);
  /** 本地重扫信号:删除磁盘会话后立刻反映(不等外部刷新)。 */
  const [rescanTick, setRescanTick] = useState(0);
  /* 命名覆盖层变化(重命名提交)需重渲行标题 */
  const titleOverrides = settings.sessionTitles;
  const pins = settings.sessionPins;
  /** 归档/删除覆盖层(tombstone):默认视图隐藏归档与已删会话;archivedView
   *  反向只看归档项;删除意图全域隐藏。过滤谓词统一走覆盖层领域 API
   *  (与 RunningZone 同口径),key 拼装在此。 */
  const isDeleted = (cliSessionId: string) =>
    isSessionDeleted(sessionDeletedKey(workspace.id, profile.id, cliSessionId));
  const isArchived = (cliSessionId: string) =>
    isSessionArchived(sessionArchiveKey(workspace.id, profile.id, cliSessionId));

  const liveSessions = host
    .getSessions()
    .filter((s) => s.workspaceId === workspace.id && s.profileId === profile.id);
  /** 扫描回调喂 tab 快照用最新活会话表(effect 闭包防陈旧)。 */
  const liveRef = useRef(liveSessions);
  liveRef.current = liveSessions;
  const activeSessionId = host.getActiveSessionId();
  /** 活会话已绑定的磁盘身份:磁盘行据此过滤,同一会话全局只出现一次。 */
  const liveCliIds = new Set(
    liveSessions
      .map((s) => host.getCliSessionId(s.id))
      .filter((id): id is string => id !== undefined),
  );

  /* 身份绑定跳变 → 磁盘重扫:omp 实证懒落盘晚于 spawn 35s+,spawn 时点的扫描看不到
   * 文件与标题;绑定成功即文件已出生,立即补扫。标题迟到的后续追赶由下方缺标题
   * 退避补扫接管(自动命名晚于文件出生数秒~数十秒,单次补扫常扑空)。 */
  const boundCount = liveCliIds.size;
  const prevBoundCount = useRef(boundCount);
  useEffect(() => {
    if (boundCount === prevBoundCount.current) return;
    prevBoundCount.current = boundCount;
    setRescanTick((t) => t + 1);
  }, [boundCount]);

  useEffect(() => {
    let stale = false;
    if (!profile.listSessions) return;
    void profile
      .listSessions(workspace.root)
      .then((list) => {
        if (stale) return;
        setSessions(list);
        /* 磁盘真标题落定随手喂 tab 快照:tab 标签跟随自动命名(手动命名优先,不受影响) */
        const titles = new Map(list.filter((d) => d.title).map((d) => [d.id, d.title as string]));
        for (const s of liveRef.current) {
          const cliId = host.getCliSessionId(s.id);
          const title = cliId !== undefined ? titles.get(cliId) : undefined;
          if (title) noteSessionTabTitle(s.id, title);
        }
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
    /* onScanned 为稳定引用语义,不作为依赖。 */
  }, [profile, workspace.root, liveSessions.length, refreshTick, rescanTick]);

  /** 扫描源统一过 tombstone:默认/归档视图、置顶投影、标题索引共用(删除意图全域隐藏)。 */
  const scanned = (sessions ?? []).filter((s) => !isDeleted(s.id));

  /** 磁盘扫描出的原生标题索引(含活会话已绑定条目,活行据此同形显示)。 */
  const diskTitleByCliId = new Map(
    scanned
      .filter((s) => s.title)
      .map((s) => [s.id, s.title as string]),
  );
  /* 缺真标题的活会话(手动命名除外)→ 指数退避重扫追赶自动命名落盘,
   * 全部落定即停(titleRetryDelay,同运行区 / 全局置顶锁步)。 */
  const missingTitleSig = profile.listSessions
    ? [...liveCliIds]
        .filter(
          (id) =>
            !diskTitleByCliId.has(id) &&
            titleOverrides[sessionTitleKey(profile.id, id)] === undefined,
        )
        .sort()
        .join("|")
    : "";
  useEffect(() => {
    if (!missingTitleSig) return;
    let attempts = 0;
    let timer: number | undefined;
    const bump = () => {
      setRescanTick((t) => t + 1);
      attempts += 1;
      if (attempts < TITLE_RESOLVE_MAX_ATTEMPTS)
        timer = window.setTimeout(bump, titleRetryDelay(attempts + 1));
    };
    timer = window.setTimeout(bump, titleRetryDelay(1));
    return () => window.clearTimeout(timer);
  }, [missingTitleSig]);

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
    orShortId(realTitle(cliSessionId), cliSessionId, fallbackId);

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

  /** 运行区投影:未置顶且 运行中/结束未查看 的活会话离组,汇入侧栏「运行区」
   *  (RunningZone.tsx;成员判定同源 isRunningZoneCandidate,单一区域原则 ——
   *  一个会话同一时刻只在运行区或本组之一显示)。
   *  置顶优先级最高:任一作用域置顶留在原地(组顶块/全局置顶区),不进运行区。 */
  const zoneOut = (s: SessionMeta): boolean => {
    const cliSessionId = host.getCliSessionId(s.id);
    if (
      cliSessionId !== undefined &&
      sessionPinKey(workspace.id, profile.id, cliSessionId) in pins
    )
      return false;
    return isRunningZoneCandidate(host.isTurnActive(s.id), host.isUnread(s.id));
  };

  /** 活会话排序:完成未读置顶,其余 spawn 时间倒序(比较器见 utils —— 稳定键防抖动);
   *  scope=global 的活会话离组,汇入全局「已置顶」区,不在本组显示。
   *  pinnedOutIds 已按本工作区+本 CLI 过滤,存裸 cliSessionId(与磁盘过滤的 s.id 同构)。 */
  const orderedLive = [...liveSessions]
    .filter((s) => {
      const cliSessionId = host.getCliSessionId(s.id);
      return (
        (cliSessionId === undefined || !pinnedOutIds.has(cliSessionId)) &&
        (cliSessionId === undefined || !isArchived(cliSessionId)) &&
        (cliSessionId === undefined || !isDeleted(cliSessionId)) &&
        !zoneOut(s)
      );
    })
    .sort((a, b) => compareLiveSessions(a, b, (id) => host.isUnread(id)));

  const disk = scanned.filter((s) => !liveCliIds.has(s.id) && !isArchived(s.id));
  /* 工作区置顶块:按置顶时间升序;磁盘已消失的置顶(外部删文件)自然缺席;
   * 已归档的置顶在默认视图隐藏(disk 过滤已含 archived)。 */
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

  /** 归档视图行集:含绑定活会话的条目(默认视图其活行已隐藏,归档视图以磁盘行形回归)。 */
  const archivedRows = scanned
    .filter((s) => isArchived(s.id))
    .sort((a, b) => b.modifiedAt - a.modifiedAt);
  const archivedVisible = archivedRows.slice(0, limit);

  return {
    archivedView,
    /** 视图感知的空组判定:默认看活+磁盘,归档视图只看归档行集(sessions=null 视为加载中不算空)。 */
    isEmpty:
      sessions !== null &&
      (archivedView
        ? archivedRows.length === 0
        : orderedLive.length === 0 && disk.length === 0),
    sessions: scanned,
    setLimit,
    setRescanTick,
    titleOverrides,
    pins,
    activeSessionId,
    orderedLive: archivedView ? [] : orderedLive,
    pinnedDisk: archivedView ? [] : pinnedDisk,
    visible: archivedView ? archivedVisible : visible,
    remaining: archivedView ? archivedRows.length - archivedVisible.length : remaining,
    realTitle,
    displayTitle,
  };
}
