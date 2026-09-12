/**
 * 安装卡 —— 启用开关 + 三 harness(omp/pi/opencode)检测与安装 + 迁移。
 *
 * 三家原生组对齐上游(README 实证):omp/pi 经插件命令安装,opencode 改其
 * 配置(plugin 数组 + 禁原生 compaction);共享库迁移走 node bootstrap
 * (幂等,三家共用一库)。安装完成回调父级刷新池状态。
 */

import { useEffect, useRef, useState } from "react";
import { ipc } from "@kernel/ipc";
import { updateSettings, useSettingsState } from "@kernel/settings";
import {
  detectNode,
  detectOmpPluginInstalled,
  detectOpencodeInstalled,
  detectPiInstalled,
  type NodeEnv,
} from "../install/detect";
import { t } from "@kernel/i18n";
import { InstallOrchestrator } from "../install/setup";
import { pluginDistDir, userHome } from "../paths";

type HarnessTarget = "omp" | "pi" | "opencode";

const toggle = (on: boolean) =>
  `relative h-5 w-[30px] flex-none rounded-full border ${
    on ? "border-(--tmd-accent) bg-(--tmd-accent-soft)" : "border-(--tmd-border-strong) bg-(--tmd-bg-input)"
  }`;
const knob = (on: boolean) =>
  `absolute top-1/2 h-[11px] w-[11px] -translate-y-1/2 rounded-full ${
    on ? "left-[14px] bg-(--tmd-accent)" : "left-[2px] bg-(--tmd-fg-faint)"
  }`;

/** 安装日志行(id 化,允许重复文本作 key)。 */
type LogLine = { id: number; text: string };

/** 三 harness 安装 + 共享库迁移(含迁移窗口暂停自家 omp 会话后重试)。 */
async function runInstallFlow(opts: {
  target: HarnessTarget;
  line: (l: string) => void;
  markOmp: (v: boolean) => void;
  markPi: (v: boolean) => void;
  markOc: (v: boolean) => void;
  onInstalled: () => Promise<void> | void;
}): Promise<void> {
  const { target, line, markOmp, markPi, markOc, onInstalled } = opts;
  const orch = new InstallOrchestrator();
  const home = await userHome();
  if (target === "omp") {
    line("$ omp plugin install @cortexkit/pi-magic-context");
    await orch.installIntoOmp(line);
    markOmp(await detectOmpPluginInstalled());
  } else if (target === "pi") {
    line("$ pi install npm:@cortexkit/pi-magic-context");
    await orch.installIntoPi(line);
    markPi((await detectPiInstalled(`${home}/.pi/agent`)) === true);
  } else {
    line("$ opencode.jsonc: plugin[] += @cortexkit/opencode-magic-context");
    const ocCfg = `${home}/.config/opencode/opencode.jsonc`;
    const r = await orch.installIntoOpencode(ocCfg, ipc.fsReadFile, ipc.fsWriteFile, line);
    if (!r.ok) line("✗ " + r.message);
    else {
      const text = await ipc.fsReadFile(ocCfg).catch(() => "");
      markOc(detectOpencodeInstalled(text));
    }
  }
  line("$ node mc-bootstrap.mjs <magic-context-dist>");
  let mig = await orch.runBootstrap(await pluginDistDir(), line);
  if (!mig.ok && mig.message === "migration-locked") {
    /* 迁移窗口状态机:任一 omp/pi 进程活着迁移即被拒。先暂停 tmd-cli
    自家 omp 会话(宿主全权,外部会话不动,await 进程死透)再重试一次;
    仍锁则提示用户。 */
    const paused = await orch.pauseOwnOmpSessions();
    if (paused > 0) {
      line(t("⏸ 检测到共享库被占用:已暂停 tmd-cli 自家 omp 会话 {n} 个,重试迁移…", { n: paused }));
      /* kill 返回 ≠ 锁立即可用:留半秒缓冲等 SQLite 句柄释放 */
      const settle = Promise.withResolvers<void>();
      setTimeout(settle.resolve, 500);
      await settle.promise;
      mig = await orch.runBootstrap(await pluginDistDir(), line);
    }
    if (!mig.ok) {
      orch.clearPauseLedger();
      line(t("✗ 仍被锁:机器上还有外部 omp/pi 进程在运行,请全部退出后重新点一次安装。"));
    }
  }
  if (mig.ok) line(t("✓ 迁移完成"));
  else if (!mig.message.startsWith("migration-locked")) line(t("✗ 迁移未完成:{msg}", { msg: mig.message.slice(0, 120) }));
  await onInstalled();
}

/** 检测状态行:node 可用性 + 三家插件注册态。 */
function DetectStatusList({
  node,
  ompInstalled,
  piInstalled,
  ocInstalled,
}: {
  node: NodeEnv | null;
  ompInstalled: boolean | null;
  piInstalled: boolean | null;
  ocInstalled: boolean | null;
}) {
  return (
    <div className="flex flex-col gap-1 text-[0.6875rem] text-(--tmd-fg-muted)">
      <div>
        {node === null
          ? t("检测中…")
          : node.available
            ? `✓ node v${node.version}${node.meetsUpstreamRequirement ? "" : t("(上游声明 ≥24,当前可跑)")}`
            : t("✗ 未检测到 node —— 请先安装 Node.js ≥22")}
      </div>
      {ompInstalled !== null && <div>{ompInstalled ? t("✓ omp 插件已注册") : t("○ omp 插件未注册")}</div>}
      {piInstalled !== null && <div>{piInstalled ? t("✓ pi 插件已注册") : t("○ pi 插件未注册")}</div>}
      {ocInstalled !== null && <div>{ocInstalled ? t("✓ opencode 插件已注册") : t("○ opencode 插件未注册")}</div>}
    </div>
  );
}

