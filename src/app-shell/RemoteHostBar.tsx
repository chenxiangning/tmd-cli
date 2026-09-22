/**
 * RemoteHostBar —— 移动壳顶栏下方的主机状态条(spec「RemoteHostBar:主机名/连接态/重试」)。
 * 仅窄屏 + 远程态挂载;连接中/已连/断线三态,断线给重试(强制重拨,不等退避)。
 */
import { useCallback, useEffect, useState } from "react";
import { t } from "@kernel/i18n";
import { isRemote, isRemoteConnected, onRemoteConnection } from "@kernel/transport";
import { loadCreds } from "./mobilePairing";

export function RemoteHostBar() {
  const [connected, setConnected] = useState(isRemoteConnected);
  useEffect(() => {
    if (!isRemote()) return;
    setConnected(isRemoteConnected());
    return onRemoteConnection(setConnected);
  }, []);
  const hostName = loadCreds()?.hostName ?? "";
  const retry = useCallback(() => {
    const c = loadCreds();
    if (!c) return;
    // 强制重拨:清凭证再回写会重建桥(见 configureRemoteEndpoint),退避归零
    import("@kernel/transport").then(({ configureRemoteEndpoint }) => {
      configureRemoteEndpoint(null);
      configureRemoteEndpoint(c);
    });
  }, []);
  return (
    <div className="flex h-8 shrink-0 items-center gap-2 border-b border-(--tmd-border) bg-(--tmd-bg-muted) px-3 text-[0.75rem]">
      <span
        aria-hidden
        className={`h-2 w-2 shrink-0 rounded-full ${connected ? "bg-[#30d158]" : "bg-[#ff453a]"}`}
      />
      <span className="truncate text-(--tmd-fg-dim)">{hostName || t("远程主机")}</span>
      <span className="ml-auto text-(--tmd-fg-dim)">
        {connected ? t("已连接") : t("连接中…")}
      </span>
      {!connected && (
        <button
          type="button"
          onClick={retry}
          className="ml-2 rounded-md bg-(--tmd-accent) px-2 py-0.5 font-medium text-white"
        >
          {t("重试")}
        </button>
      )}
    </div>
  );
}
