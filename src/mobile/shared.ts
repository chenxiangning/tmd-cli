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
  view: "home" | "session" | "history" | "git";
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

/** 端点网络域:私有网段/localhost = 内网(局域网直连),其余(中继域名) = 外网。 */
export function endpointKind(url: string): "lan" | "wan" {
  const host = url.replace(/^wss?:\/\//, "").split(/[/:]/)[0];
  if (/^(localhost|127\.)/.test(host)) return "lan";
  if (/^10\./.test(host) || /^192\.168\./.test(host) || /^172\.(1[6-9]|2\d|3[01])\./.test(host)) return "lan";
  return "wan";
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
  /** 归档覆盖层键集(wsId:profileId:cliSessionId;桌面 settings.sessionArchive 只读镜像)。 */
  archive: Set<string>;
  /** 置顶覆盖层(桌面 settings.sessionPins 只读镜像;写走 togglePin)。 */
  pins: Record<string, { title?: string; pinnedAt?: number }>;
  connected: boolean;
  /** 手动断开(已停止自动重连)。 */
  paused: boolean;
  route: MobileRoute;
  go: (r: MobileRoute) => void;
  titleOf: (s: RemoteSession) => string;
  /** 置顶切换(session_pin_toggle 窄令;key = wsId:profileId:cliSessionId)。 */
  togglePin: (key: string, title: string) => Promise<void>;
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

/** 审批线批次(线上 JSON camelCase;数据形状与排序归 shared,组件文件只出组件)。 */
export interface CkptLite {
  id: string;
  index: number;
  open: boolean;
  ts: number;
  state: string;
  prompt: string;
  files: unknown[];
}

/** 排序:进行中(open)最前,其余按轮次倒序(新批在上)。 */
export function sortBatches(bs: CkptLite[]): CkptLite[] {
  return [...bs].sort((a, b) => Number(b.open) - Number(a.open) || b.index - a.index);
}

/** 键盘工具条键表(顺序 = 视觉顺序;窄屏横向可滚)。 */
export interface KeyDef {
  label: string;
  seq: string;
  aria: string;
}

export const KEYS: KeyDef[] = [
  { label: "model", seq: "/model\r", aria: "切换模型" },
  { label: "esc", seq: "\x1b", aria: "Esc" },
  { label: "tab", seq: "\t", aria: "Tab" },
  { label: "⌃c", seq: "\x03", aria: "Ctrl+C" },
  { label: "←", seq: "\x1b[D", aria: "Left" },
  { label: "→", seq: "\x1b[C", aria: "Right" },
  { label: "↑", seq: "\x1b[A", aria: "Up" },
  { label: "↓", seq: "\x1b[B", aria: "Down" },
  { label: "↵", seq: "\r", aria: "Enter" },
  { label: "Pg↑", seq: "\x1b[5~", aria: "PageUp" },
  { label: "Pg↓", seq: "\x1b[6~", aria: "PageDown" },
];
