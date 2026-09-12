/**
 * CLI 会话历史扫描 hook —— 自 useCliSessionGroup 拆出(文件规模铁则)。
 *
 * 历史三分支:① 来源提供远程磁盘通道(origin.remoteExec + profile.remoteSessions)
 * → 扫远端(重启后历史仍在远端磁盘上);② 远程来源但无通道 → 不查本机;
 * ③ 默认本机扫描。附带两路补扫:身份绑定跳变(懒落盘晚于 spawn)、
 * 缺真标题退避追赶(自动命名晚于文件出生)。
 * 纯数据装配,不含 JSX;归档/删除覆盖层过滤留宿主 hook(视图语义)。
 */

import { useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
import type { CliDiskSession, CliProfile } from "@kernel/cli";
import { host } from "@kernel/host";
import { findWorkspaceOrigin } from "@kernel/workspaceOrigins";
import { noteSessionTabTitle } from "@kernel/sessionTabs";
import { isSessionDeleted, sessionDeletedKey } from "@kernel/sessionDeleted";
import { sessionTitleKey } from "@kernel/sessionTitles";
import type { Workspace } from "@kernel/workspace";
import type { SessionMeta } from "@kernel/ipc";
import { TITLE_RESOLVE_MAX_ATTEMPTS, titleRetryDelay } from "./utils";

export function useCliDiskScan({
  profile,
  workspace,
  liveSessions,
  refreshTick,
  titleOverrides,
  onScanned,
}: {
  profile: CliProfile;
  workspace: Workspace;
  /** 外部刷新信号(工作区行刷新/菜单单项刷新):值变化即重扫。 */
  refreshTick: number;
  /** 命名覆盖层(重命名提交后缺标题判定随之收敛)。 */
  titleOverrides: Record<string, string>;
  /** 扫描完成回调(驱动菜单刷新按钮的 spin 停止)。 */
  onScanned: () => void;
  liveSessions: SessionMeta[];
}): {
  /** 磁盘/远程扫描结果;null = 尚未落定(加载中)。 */
  sessions: CliDiskSession[] | null;
  /** 活会话已绑定的磁盘身份(磁盘行据此去重,同一会话全局只出现一次)。 */
  liveCliIds: Set<string>;
  /** 本地重扫信号:删除磁盘会话后立刻反映(不等外部刷新)。 */
  setRescanTick: (updater: (t: number) => number) => void;
} {
  const [sessions, setSessions] = useState<CliDiskSession[] | null>(null);
  const [rescanTick, setRescanTick] = useState(0);
  const liveRef = useRef(liveSessions);
  /* 提交后同步(渲染期禁写 ref.current);扫描回调读到的即最新活会话表。 */
  useEffect(() => {
    liveRef.current = liveSessions;
  });
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

  /* onScanned 经 useEffectEvent 包装:回调始终读最新引用且不进依赖 —— 扫描完成的
   * 语义是「事件」,父级每轮重建回调箭头(WorkspaceCard 行内 () => onScanDone(...))
   * 不该重触发磁盘扫描。 */
  const onScannedEvent = useEffectEvent(onScanned);
  const origin = findWorkspaceOrigin(workspace);
  const skipLocalDiskHistory = origin?.localDiskHistory === false;
  /* remoteExec 返回的是一次性 exec 闭包,identity 每渲染必变 —— 必须 useMemo 钉死,
     否则扫描 effect 每帧重跑 = 对远端宿主无限 ssh exec(实证:探针被连接洪峰打挂,
     「SSH 连接失败: Disconnected」)。origin 是注册表内稳定对象,可作 memo 依赖。 */
  const remoteScan = useMemo(
    () => origin?.remoteExec?.(workspace) ?? null,
    [origin, workspace],
  );
  const remoteAdapter = remoteScan ? (profile.remoteSessions ?? null) : null;
  const isDeleted = (cliSessionId: string) =>
    isSessionDeleted(sessionDeletedKey(workspace.id, profile.id, cliSessionId));
  useEffect(() => {
    let stale = false;
    if (remoteScan && remoteAdapter) {
      void remoteAdapter
        .list(remoteScan, workspace.root)
        .then((diskList) => {
          if (stale) return;
          setSessions(diskList);
          /* 磁盘真标题落定随手喂 tab 快照(与本机扫描分支同款):远程会话恢复
             (openRemoteDiskSession)后活行标题跟随远端自动命名。 */
          const titles = new Map(
            diskList.flatMap((d): [string, string][] => (d.title ? [[d.id, d.title]] : [])),
          );
          for (const s of liveRef.current) {
            const cliId = host.getCliSessionId(s.id);
            const title = cliId !== undefined ? titles.get(cliId) : undefined;
            if (title) noteSessionTabTitle(s.id, title);
          }
          onScannedEvent();
        })
        .catch(() => {
          if (!stale) {
            setSessions([]);
            onScannedEvent();
          }
        });
      return () => {
        stale = true;
      };
    }
    if (!profile.listSessions || skipLocalDiskHistory) {
      setSessions([]);
      onScannedEvent();
      return;
    }
    void profile
      .listSessions(workspace.root)
      .then((list) => {
        if (stale) return;
        setSessions(list);
        /* 磁盘真标题落定随手喂 tab 快照:tab 标签跟随自动命名(手动命名优先,不受影响) */
        const titles = new Map(
          list.flatMap((d): [string, string][] => (d.title ? [[d.id, d.title]] : [])),
        );
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
        if (!stale) onScannedEvent();
      });
    return () => {
      stale = true;
    };
  }, [profile, workspace.root, liveSessions.length, refreshTick, rescanTick, skipLocalDiskHistory, remoteScan, remoteAdapter]);

  /** 缺真标题的活会话(手动命名除外)→ 指数退避重扫追赶自动命名落盘,
   *  全部落定即停(titleRetryDelay,同运行区 / 全局置顶锁步)。 */
  const diskTitleByCliId = new Map(
    (sessions ?? [])
      .filter((s) => !isDeleted(s.id))
      .flatMap((s): [string, string][] => (s.title ? [[s.id, s.title]] : [])),
  );
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

  return { sessions, liveCliIds, setRescanTick };
}
