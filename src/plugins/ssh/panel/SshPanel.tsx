/**
 * SshPanel —— 右栏 SSH 面板(filePanel 注册)。
 * 三段:连接卡(状态/延迟/断开/新建)、端口转发、SFTP 远端文件树。
 * 会话数据源 host.getSessions() 过滤 kind === "ssh";状态镜像 state.ts。
 */

import { useEffect, useState } from "react";
import { usePanelActive } from "@kernel/panelActivity";
import { Plus, ArrowClockwise, PlugCharging } from "@phosphor-icons/react";
import { host, useHost } from "@kernel/host";
import { t } from "@kernel/i18n";
import { SSH_STATUS_LABELS, openHostPicker, probeLatency, useSshSession } from "../state";
import { ForwardSection } from "./ForwardSection";
import { SftpTree } from "./SftpTree";

/** 右栏面板本体(index.tsx activate 时经 registerFilePanel 注册)。 */
export function SshPanel() {
  useHost();
  const sessions = host.getSessions().filter((s) => s.kind === "ssh");
  const activeId = host.getActiveSessionId();
  const active = sessions.find((s) => s.id === activeId) ?? sessions.at(-1) ?? null;

  if (sessions.length === 0) {
    return (
      <div className="ssh-panel">
        <div className="ssh-panel-empty">
          <div>{t("还没有 SSH 会话")}</div>
          <button type="button" className="ssh-btn is-primary" onClick={() => openHostPicker()}>
            <Plus size="0.75rem" /> {t("连接主机")}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="ssh-panel">
      <div className="ssh-session-list">
        {sessions.map((session) => (
          <SessionCard
            key={session.id}
            sessionId={session.id}
            label={sessionLabel(session)}
            active={session.id === active?.id}
          />
        ))}
      </div>
      {active ? <PanelSections sessionId={active.id} /> : null}
    </div>
  );
}

function sessionLabel(session: { id: string; profileId: string; cwd: string }) {
  return `SSH · ${session.id.slice(0, 8)}`;
}

function SessionCard({
  sessionId,
  label,
  active,
}: {
  sessionId: string;
  label: string;
  active: boolean;
}) {
  const view = useSshSession(sessionId);
  const status = view?.status ?? "connecting";
  const [busy, setBusy] = useState(false);
  /* 重连失败内联红字(原生 alert 清零:复用会话卡消息槽,SshOverlay 同形制)。 */
  const [error, setError] = useState<string | null>(null);
  /* 重连:后端取原主机配置收尾重建(新会话新 id),旧 tab 随 pty://exit 消亡。 */
  const reconnect = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const old = host.getSessions().find((s) => s.id === sessionId);
      await host.createSshSession(sessionId, old?.workspaceId);
    } catch (e) {
      setError(t("重连失败:{msg}", { msg: e instanceof Error ? e.message : String(e) }));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className={`ssh-session-card${active ? " is-active" : ""}`}>
      <button
        type="button"
        className="ssh-session-main"
        onClick={() => host.setActiveSession(sessionId)}
      >
        <span className={`ssh-status-dot is-${status}`} aria-hidden />
        <span className="ssh-session-label">{label}</span>
        <span className={`ssh-session-status is-${status}`}>{t(SSH_STATUS_LABELS[status] ?? status)}</span>
        {view?.latencyMs !== undefined ? (
          <span className="ssh-session-latency">{view.latencyMs}ms</span>
        ) : null}
      </button>
      {view?.message ? <div className="ssh-session-message">{view.message}</div> : null}
      {error ? (
        <div className="ssh-session-message" role="alert">
          {error}
        </div>
      ) : null}
      <div className="ssh-session-actions">
        <button
          type="button"
          title={t("测延迟")}
          onClick={() => void probeLatency(sessionId)}
        >
          <ArrowClockwise size="0.6875rem" />
        </button>
        <button
          type="button"
          title={t("重新连接")}
          disabled={busy || status === "connecting" || status === "reconnecting"}
          onClick={() => void reconnect()}
        >
          <ArrowClockwise size="0.6875rem" />
        </button>
        <button
          type="button"
          title={t("断开连接")}
          disabled={busy}
          onClick={() => void host.removeSession(sessionId)}
        >
          <PlugCharging size="0.6875rem" />
        </button>
      </div>
    </div>
  );
}

function PanelSections({ sessionId }: { sessionId: string }) {
  const view = useSshSession(sessionId);
  const connected = view?.status === "connected";

  /* 延迟轮询:面板存在即测,15s 一拍(状态卡数值保鲜);隐藏态短路,回切即测。 */
  const panelActive = usePanelActive();
  useEffect(() => {
    if (!panelActive) return;
    void probeLatency(sessionId);
    const timer = setInterval(() => void probeLatency(sessionId), 15_000);
    return () => clearInterval(timer);
  }, [sessionId, panelActive]);

  return (
    <>
      <ForwardSection sessionId={sessionId} connected={connected} />
      {/* key=sessionId:会话切换走重挂,树体/错误态天然复位(SftpTree 内不再持 prop 反应 effect)。 */}
      <SftpTree key={sessionId} sessionId={sessionId} connected={connected} />
    </>
  );
}
