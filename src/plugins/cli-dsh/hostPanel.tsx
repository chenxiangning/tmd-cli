/**
 * DshHostPanel —— 设置页「DeepSeek Harness」连接面板(codemoss DshConnectionPanel
 * 同构)。域逻辑(探针/持久化/会话登记)在 dshHost.ts;本文件只管渲染与交互。
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowClockwise, ArrowSquareOut, Play, Stop } from "@phosphor-icons/react";
import { openExternalUrl } from "@kernel/ipc";
import {
  delay,
  loadConnection,
  saveConnection,
  normalizeConnection,
  originOf,
  probeHost,
  currentHostSessionId,
  startHostSession,
  stopHostSession,
  type DshConnection,
  type DshHostView,
} from "./dshHost";

type HostStatus =
  | { kind: "probing" }
  | { kind: "starting" }
  | { kind: "ok"; view: DshHostView }
  | { kind: "down" };

const BTN =
  "flex items-center gap-1 rounded-md border border-(--tmd-border) px-2.5 py-1 text-sm text-(--tmd-fg) hover:bg-(--tmd-bg-hover) disabled:cursor-not-allowed disabled:opacity-50";
const BTN_PRIMARY =
  "flex items-center gap-1 rounded-md border border-(--tmd-accent) bg-(--tmd-accent) px-2.5 py-1 text-sm text-(--tmd-accent-fg) hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50";
const INPUT =
  "rounded-md border border-(--tmd-border) bg-(--tmd-bg-input) px-2 py-1 text-sm text-(--tmd-fg) outline-none focus:border-(--tmd-accent)";

export function DshHostPanel() {
  const [conn, setConn] = useState<DshConnection>(loadConnection);
  const [status, setStatus] = useState<HostStatus>({ kind: "probing" });
  const [busy, setBusy] = useState(false);
  /* 探针竞态守卫:慢探测回来时不许覆盖更新的状态。 */
  const probeSeq = useRef(0);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const refresh = useCallback(async () => {
    const seq = ++probeSeq.current;
    setStatus({ kind: "probing" });
    const view = await probeHost(conn);
    if (!alive.current || seq !== probeSeq.current) return;
    setStatus(view ? { kind: "ok", view } : { kind: "down" });
  }, [conn]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const applyDraft = (host: string, port: string) => {
    const next = normalizeConnection(host, port);
    setConn(next);
    saveConnection(next);
  };

  const onStart = async () => {
    setBusy(true);
    setStatus({ kind: "starting" });
    try {
      await startHostSession(conn);
      /* 就绪轮询:1.5s × 16 ≈ 24s(codemoss wait_until_ready 同窗口)。 */
      for (let i = 0; i < 16; i++) {
        await delay(1500);
        if (!alive.current) return;
        const view = await probeHost(conn);
        if (view) {
          setStatus({ kind: "ok", view });
          setBusy(false);
          return;
        }
      }
      setStatus({ kind: "down" });
    } catch {
      setStatus({ kind: "down" });
    }
    setBusy(false);
  };

  const onStop = async () => {
    setBusy(true);
    await stopHostSession();
    await delay(600);
    if (alive.current) {
      setBusy(false);
      void refresh();
    }
  };

  const connected = status.kind === "ok";
  const selfStarted = connected && currentHostSessionId() !== null;
  const statusLabel =
    status.kind === "ok"
      ? "主机已连接"
      : status.kind === "down"
        ? "主机未运行"
        : status.kind === "starting"
          ? "正在启动…"
          : "正在检测…";
  const statusDetail =
    status.kind === "ok"
      ? `已连接到 ${originOf(conn)}${status.view.provider ? ` · 当前供应商 ${status.view.provider}` : ""}${status.view.model ? ` · 当前模型 ${status.view.model}` : ""}${typeof status.view.sessions === "number" ? ` · 已挂会话 ${status.view.sessions}` : ""}${selfStarted ? "" : "(非本客户端拉起,请在原处停止)"}`
      : status.kind === "down"
        ? `${originOf(conn)} 无响应`
        : originOf(conn);

  return (
    <div className="pref-card">
      <div className="pref-row">
        <div>
          <div className="pref-title">提示</div>
          <div className="pref-desc">
            模型和 API Key 在 DSH Web UI 里配置,这里只负责装 CLI、起本地 host(要求
            Node &ge; 22.19 或 &ge; 24)。启动 = 新开一个「DSH Host」终端会话跑 dsh
            web,关掉会话即停止服务。
          </div>
        </div>
      </div>
      <div className="pref-row">
        <div className="min-w-0">
          <div className="pref-title">
            <span
              aria-hidden
              className="mr-1.5 inline-block h-2 w-2 rounded-full align-middle"
              style={{
                background:
                  status.kind === "ok"
                    ? "var(--tmd-ok)"
                    : status.kind === "down"
                      ? "var(--tmd-err)"
                      : "var(--tmd-warn)",
              }}
            />
            {statusLabel}
          </div>
          <div className="pref-desc">{statusDetail}</div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            className={BTN}
            disabled={!connected}
            onClick={() => void openExternalUrl(originOf(conn))}
          >
            <ArrowSquareOut size={13} /> 打开 Web UI
          </button>
          {selfStarted ? (
            <button type="button" className={BTN} disabled={busy} onClick={() => void onStop()}>
              <Stop size={13} /> 停止服务
            </button>
          ) : (
            <button
              type="button"
              className={BTN_PRIMARY}
              disabled={busy || connected}
              title={connected ? "已有 host 在运行(外部拉起),无需启动" : undefined}
              onClick={() => void onStart()}
            >
              <Play size={13} /> 启动服务
            </button>
          )}
          <button type="button" className={BTN} disabled={busy} onClick={() => void refresh()}>
            <ArrowClockwise size={13} /> 重新检测
          </button>
        </div>
      </div>
      <div className="pref-row">
        <div>
          <div className="pref-title">连接设置</div>
          <div className="pref-desc">改端口前先确认没有别的进程占着;失焦即保存并重测。</div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <input
            aria-label="Host 地址"
            className={`${INPUT} w-40 text-left`}
            defaultValue={conn.host}
            onBlur={(e) => applyDraft(e.target.value, String(conn.port))}
          />
          <input
            aria-label="端口"
            className={`${INPUT} w-24 text-right`}
            type="number"
            min={1}
            max={65535}
            defaultValue={conn.port}
            onBlur={(e) => applyDraft(conn.host, e.target.value)}
          />
        </div>
      </div>
    </div>
  );
}
