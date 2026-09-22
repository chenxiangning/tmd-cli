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
  { id: "qoder", name: "Qoder", cmd: "qoder" },
  { id: "opencode", name: "OpenCode", cmd: "opencode" },
];

export function SpawnSheet(props: { onClose: () => void; onSpawned: (sessionId: string) => void }) {
  const { workspaces } = useMobile();
  const [wsId, setWsId] = useState(workspaces[0]?.id ?? "");
  const [engineId, setEngineId] = useState(ENGINES[0].id);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const ws = workspaces.find((w) => w.id === wsId);
  const engine = ENGINES.find((e) => e.id === engineId) ?? ENGINES[0];

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
    <div className="fixed inset-0 z-40 flex items-end" onClick={props.onClose}>
      <button
          type="button"
          aria-label={t("关闭")}
          className="absolute inset-0 cursor-default bg-black/45"
          onClick={props.onClose}
        />
      <div
        className="relative z-10 max-h-[70vh] w-full overflow-auto rounded-t-2xl border-t border-(--tmd-border) bg-(--tmd-bg-base) p-4 pb-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 text-[0.9375rem] font-semibold">{t("发起会话")}</div>

        <div className="mb-1 text-[11.5px] font-semibold text-(--tmd-muted)">{t("工作区")}</div>
        <div className="mb-3 flex flex-col gap-1">
          {workspaces.map((w) => (
            <button
              key={w.id}
              type="button"
              className={`flex items-center gap-2 rounded-lg px-3 py-2 text-left text-[13px] ${wsId === w.id ? "bg-(--tmd-accent-soft) text-(--tmd-accent)" : "text-(--tmd-fg)"}`}
              onClick={() => setWsId(w.id)}
            >
              <span className="w-4">{wsId === w.id ? "✓" : ""}</span>
              <span className="min-w-0 flex-1 truncate">{w.name}</span>
            </button>
          ))}
        </div>

        <div className="mb-1 text-[11.5px] font-semibold text-(--tmd-muted)">{t("引擎")}</div>
        <div className="mb-3 grid grid-cols-2 gap-1">
          {ENGINES.map((e) => {
            const gg = glyphOf(e.id);
            return (
              <button
                key={e.id}
                type="button"
                className={`flex items-center gap-2 rounded-lg px-3 py-2 text-left text-[13px] ${engineId === e.id ? "bg-(--tmd-accent-soft) text-(--tmd-accent)" : "text-(--tmd-fg)"}`}
                onClick={() => setEngineId(e.id)}
              >
                <span className={`glyph ${gg.cls}`}>{gg.text}</span>
                {e.name}
              </button>
            );
          })}
        </div>

        {err && <div className="m-err" style={{ textAlign: "left" }}>{err}</div>}
        <button type="button" className="m-btn" disabled={busy} onClick={() => void spawn()}>
          {busy ? t("启动中…") : `${t("在")} ${ws?.name ?? "?"} ${t("启动")} ${engine.name}`}
        </button>
      </div>
    </div>
  );
}