/** 安装目标选择:三家 tab 式按钮,已装者带 ✓(title 给检测态提示)。 */
function HarnessTargetPicker({
  target,
  ompInstalled,
  piInstalled,
  ocInstalled,
  onPick,
}: {
  target: HarnessTarget;
  ompInstalled: boolean | null;
  piInstalled: boolean | null;
  ocInstalled: boolean | null;
  onPick: (t: HarnessTarget) => void;
}) {
  return (
    <>
      <span className="text-[0.65625rem] text-(--tmd-fg-faint)">{t("安装到:")}</span>
      {(["omp", "pi", "opencode"] as const).map((eng) => {
        const installed = eng === "omp" ? ompInstalled : eng === "pi" ? piInstalled : ocInstalled;
        return (
          <button
            key={eng}
            className={`flex-none rounded-md border px-2 py-0.5 text-[0.65625rem] ${
              target === eng
                ? "border-(--tmd-accent) bg-(--tmd-accent-soft) text-(--tmd-fg)"
                : "border-(--tmd-border) text-(--tmd-fg-subtle)"
            } hover:bg-(--tmd-bg-hover)`}
            onClick={() => onPick(eng)}
            title={installed === null ? t("检测中") : installed ? t("已安装(点击可重装,幂等不破坏数据)") : t("未安装")}
          >
            {eng}
            {installed === true && <span className="ml-1 text-(--tmd-ok)">✓</span>}
          </button>
        );
      })}
    </>
  );
}

/** 安装日志(逐行,滚动区)。 */
function InstallLogView({ log }: { log: LogLine[] }) {
  if (log.length === 0) return null;
  return (
    <div className="mt-2 max-h-28 overflow-y-auto rounded-md border border-(--tmd-border) bg-(--tmd-bg-base) p-2 font-mono text-[0.65625rem] leading-relaxed text-(--tmd-fg-muted)">
      {log.map((entry) => (
        <div key={entry.id} className="truncate" title={entry.text}>
          {entry.text}
        </div>
      ))}
    </div>
  );
}

export function InstallCard({ onInstalled }: { onInstalled: () => Promise<void> | void }) {
  const { settings } = useSettingsState();
  const [node, setNode] = useState<NodeEnv | null>(null);
  const [ompInstalled, setOmpInstalled] = useState<boolean | null>(null);
  const [piInstalled, setPiInstalled] = useState<boolean | null>(null);
  const [ocInstalled, setOcInstalled] = useState<boolean | null>(null);
  const [target, setTarget] = useState<HarnessTarget>("omp");
  const [running, setRunning] = useState(false);
  const [log, setLog] = useState<LogLine[]>([]);
  const logSeq = useRef(0);

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
    const line = (l: string) => {
      const id = logSeq.current++;
      setLog((prev) => [...prev, { id, text: l }]);
    };
    void runInstallFlow({
      target,
      line,
      markOmp: setOmpInstalled,
      markPi: setPiInstalled,
      markOc: setOcInstalled,
      onInstalled,
    }).finally(() => setRunning(false));
  };

  return (
    <div className="mb-3 rounded-lg border border-(--tmd-border) bg-(--tmd-bg-elevated) p-3">
      <div className="mb-2 flex flex-none items-center gap-2">
        <span className="text-[0.71875rem] font-semibold">{t("启用")}</span>
        <button
          className={toggle(settings.memoryEnabled)}
          aria-label={t("启用")}
          onClick={() => updateSettings({ memoryEnabled: !settings.memoryEnabled })}
        >
          <span className={knob(settings.memoryEnabled)} />
        </button>
      </div>
      <div className="mb-2 truncate text-[0.65625rem] text-(--tmd-fg-subtle)">
        {settings.memoryEnabled ? t("胶囊与右栏面板已启用") : t("已关闭:胶囊与面板全部隐藏")}
      </div>
      <DetectStatusList node={node} ompInstalled={ompInstalled} piInstalled={piInstalled} ocInstalled={ocInstalled} />
      <div className="mt-1.5 flex flex-none items-center gap-2">
        <HarnessTargetPicker
          target={target}
          ompInstalled={ompInstalled}
          piInstalled={piInstalled}
          ocInstalled={ocInstalled}
          onPick={setTarget}
        />
      </div>
      <div className="mt-0.5 truncate pl-1 text-[0.625rem] text-(--tmd-fg-faint)">
        {t("omp/pi 经插件命令安装;opencode 改其配置并禁原生压缩;三家共用同一个记忆库(迁移幂等)。重复安装是幂等的,不会覆盖或破坏已有记忆。")}
      </div>
      <div className="mt-2 flex flex-none items-center gap-2">
        <button
          className="flex-none rounded-md border border-(--tmd-accent) bg-(--tmd-accent) px-3 py-1 text-[0.6875rem] text-(--tmd-accent-fg) disabled:opacity-45"
          disabled={running || !node?.available}
          onClick={install}
        >
          {running ? t("安装中…") : targetInstalled === true ? t("重新安装 {target}", { target }) : t("安装到 {target}", { target })}
        </button>
      </div>
      <InstallLogView log={log} />
    </div>
  );
}
