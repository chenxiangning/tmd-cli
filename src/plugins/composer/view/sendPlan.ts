/**
 * 发送确认计划(spec 2026-09-27-composer-send-confirm)—— 确认/执行分离的数据面。
 *
 * plan 在挂起时构建(显示用目标快照 + 内容),确认后 executeSend 按计划重新现读
 * 轮次闸/重解析广播目标再写(闸语义 = writeSession 前现读,确认期间 ask 态可能变化)。
 * 目标行格式:会话标题 · 引擎 abbr;title 缺省回落工作区名(deriveWorkspaceName)。
 */

import { host } from "@kernel/host";
import { deriveWorkspaceName } from "@kernel/pathUtils";
import type { SessionMeta } from "@kernel/ipc";

export interface SendPlan {
  /** single = 活跃会话单发;broadcast = 平铺广播(执行时目标数可能变化,以重解析为准)。 */
  kind: "single" | "broadcast";
  /** 显示用目标行(弹框目标区,逐行渲染)。 */
  targetLines: string[];
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

/** Composer 侧挂起态三件套(确认框唯一实例,两条发送路径共用)。 */
export function useSendConfirmRequest(): {
  req: SendConfirmRequest | null;
  requestConfirm: (req: SendConfirmRequest) => void;
  close: () => void;
} {
  const [req, setReq] = useState<SendConfirmRequest | null>(null);
  const requestConfirm = useCallback((r: SendConfirmRequest) => setReq(r), []);
  const close = useCallback(() => setReq(null), []);
  return { req, requestConfirm, close };
}

/** 单目标行:会话标题 · 引擎显示名。 */
export function sendTargetLine(meta: SessionMeta): string {
  const abbr = host.getCliProfile(meta.profileId)?.name ?? meta.profileId;
  const name = meta.title ?? deriveWorkspaceName(meta.cwd);
  return `${name} · ${abbr}`;
}

/** 单发计划;会话已消失返回 null(调用方静默不发,与无会话守卫同语义)。 */
export function buildSinglePlan(sid: string, content: string): SendPlan | null {
  const meta = host.getSessions().find((s) => s.id === sid);
  if (!meta) return null;
  return { kind: "single", targetLines: [sendTargetLine(meta)], content };
}

/** 广播计划:targets 为 resolveBroadcastTargets 的目标 id 表,逐个查 meta 组行。 */
export function buildBroadcastPlan(targetIds: string[], content: string): SendPlan {
  const sessions = host.getSessions();
  const targetLines = targetIds.flatMap((id) => {
    const meta = sessions.find((s) => s.id === id);
    return meta ? [sendTargetLine(meta)] : [];
  });
  return { kind: "broadcast", targetLines, content };
}
