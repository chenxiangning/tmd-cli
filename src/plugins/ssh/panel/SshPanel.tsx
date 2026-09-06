/**
 * SshPanel —— 右栏 SSH 面板(filePanel 注册)。
 * 三段:连接卡(状态/延迟/断开/新建)、端口转发、SFTP 远端文件树。
 * 会话数据源 host.getSessions() 过滤 kind === "ssh";状态镜像 state.ts。
 */

import { useEffect, useState } from "react";
import { Plus, ArrowClockwise, PlugCharging } from "@phosphor-icons/react";
import { host, useHost } from "@kernel/host";
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
          <div>还没有 SSH 会话</div>
          <button type="button" className="ssh-btn is-primary" onClick={() => openHostPicker()}>
            <Plus size={12} /> 连接主机
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
  /* 重连:后端取原主机配置收尾重建(新会话新 id),旧 tab 随 pty://exit 消亡。 */
  const reconnect = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const old = host.getSessions().find((s) => s.id === sessionId);
      await host.createSshSession(sessionId, old?.workspaceId);
    } catch (e) {
      window.alert(`重连失败:${e instanceof Error ? e.message : String(e)}`);
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
        <span className={`ssh-session-status is-${status}`}>{SSH_STATUS_LABELS[status] ?? status}</span>
        {view?.latencyMs !== undefined ? (
          <span className="ssh-session-latency">{view.latencyMs}ms</span>
        ) : null}
      </button>
      {view?.message ? <div className="ssh-session-message">{view.message}</div> : null}
      <div className="ssh-session-actions">
        <button
          type="button"
          title="测延迟"
          onClick={() => void probeLatency(sessionId)}
        >
          <ArrowClockwise size={11} />
        </button>
        <button
          type="button"
          title="重新连接"
          disabled={busy || status === "connecting" || status === "reconnecting"}
          onClick={() => void reconnect()}
        >
          <ArrowClockwise size={11} />
        </button>
        <button
          type="button"
          title="断开连接"
          disabled={busy}
          onClick={() => void host.removeSession(sessionId)}
        >
          <PlugCharging size={11} />
        </button>
      </div>
    </div>
  );
}

function PanelSections({ sessionId }: { sessionId: string }) {
  const view = useSshSession(sessionId);
  const connected = view?.status === "connected";

  /* 延迟轮询:面板存在即测,15s 一拍(状态卡数值保鲜)。 */
  useEffect(() => {
    void probeLatency(sessionId);
    const timer = setInterval(() => void probeLatency(sessionId), 15_000);
    return () => clearInterval(timer);
  }, [sessionId]);

  return (
    <>
      <ForwardSection sessionId={sessionId} connected={connected} />
      <SftpTree sessionId={sessionId} connected={connected} />
    </>
  );
}
