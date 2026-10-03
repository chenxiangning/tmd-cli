/**
 * 发起会话弹层(手机端唯一的新会话入口)。
 * 选工作区(config_read_workspaces)× 选引擎(内置表)→ session_spawn;
 * spec.command 受桌面域闸引擎白名单收敛(自由命令在桌面打回)。
 * 引擎表 = 与桌面 cli-* 插件声明的启动命令对齐的静态清单。
 * 排布基准 = spec 2026-10-03-mobile-spawn-sheet-polish-design:
 * 基座头(title)+ 工作区整行选中 + 引擎双列卡片 + 全宽 CTA + 提示卡。
 */
import { useEffect, useState } from "react";
import { t } from "@kernel/i18n";
import { invoke } from "@kernel/transport";
import { useMobile } from "./shared";
import { SheetBase } from "./SheetBase";
import { EngineMark } from "./EngineMark";
import { CheckIcon } from "./treeIcons";
import { ENGINES } from "./engines"; /* 单一来源(评审 P2-2:双份手抄已现 qoder cmd drift) */

export function SpawnSheet(props: { onClose: () => void; onSpawned: (sessionId: string) => void }) {
  const { workspaces, wsLoaded, connected } = useMobile();
  const [wsId, setWsId] = useState(workspaces[0]?.id ?? "");
  const [engineId, setEngineId] = useState(ENGINES[0].id);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  /* 默认工作区回填:workspaces 启动异步拉取,sheet 先挂载、数据后到货时
   * 初值取空;失效(列表换代)也回填首项,免得 CTA 与眼前列表矛盾。 */
  useEffect(() => {
    if (workspaces.length && !workspaces.some((w) => w.id === wsId)) setWsId(workspaces[0].id);
  }, [workspaces, wsId]);

  const ws = workspaces.find((w) => w.id === wsId);
  const engine = ENGINES.find((e) => e.id === engineId) ?? ENGINES[0];
  /* 空表仍挡 CTA(未加载/确无都不可发),但文案分流:首拉未到 = 加载提示,
   * 免冷启动误报「桌面还没有工作区」(2026-10-03 二轮相邻面评审)。 */
  const blocked = !connected || workspaces.length === 0;

  const spawn = async () => {
    if (!ws) {
      setErr(t("没有可用工作区"));
      return;
    }
    setBusy(true);
    setErr(null);
    try {
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
    <SheetBase onClose={props.onClose} label={t("发起会话")} title={t("发起会话")}>
      <div className="sheet-label">{t("工作区")}</div>
      <div className="sheet-opts">
        {workspaces.map((w) => (
          <button
            key={w.id}
            type="button"
            className={`ws-opt${wsId === w.id ? " on" : ""}`}
            onClick={() => setWsId(w.id)}
          >
            <span className="fx-ellip">{w.name}</span>
            <span className="ck">{wsId === w.id ? <CheckIcon /> : null}</span>
          </button>
        ))}
      </div>

      <div className="sheet-label">{t("引擎")}</div>
      <div className="eng-grid">
        {ENGINES.map((e) => (
          <button
            key={e.id}
            type="button"
            className={`eng-opt${engineId === e.id ? " on" : ""}`}
            onClick={() => setEngineId(e.id)}
          >
            <EngineMark profileId={e.id} />
            <span className="nm fx-ellip">{e.name}</span>
            <span className="dot" aria-hidden />
          </button>
        ))}
      </div>

      {blocked ? (
        <div className="sheet-alert warn">
          {!connected
            ? t("未连接桌面:连接恢复后再发起会话(右上 ⇄ 可手动重试)")
            : !wsLoaded
              ? t("正在获取工作区…")
              : t("桌面还没有工作区:先在桌面端设置里添加")}
        </div>
      ) : (
        <>
          {err && <div className="sheet-alert err">{err}</div>}
          <button type="button" className="sheet-cta" disabled={busy} onClick={() => void spawn()}>
            {busy ? t("启动中…") : t("启动 {engine}", { engine: engine.name })}
          </button>
        </>
      )}
    </SheetBase>
  );
}
