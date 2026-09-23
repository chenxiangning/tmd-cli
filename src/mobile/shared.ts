/**
 * 手机 UI 共享件(非组件导出集中处:类型/常量/端点选择/通知入口)——
 * react-doctor「组件文件只出组件」纪律;数据面实现见 remote.ts/creds.ts。
 */
import React from "react";
import { t } from "@kernel/i18n";
import { hasShellBridge, shellNotify } from "@kernel/shellBridge";
import { loadChannelPin, type MobileCreds } from "./creds";
import type { RemoteSession, RemoteWorkspace } from "./remote";

/** 壳要求的桌面协议能力(hello.capabilities 缺此 = block 屏;协议破坏性变更时步进)。 */
export const REQUIRED_CAPABILITY = "app-device";

/** 手机三层路由:home(列表)/ session(实况+审批+发送)/ history(只读 transcript)。 */
export interface MobileRoute {
  view: "home" | "session" | "history";
  sessionId?: string;
  /** view = history:磁盘会话定位信息(cwd/workspaceId/cliSessionId 齐备时可续聊)。 */
  history?: {
    profileId: string;
    path: string;
    title: string;
    cwd?: string;
    workspaceId?: string;
    cliSessionId?: string;
  };
}

/** 端点候选:钉选优先;auto = urls 序(配对时 LAN 在前),旧凭证回落单 wsUrl。 */
export function endpointCandidates(creds: MobileCreds): string[] {
  const all = creds.urls?.length ? creds.urls : [creds.wsUrl];
  const pin = loadChannelPin();
  if (pin !== "auto" && all.includes(pin)) return [pin];
  return all;
}

/** RemoteHostBar 展示/重试用:当前钉选解析出的首选端点。 */
export function currentEndpoint(creds: MobileCreds): string {
  return endpointCandidates(creds)[0];
}

/** ask 首现本地通知(壳态;SessionScreen 检测边沿调用)。 */
export function notifyAsk(title: string): void {
  if (!hasShellBridge()) return;
  void shellNotify(t("等待确认"), title).catch(() => undefined);
}

/** 手机路由 Context(MobileApp 提供,子屏消费)。 */
export interface MobileCtxValue {
  creds: MobileCreds;
  sessions: RemoteSession[];
  workspaces: RemoteWorkspace[];
  titles: Record<string, string>;
  connected: boolean;
  route: MobileRoute;
  go: (r: MobileRoute) => void;
  titleOf: (s: import("./remote").RemoteSession) => string;
  onRePair: () => void;
}

export const MobileAppCtx = React.createContext<MobileCtxValue | null>(null);

export function useMobile(): MobileCtxValue {
  const v = React.useContext(MobileAppCtx);
  if (!v) throw new Error("MobileAppCtx outside provider");
  return v;
}

/** 壳标记判定(手机独立树入口;桌面/浏览器 false)。 */
export function isMobileShell(): boolean {
  return typeof window !== "undefined" && window.__TMD_SHELL__ === "mobile";
}
