/**
 * 安装卡 —— 启用开关 + 三 harness(omp/pi/opencode)检测与安装 + 迁移。
 *
 * 三家原生组对齐上游(README 实证):omp/pi 经插件命令安装,opencode 改其
 * 配置(plugin 数组 + 禁原生 compaction);共享库迁移走 node bootstrap
 * (幂等,三家共用一库)。安装完成回调父级刷新池状态。
 */

import { useEffect, useState } from "react";
import { ipc } from "@kernel/ipc";
import { updateSettings, useSettingsState } from "@kernel/settings";
import {
  detectNode,
  detectOmpPluginInstalled,
  detectOpencodeInstalled,
  detectPiInstalled,
  type NodeEnv,
} from "../install/detect";
import { InstallOrchestrator } from "../install/setup";
import { pluginDistDir, userHome } from "../paths";

export type HarnessTarget = "omp" | "pi" | "opencode";

export function InstallCard({ onInstalled }: { onInstalled: () => Promise<void> | void }) {
  const { settings } = useSettingsState();
  const [node, setNode] = useState<NodeEnv | null>(null);
  const [ompInstalled, setOmpInstalled] = useState<boolean | null>(null);
  const [piInstalled, setPiInstalled] = useState<boolean | null>(null);
  const [ocInstalled, setOcInstalled] = useState<boolean | null>(null);
  const [target, setTarget] = useState<HarnessTarget>("omp");
  const [running, setRunning] = useState(false);
  const [log, setLog] = useState<string[]>([]);

  useEffect(() => {
    void (async () => {
      setNode(await detectNode());
      setOmpInstalled(await detectOmpPluginInstalled());
      const home = await userHome();
      setPiInstalled((await detectPiInstalled(`${home}/.pi/agent`)) === true);
      const ocCfg = await ipc.fsReadFile(`${home}/.config/opencode/opencode.jsonc`).catch(() => "");
      setOcInstalled(detectOpencodeInstalled(ocCfg));
    })();
  }, []);

  const targetInstalled = target === "omp" ? ompInstalled : target === "pi" ? piInstalled : ocInstalled;

  const install = () => {
    setRunning(true);
    const orch = new InstallOrchestrator();
    const line = (l: string) => setLog((prev) => [...prev, l]);
    void (async () => {
      try {
        const home = await userHome();
        if (target === "omp") {
          line("$ omp plugin install @cortexkit/pi-magic-context");
          await orch.installIntoOmp(line);
          setOmpInstalled(await detectOmpPluginInstalled());
        } else if (target === "pi") {
          line("$ pi install npm:@cortexkit/pi-magic-context");
          await orch.installIntoPi(line);
          setPiInstalled((await detectPiInstalled(`${home}/.pi/agent`)) === true);
        } else {
          line("$ opencode.jsonc: plugin[] += @cortexkit/opencode-magic-context");
          const ocCfg = `${home}/.config/opencode/opencode.jsonc`;
          const r = await orch.installIntoOpencode(ocCfg, ipc.fsReadFile, ipc.fsWriteFile, line);
          if (!r.ok) line("✗ " + r.message);
          else {
            const text = await ipc.fsReadFile(ocCfg).catch(() => "");
            setOcInstalled(detectOpencodeInstalled(text));
          }
        }
        line("$ node mc-bootstrap.mjs <magic-context-dist>");
        const mig = await orch.runBootstrap(await pluginDistDir(), line);
        line(mig.ok ? "✓ 迁移完成" : "✗ 迁移未完成:" + mig.message.slice(0, 120));
        await onInstalled();
      } finally {
        setRunning(false);
      }
    })();
  };

  const toggle = (on: boolean) =>
    `relative h-5 w-[30px] flex-none rounded-full border ${
      on ? "border-(--tmd-accent) bg-(--tmd-accent-soft)" : "border-(--tmd-border-strong) bg-(--tmd-bg-input)"
    }`;
  const knob = (on: boolean) =>
    `absolute top-1/2 h-[11px] w-[11px] -translate-y-1/2 rounded-full ${
      on ? "left-[14px] bg-(--tmd-accent)" : "left-[2px] bg-(--tmd-fg-faint)"
    }`;

  return (
    <div className="mb-3 rounded-lg border border-(--tmd-border) bg-(--tmd-bg-elevated) p-3">
      <div className="mb-2 flex flex-none items-center gap-2">
        <span className="text-[11.5px] font-semibold">启用</span>
        <button className={toggle(settings.memoryEnabled)} onClick={() => updateSettings({ memoryEnabled: !settings.memoryEnabled })}>
          <span className={knob(settings.memoryEnabled)} />
        </button>
      </div>
      <div className="mb-2 truncate text-[10.5px] text-(--tmd-fg-subtle)">
        {settings.memoryEnabled ? "胶囊与右栏面板已启用" : "已关闭:胶囊与面板全部隐藏"}
      </div>
      <div className="flex flex-col gap-1 text-[11px] text-(--tmd-fg-muted)">
        <div>
          {node === null
            ? "检测中…"
            : node.available
              ? `✓ node v${node.version}${node.meetsUpstreamRequirement ? "" : "(上游声明 ≥24,当前可跑)"}`
              : "✗ 未检测到 node —— 请先安装 Node.js ≥22"}
        </div>
        {ompInstalled !== null && <div>{ompInstalled ? "✓ omp 插件已注册" : "○ omp 插件未注册"}</div>}
        {piInstalled !== null && <div>{piInstalled ? "✓ pi 插件已注册" : "○ pi 插件未注册"}</div>}
        {ocInstalled !== null && <div>{ocInstalled ? "✓ opencode 插件已注册" : "○ opencode 插件未注册"}</div>}
      </div>
      <div className="mt-1.5 flex flex-none items-center gap-2">
        <span className="text-[10.5px] text-(--tmd-fg-faint)">安装到:</span>
        {(["omp", "pi", "opencode"] as const).map((t) => {
          const installed = t === "omp" ? ompInstalled : t === "pi" ? piInstalled : ocInstalled;
          return (
            <button
              key={t}
              className={`flex-none rounded-md border px-2 py-0.5 text-[10.5px] ${
                target === t
                  ? "border-(--tmd-accent) bg-(--tmd-accent-soft) text-(--tmd-fg)"
                  : "border-(--tmd-border) text-(--tmd-fg-subtle)"
              } hover:bg-(--tmd-bg-hover)`}
              onClick={() => setTarget(t)}
              title={installed === null ? "检测中" : installed ? "已安装(点击可重装,幂等不破坏数据)" : "未安装"}
            >
              {t}
              {installed === true && <span className="ml-1 text-(--tmd-ok)">✓</span>}
            </button>
          );
        })}
      </div>
      <div className="mt-0.5 truncate pl-1 text-[10px] text-(--tmd-fg-faint)">
        omp/pi 经插件命令安装;opencode 改其配置并禁原生压缩;三家共用同一个记忆库(迁移幂等)。重复安装是幂等的,不会覆盖或破坏已有记忆。
      </div>
      <div className="mt-2 flex flex-none items-center gap-2">
        <button
          className="flex-none rounded-md border border-(--tmd-accent) bg-(--tmd-accent) px-3 py-1 text-[11px] text-(--tmd-accent-fg) disabled:opacity-45"
          disabled={running || !node?.available}
          onClick={install}
        >
          {running ? "安装中…" : `${targetInstalled === true ? "重新安装" : "安装到"} ${target}`}
        </button>
      </div>
      {log.length > 0 && (
        <div className="mt-2 max-h-28 overflow-y-auto rounded-md border border-(--tmd-border) bg-(--tmd-bg-base) p-2 font-mono text-[10.5px] leading-relaxed text-(--tmd-fg-muted)">
          {log.map((l, i) => (
            <div key={i} className="truncate" title={l}>
              {l}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
