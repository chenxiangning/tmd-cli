/**
 * 发送确认计划(spec 2026-09-27-composer-send-confirm)—— 确认/执行分离的数据面。
 *
 * plan 在挂起时构建(显示用目标快照 + 内容),确认后 executeSend 按计划重新现读
 * 轮次闸/重解析广播目标再写(闸语义 = writeSession 前现读,确认期间 ask 态可能变化)。
 * 目标卡字段:幕布位序(平铺 kept 序 1 起,非平铺无)+ 标题(与 tab 条同源:
 * 手动命名 > 打开快照 > meta 标题 > 短码)+ 工作区展示名 + 引擎展示名;
 * 弹层按字段渲染,用户据此认出「发到哪块幕布」。
 */

import { host } from "@kernel/host";
import { deriveWorkspaceName } from "@kernel/pathUtils";
import { getSettingsState } from "@kernel/settings";
import { getSessionTabTitle, getSessionTabs, getSessionTile } from "@kernel/sessionTabs";
import { sessionTitleKey, shortId } from "@kernel/sessionTitles";
import { getWorkspaces, workspaceDisplayName } from "@kernel/workspace";
import type { SessionMeta } from "@kernel/ipc";
import { keptSessionIds } from "./broadcastTargets";

/** 结构化目标行(弹层按字段渲染,不拼串)。 */
export interface SendTarget {
  /** 平铺幕布位序(MainPanel kept 序,1 起);非平铺模式 undefined。 */
  paneIndex?: number;
  /** 会话标题,与 SessionTabBar resolveTitle 同源。 */
  title: string;
  /** 归属工作区展示名(别名 > 目录名);无归属回落 cwd 末段。 */
  workspace: string;
  /** 引擎展示名;profile 缺失回落 profileId。 */
  engine: string;
  /** composer 当前绑定的幕布(host 活跃指针)。 */
  active?: boolean;
}

export interface SendPlan {
  /** single = 活跃会话单发;broadcast = 平铺广播(执行时目标数可能变化,以重解析为准)。 */
  kind: "single" | "broadcast";
  targets: SendTarget[];
  /** 内容预览(单发 = 输入原文 trim;抽屉 = wire 去 CR)。执行段以此为准。 */
  content: string;
}

/** 确认请求(弹框交互面):onConfirm/onCancel 由挂起点以闭包注入,弹框只触发。 */
export interface SendConfirmRequest {
  plan: SendPlan;
  onConfirm: () => void;
  onCancel: () => void;
}

import { useCallback, useState } from "react";

/** 挂起期模态闸:确认框在屏时两条发送路径静默 no-op —— 否则弹框期间的第二记
 *  发送键一边被弹框 window 监听接住确认旧计划,一边又经发送路径挂新起
 *  (旧 Promise 永不落定、弹框实例被顶替,2026-09-27 桩目检实证)。 */
let confirmPending = false;
export function isConfirmPending(): boolean {
  return confirmPending;
}

/** Composer 侧挂起态三件套(确认框唯一实例,两条发送路径共用)。 */
export function useSendConfirmRequest(): {
  req: SendConfirmRequest | null;
  requestConfirm: (req: SendConfirmRequest) => void;
  close: () => void;
} {
  const [req, setReq] = useState<SendConfirmRequest | null>(null);
  const requestConfirm = useCallback((r: SendConfirmRequest) => {
    confirmPending = true;
    setReq(r);
  }, []);
  const close = useCallback(() => {
    confirmPending = false;
    setReq(null);
  }, []);
  return { req, requestConfirm, close };
}

/** 平铺幕布位序(1 起);非平铺或不在 kept 内 undefined。kept 公式唯一源见 broadcastTargets。 */
function paneIndexOf(id: string): number | undefined {
  if (!getSessionTile()) return undefined;
  const i = keptSessionIds(getSessionTabs(), host.getActiveSessionId()).indexOf(id);
  return i >= 0 ? i + 1 : undefined;
}

/** 目标快照:标题与 tab 条同源;工作区先按 workspaceId 再按 root 匹配。 */
export function resolveSendTarget(meta: SessionMeta, paneIndex?: number): SendTarget {
  const cliSessionId = host.getCliSessionId(meta.id);
  const manual = cliSessionId
    ? getSettingsState().settings.sessionTitles[sessionTitleKey(meta.profileId, cliSessionId)]
    : undefined;
  const ws = getWorkspaces().find((w) => w.id === meta.workspaceId || w.root === meta.cwd);
  return {
    paneIndex,
    title: manual ?? getSessionTabTitle(meta.id) ?? meta.title ?? shortId(meta.id),
    workspace: ws ? workspaceDisplayName(ws) : deriveWorkspaceName(meta.cwd),
    engine: host.getCliProfile(meta.profileId)?.name ?? meta.profileId,
    active: host.getActiveSessionId() === meta.id || undefined,
  };
}

/** 单发计划;会话已消失返回 null(调用方静默不发,与无会话守卫同语义)。 */
export function buildSinglePlan(sid: string, content: string): SendPlan | null {
  const meta = host.getSessions().find((s) => s.id === sid);
  if (!meta) return null;
  return { kind: "single", targets: [resolveSendTarget(meta, paneIndexOf(sid))], content };
}

/** 广播计划:targets 为 resolveBroadcastTargets 的目标 id 表(kept 序),位序按 kept 全序
 *  (含无 profile 被跳过的幕布,屏上位置不因此错位)。 */
export function buildBroadcastPlan(targetIds: string[], content: string): SendPlan {
  const sessions = host.getSessions();
  const targets = targetIds.flatMap((id) => {
    const meta = sessions.find((s) => s.id === id);
    return meta ? [resolveSendTarget(meta, paneIndexOf(id))] : [];
  });
  return { kind: "broadcast", targets, content };
}
