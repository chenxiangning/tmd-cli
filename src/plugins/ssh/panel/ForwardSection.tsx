/**
 * ForwardSection —— 本地端口转发(`-L`)面板段。
 * 会话卡下发(启动/停止/复制地址),本地端口留空 = 自动分配,占用预检。
 */

import { useEffect, useState } from "react";
import { ArrowsLeftRight, Minus, Plus } from "@phosphor-icons/react";
import { ipc } from "@kernel/ipc";
import { t } from "@kernel/i18n";
import { refreshForwards, useSshSession } from "../state";

export function ForwardSection({ sessionId, connected }: { sessionId: string; connected: boolean }) {
  const view = useSshSession(sessionId);
  const forwards = view?.forwards ?? [];
  const [formOpen, setFormOpen] = useState(false);

  useEffect(() => {
    void refreshForwards(sessionId);
  }, [sessionId, connected]);

  return (
    <div className="ssh-section">
      <div className="ssh-section-head">
        <ArrowsLeftRight size={12} aria-hidden />
        <span>{t("端口转发")}</span>
        <button
          type="button"
          className="ssh-icon-btn"
          title={t("新建转发")}
          disabled={!connected}
          onClick={() => setFormOpen((open) => !open)}
        >
          {formOpen ? <Minus size={12} /> : <Plus size={12} />}
        </button>
      </div>
      {formOpen ? (
        <ForwardForm sessionId={sessionId} onDone={() => setFormOpen(false)} />
      ) : null}
      {forwards.length === 0 ? (
        <div className="ssh-section-empty">{t("将远端服务映射到本地 127.0.0.1")}</div>
      ) : (
        <div className="ssh-forward-list">
          {forwards.map((forward) => (
            <div className="ssh-forward-row" key={forward.id}>
              <button
                type="button"
                className="ssh-forward-addr"
                title={t("点击复制本地地址")}
                onClick={() => void navigator.clipboard.writeText(`${forward.localHost}:${forward.localPort}`)}
              >
                {forward.localHost}:{forward.localPort}
                <span className="ssh-forward-arrow">→</span>
                {forward.remoteHost}:{forward.remotePort}
              </button>
              <button
                type="button"
                className="ssh-icon-btn"
                title={t("停止")}
                onClick={() => void stopForward(sessionId, forward.id)}
              >
                <Minus size={11} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

async function stopForward(sessionId: string, forwardId: string) {
  try {
    await ipc.sshForwardStop(sessionId, forwardId);
  } catch {
    /* 已随会话级联移除:事件快照会收敛。 */
  }
  await refreshForwards(sessionId);
}

function ForwardForm({ sessionId, onDone }: { sessionId: string; onDone: () => void }) {
  const [remoteHost, setRemoteHost] = useState("127.0.0.1");
  const [remotePort, setRemotePort] = useState("");
  const [localPort, setLocalPort] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    const port = Number(remotePort.trim());
    if (!remoteHost.trim() || !Number.isInteger(port) || port < 1 || port > 65535) {
      setError(t("远端主机与端口(1-65535)必填"));
      return;
    }
    const local = localPort.trim() ? Number(localPort.trim()) : null;
    if (local !== null && (!Number.isInteger(local) || local < 1 || local > 65535)) {
      setError(t("本地端口须在 1-65535 或留空自动分配"));
      return;
    }
    if (local !== null) {
      const free = await ipc.sshForwardCheckPort(local);
      if (!free) {
        setError(t("本地端口 {port} 已被占用", { port: local }));
        return;
      }
    }
    setBusy(true);
    setError(null);
    try {
      await ipc.sshForwardStart(sessionId, remoteHost.trim(), port, local ?? undefined);
      await refreshForwards(sessionId);
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="ssh-forward-form">
      <input
        value={remoteHost}
        placeholder={t("远端主机(默认 127.0.0.1)")}
        onChange={(e) => setRemoteHost(e.target.value)}
      />
      <input
        value={remotePort}
        placeholder={t("远端端口")}
        inputMode="numeric"
        onChange={(e) => setRemotePort(e.target.value)}
      />
      <input
        value={localPort}
        placeholder={t("本地端口(留空自动)")}
        inputMode="numeric"
        onChange={(e) => setLocalPort(e.target.value)}
      />
      {error ? <div className="ssh-form-error">{error}</div> : null}
      <button type="button" className="ssh-btn is-primary" disabled={busy} onClick={() => void submit()}>
        {t("建立转发")}
      </button>
    </div>
  );
}
