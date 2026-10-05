/**
 * 壳原生扫码门面(配对屏专用):iOS = webkit.messageHandlers.qr(Swift QrBridge),
 * Android = AndroidShell "qr.start"(Kotlin zxing CaptureActivity);两壳结果统一经
 * window.__TMD_QR__(text|null) 回传(取消/拒相机权限 = null)。
 * 非壳环境(桌面/浏览器)无桥,PairingScreen 走手动输入退化态。
 */

interface QrShellWindow {
  webkit?: { messageHandlers?: { qr?: { postMessage: (m: string) => void } } };
  /** Android 壳:注入接口只收 JSON 串(id=0 无应答帧,与 log 同款发后即忘)。 */
  AndroidShell?: { post: (json: string) => void };
  __TMD_QR__?: (t: string | null) => void;
}

/** 壳是否有原生扫码桥(iOS webkit / Android AndroidShell)。 */
export function hasQrBridge(): boolean {
  if (typeof window === "undefined") return false;
  const w = window as unknown as QrShellWindow;
  return w.webkit?.messageHandlers?.qr !== undefined || w.AndroidShell !== undefined;
}

/** 开原生扫码;取消返回 null;非壳环境不会发生(hasQrBridge 已闸)。 */
export function scanOfferLink(): Promise<string | null> {
  const { promise, resolve } = Promise.withResolvers<string | null>();
  const w = window as unknown as QrShellWindow;
  w.__TMD_QR__ = (t) => resolve(t);
  const ios = w.webkit?.messageHandlers?.qr;
  if (ios) ios.postMessage("start");
  else w.AndroidShell?.post(JSON.stringify({ id: 0, method: "qr.start", args: null }));
  return promise;
}
