/**
 * RemoteHostBar —— 移动壳顶栏下方的主机状态条(spec「主机名/连接态/重试」+ M2 通道切换)。
 * 仅窄屏 + 远程态挂载;连接态点 + 通道菜单(自动竞速 / 钉选某端点,pin 存 localStorage)。
 */
import { useEffect, useState } from "react";
import { t } from "@kernel/i18n";
import { configureRemoteEndpoint, isRemote, isRemoteConnected, onRemoteConnection } from "@kernel/transport";
import { currentEndpoint } from "./mobilePairing";
import { loadChannelPin, loadCreds, saveChannelPin, type MobileCreds } from "./mobileCreds";

/** 端点显示名:ws(s)://host:port → host:port。 */
function labelOf(url: string): string {
  return url.replace(/^wss?:\/\//, "");
}

export function RemoteHostBar() {
  const [connected, setConnected] = useState(isRemoteConnected);
  const [menu, setMenu] = useState(false);
  useEffect(() => {
    if (!isRemote()) return;
    setConnected(isRemoteConnected());
    return onRemoteConnection(setConnected);
  }, []);
  const creds: MobileCreds | null = loadCreds();
  const urls = creds?.urls?.length ? creds.urls : creds ? [creds.wsUrl] : [];
  const pin = loadChannelPin();
  const active = creds ? currentEndpoint(creds) : "";
  const retry = () => {
    if (!creds) return;
    // 按当前钉选重臂(清端点再设回 = 立即重拨,不等退避)
    configureRemoteEndpoint(null);
    configureRemoteEndpoint({ ...creds, wsUrl: active });
  };
  return (
    <div className="relative flex h-8 shrink-0 items-center gap-2 border-b border-(--tmd-border) bg-(--tmd-bg-muted) px-3 text-[0.75rem]">
      <span
        aria-hidden
        className={`h-2 w-2 shrink-0 rounded-full ${connected ? "bg-[#30d158]" : "bg-[#ff453a]"}`}
      />
      <button
        type="button"
        className="min-w-0 flex-1 truncate text-left text-(--tmd-fg-dim)"
        onClick={() => setMenu((v) => !v)}
      >
        {creds?.hostName || t("远程主机")} · {connected ? t("已连接") : t("连接中…")}
        {urls.length > 1 && <span className="ml-1">{menu ? "▾" : "▸"}</span>}
      </button>
      {!connected && (
        <button
          type="button"
          onClick={retry}
          className="ml-auto rounded-md bg-(--tmd-accent) px-2 py-0.5 font-medium text-white"
        >
          {t("重试")}
        </button>
      )}
      {menu && urls.length > 1 && (
        <div className="absolute left-2 top-8 z-50 min-w-52 rounded-xl border border-(--tmd-border) bg-(--tmd-bg-elevated) p-1 shadow-xl">
          <ChannelItem
            label={t("自动(按序竞速)")}
            selected={pin === "auto"}
            onPick={() => {
              saveChannelPin("auto");
              setMenu(false);
              retry();
            }}
          />
          {urls.map((u: string) => (
            <ChannelItem
              key={u}
              label={labelOf(u)}
              selected={pin === u}
              onPick={() => {
                saveChannelPin(u);
                setMenu(false);
                retry();
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ChannelItem({ label, selected, onPick }: { label: string; selected: boolean; onPick: () => void }) {
  return (
    <button
      type="button"
      onClick={onPick}
      className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-[0.8125rem] ${selected ? "bg-(--tmd-accent)/15 text-(--tmd-accent)" : "text-(--tmd-fg)"}`}
    >
      <span className="w-4 shrink-0">{selected ? "✓" : ""}</span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
    </button>
  );
}
