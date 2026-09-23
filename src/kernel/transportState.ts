/**
 * 桥连接三态(open / 手动暂停 / 最近活动端点)—— transportBridge 写入,手机连接
 * sheet 与断连 banner 订阅。与桥类拆出:transportBridge 贴 300 行铁则,且状态面
 * 与实现面无耦合。任一字段变化都通知订阅者(UI 一次 setState 读全三态)。
 */
let connectedValue = false;
let pausedValue = false;
let activeEndpointValue: string | null = null;
let cbs: ((s: { connected: boolean; paused: boolean }) => void)[] = [];

function fire() {
  for (const cb of cbs) cb({ connected: connectedValue, paused: pausedValue });
}

export function setConnected(v: boolean): void {
  if (connectedValue === v) return;
  connectedValue = v;
  fire();
}

/** 手动断开置位(remoteDisconnect);forceRemoteReconnect / 换端点清零。 */
export function setPaused(v: boolean): void {
  if (pausedValue === v) return;
  pausedValue = v;
  fire();
}

/** 最近一次成功连接的端点(内网/外网展示;仅 connected 时有意义)。 */
export function setActiveEndpoint(u: string | null): void {
  if (activeEndpointValue === u) return;
  activeEndpointValue = u;
  fire();
}

export function isRemoteConnected(): boolean {
  return connectedValue;
}

export function isRemotePaused(): boolean {
  return pausedValue;
}

export function activeRemoteEndpoint(): string | null {
  return activeEndpointValue;
}

/** 订阅连接态变化(connected/paused 任一变更都触发),返回退订。 */
export function onRemoteConnection(
  cb: (s: { connected: boolean; paused: boolean }) => void,
): () => void {
  cbs.push(cb);
  return () => {
    cbs = cbs.filter((f) => f !== cb);
  };
}

/* 设备凭据被桌面撤销/拒的回调表(transport.onRemoteRevoked 再导出)。 */
let revokedCbs: ((reason: string) => void)[] = [];

/** 设备凭据被桌面撤销/拒(WS 4001/bye):壳清凭证回配对屏。回调收 reason
 * ("pending" = 待批准,"rejected" = 已被撤销)。返回退订函数。 */
export function onRemoteRevoked(cb: (reason: string) => void): () => void {
  revokedCbs.push(cb);
  return () => {
    revokedCbs = revokedCbs.filter((f) => f !== cb);
  };
}

/** 桥侧触发撤销回调(回调不清空:常驻订阅者须跨多次逐出存活)。 */
export function fireRevoked(reason: string): void {
  for (const cb of [...revokedCbs]) cb(reason);
}
