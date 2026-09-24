/**
 * 发起会话弹层(手机端唯一的新会话入口)。
 * 选工作区(config_read_workspaces)× 选引擎(内置表)→ session_spawn;
 * spec.command 受桌面域闸引擎白名单收敛(自由命令在桌面打回)。
 * 引擎表 = 与桌面 cli-* 插件声明的启动命令对齐的静态清单。
 */
import { useState } from "react";
import { t } from "@kernel/i18n";
import { useMobile } from "./shared";
import { glyphOf } from "./remote";

/** 内置引擎表(profileId = 桌面 cli-* 插件 id;cmd = 启动命令 basename)。 */
const ENGINES: { id: string; name: string; cmd: string }[] = [
  { id: "omp", name: "OMP", cmd: "omp" },
  { id: "pi", name: "Pi", cmd: "pi" },
  { id: "claude", name: "Claude Code", cmd: "claude" },
  { id: "codex", name: "Codex CLI", cmd: "codex" },
  { id: "kimi", name: "Kimi", cmd: "kimi" },
  { id: "grok", name: "Grok", cmd: "grok" },
  { id: "qoder", name: "Qoder", cmd: "qodercli" },
  { id: "opencode", name: "OpenCode", cmd: "opencode" },
];

export function SpawnSheet(props: { onClose: () => void; onSpawned: (sessionId: string) => void }) {
  const { workspaces, connected } = useMobile();
  const [wsId, setWsId] = useState(workspaces[0]?.id ?? "");
  const [engineId, setEngineId] = useState(ENGINES[0].id);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const ws = workspaces.find((w) => w.id === wsId);
  const engine = ENGINES.find((e) => e.id === engineId) ?? ENGINES[0];
  const blocked = !connected || workspaces.length === 0;

  const spawn = async () => {
    if (!ws) {
      setErr(t("没有可用工作区"));
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const { invoke } = await import("@kernel/transport");
      const r = await invoke<{ id: string }>("session_spawn", {
        profileId: engine.id,
        spec: {
          command: engine.cmd,
          args: [],
          cwd: ws.root,
          cols: 80,
          rows: 24,
          env: {},
        },
        workspaceId: ws.id,
      });
      props.onSpawned(r.id);
    } catch (e) {
      setErr(String((e as Error).message ?? e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="sheet-scrim" onClick={props.onClose}>
      <button
        type="button"
        aria-label={t("关闭")}
        className="sheet-scrim-hit"
        style={{ position: "absolute", inset: 0, cursor: "default", background: "none", border: "none" }}
        onClick={props.onClose}
      />
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-h">{t("发起会话")}</div>

        <div className="sheet-label">{t("工作区")}</div>
        <div className="sheet-opts">
          {workspaces.map((w) => (
            <button
              key={w.id}
              type="button"
              className={`sheet-opt${wsId === w.id ? " on" : ""}`}
              onClick={() => setWsId(w.id)}
            >
              <span className="tick">{wsId === w.id ? "✓" : ""}</span>
              <span className="min-w-0 flex-1 truncate">{w.name}</span>
            </button>
          ))}
        </div>

        <div className="sheet-label">{t("引擎")}</div>
        <div className="sheet-grid">
          {ENGINES.map((e) => {
            const gg = glyphOf(e.id);
            return (
              <button
                key={e.id}
                type="button"
                className={`sheet-opt${engineId === e.id ? " on" : ""}`}
                onClick={() => setEngineId(e.id)}
              >
                <span className="tick" />
                <span className={`glyph ${gg.cls}`}>{gg.text}</span>
                {e.name}
              </button>
            );
          })}
        </div>

        {blocked ? (
          <div className="m-err" style={{ textAlign: "left" }}>
            {!connected
              ? t("未连接桌面:连接恢复后再发起会话(右上 ⇄ 可手动重试)")
              : t("桌面还没有工作区:先在桌面端设置里添加")}
          </div>
        ) : (
          <>
            {err && <div className="m-err" style={{ textAlign: "left" }}>{err}</div>}
            <button type="button" className="m-btn" disabled={busy} onClick={() => void spawn()}>
              {busy ? t("启动中…") : `${t("在")} ${ws?.name ?? "?"} ${t("启动")} ${engine.name}`}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
