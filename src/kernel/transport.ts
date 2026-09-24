/**
 * 传输层:与 Tauri IPC 同形状的 invoke/listen,浏览器态(无 __TAURI_INTERNALS__)
 * 走 web 访问桥的 WS(协议见 src-tauri/src/web/server.rs)。webview 态原样透传,
 * 前端 868 行 ipc 层对运行环境零感知 —— R3 的「@tauri-apps/* 唯一 import 点」
 * 由此文件继承(ipc.ts 的全部 @tauri 依赖集中到这里)。
 *
 * WS 桥实现在 ./transportBridge(300 行铁则拆分);本文件只做环境判定、
 * 远程端点状态与 drop-in 路由。
 */

import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import { listen as tauriListen, type UnlistenFn } from "@tauri-apps/api/event";
import { WebBridge } from "./transportBridge";
import {
  activeRemoteEndpoint,
  isRemoteConnected,
  isRemotePaused,
  onRemoteConnection,
  onRemoteRevoked,
} from "./transportState";

export const isWeb =
  typeof window !== "undefined" && !("__TAURI_INTERNALS__" in window);

/** 桌面端启动 web 访问时铸的 token,随 URL 携带;串行前端态恒 null。
 *  读入内存后立即抹出地址栏(红队链1 泄露面收缩:浏览器历史/旁观/截图不再带凭据;
 *  /file、/ws 拼 URL 用的都是本变量,与 location 无关)。 */
export const webToken: string | null = isWeb
  ? new URLSearchParams(window.location.search).get("token")
  : null;
if (isWeb && webToken) {
  try {
    const u = new URL(window.location.href);
    u.searchParams.delete("token");
    window.history.replaceState(null, "", u);
  } catch { /* 非浏览器环境静默 */ }
}

/** 移动壳远程模式凭据:配对成功后由壳写入;置位后 invoke/listen 一律走桥连桌面。 */
export interface RemoteEndpoint {
  /** ws://… 或 wss://…(LAN 直连或 relay worker),不带 /ws 路径。 */
  wsUrl: string;
  deviceId: string;
  token: string;
}

let remoteEndpoint: RemoteEndpoint | null = null;
let bridge: WebBridge | null = null;

/** 壳态切换远程模式;null = 清凭证(撤销/重新配对),桥停连不再重试。 */
export function configureRemoteEndpoint(ep: RemoteEndpoint | null): void {
  remoteEndpoint = ep ? { ...ep, wsUrl: ep.wsUrl.replace(/\/+$/, "") } : null;
  if (remoteEndpoint || bridge) {
    (bridge ??= new WebBridge()).setEndpoint(remoteEndpoint);
  }
}

/** 远程模式(移动壳已配对)判定;与 isWeb(浏览器)互斥的第三态。 */
export function isRemote(): boolean {
  return remoteEndpoint !== null;
}

/* 桥连接态与撤销回调:实现在 transportBridge/transportState,此处再导出保持消费面单一。 */
export { isRemoteConnected, isRemotePaused, activeRemoteEndpoint, onRemoteConnection, onRemoteRevoked };

/** 手动断开(手机连接面板):停连且不再自动重拨;forceRemoteReconnect 恢复。 */
export function remoteDisconnect(): void {
  bridge?.disconnect();
}

/** 回前台强制重拨(iOS 后台掐 WS 的即时恢复;未配对/已撤销 no-op;兼作手动断开的恢复)。 */
export function forceRemoteReconnect(): void {
  bridge?.forceReconnect();
}

/** @tauri-apps/api/core invoke 的 drop-in。 */
export function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (remoteEndpoint) return (bridge ??= new WebBridge()).invoke<T>(cmd, args);
  if (!isWeb) return tauriInvoke<T>(cmd, args);
  return (bridge ??= new WebBridge()).invoke<T>(cmd, args);
}

/** @tauri-apps/api/event listen 的 drop-in(同 payload 包裹形状)。 */
export function listen<T>(
  name: string,
  cb: (e: { payload: T }) => void,
): Promise<UnlistenFn> {
  if (!remoteEndpoint && (!isWeb || typeof window === "undefined")) return tauriListen<T>(name, cb);
  return (bridge ??= new WebBridge()).listen(name, (payload) => cb({ payload: payload as T }));
}

/** 桥 hello 帧上报的服务端版本;不可得为 null。 */
export function serverVersion(): Promise<string | null> {
  if (!isWeb && !remoteEndpoint) return Promise.resolve(null);
  try {
    return (bridge ??= new WebBridge()).serverVersion();
  } catch {
    /* closed 桥(撤销/清凭证窗口):同步抛错转成兜底值,调用方无需接同步异常 */
    return Promise.resolve(null);
  }
}

/** 桥 hello 帧的服务端能力表(协议治理:block 屏据此评估)。 */
export function serverCapabilities(): Promise<string[]> {
  if (!isWeb && !remoteEndpoint) return Promise.resolve([]);
  try {
    return (bridge ??= new WebBridge()).serverCapabilities();
  } catch {
    return Promise.resolve([]);
  }
}
