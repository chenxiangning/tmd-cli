/**
 * 单引擎状态容器(自 WelcomePage 拆出,300 行铁则):探针 + 安装 hook
 * 必须组件化,故每引擎一个子组件;新会话动作由页级注入的 onNewSession
 * 承载(prompt 行选中的工作区在页级持有)。
 */

import { useCallback, useRef } from "react";
import { host } from "@kernel/host";
import { useHomePanels } from "@kernel/homePanels";
import type { EngineMeta } from "./engineMeta";
import { pinPlanVersion, pinPrerequisiteVersion, resolveInstallPlan } from "./engineMeta";
import type { EngineCredential } from "./credentials";
import { depOutdatedOf } from "./latestVersion";
import { EngineCard, useEngineInstall, type EngineProbeState } from "./EngineCard";

export function EngineSection({
  meta,
  probe,
  depProbe,
  latest,
  creds,
  expanded,
  onToggleExpand,
  cursor,
  onCursor,
  onProbe,
  onDepProbe,
  onNewSession,
}: {
  meta: EngineMeta;
  probe: EngineProbeState;
  /** 前置依赖探针状态(meta.requires 存在时由页级传入)。 */
  depProbe?: EngineProbeState;
  latest: string | null | undefined;
  creds: EngineCredential[] | undefined;
  expanded: boolean;
  onToggleExpand: () => void;
  cursor: boolean;
  /** 点击行主体 = 游标移到本行。 */
  onCursor: () => void;
  onProbe: () => void;
  /** 重探前置依赖(参数 = 依赖 binary)。 */
  onDepProbe: (binary: string) => void;
  /** 以页级选中工作区启动本引擎新会话。 */
  onNewSession: () => void;
}) {
  const engineId = meta.id;
  const profile = host.getCliProfile(engineId);
  /* 探针命中副本决定更新通道(双副本遮蔽修复):npm 拥有的副本就地 npm
     更新,其余走声明通道。未装(notFound)保持声明通道原样。 */
  const effectiveMeta: EngineMeta =
    probe.status === "ok" && probe.result
      ? { ...meta, plan: resolveInstallPlan(meta, probe.result) }
      : meta;
  const [install, startInstall] = useEngineInstall(effectiveMeta, onProbe);
  const HomePanel = useHomePanels().get(engineId);
  /* 依赖安装完成 → 重探依赖;探针 ok 后 EngineCard 的主引擎按钮自动解锁。
   * 一键修复链(依赖过旧,如 bun <1.4.4):依赖升级成功后自动接续
   * 本引擎更新(omp 装进新运行时),双探针重跑由各自 onDone 承担;链标只在
   * 过旧态点击时置位 —— 依赖全新安装不越权替用户装引擎。 */
  const requires = meta.requires ?? null;
  const depOutdated = depOutdatedOf(requires ?? undefined, depProbe);
  /* 依赖计划同样探针感知(双副本遮蔽):命中副本 npm 拥有(如 Windows
   * %APPDATA%\npm 的旧 bun 遮蔽 ~/.bun/bin)→ npm --prefix 就地更新探针
   * 看到的那份,否则声明通道(官方脚本管原生副本);未装保持声明计划。 */
  const effectiveRequires =
    requires && depProbe?.status === "ok" && depProbe.result
      ? { ...requires, plan: resolveInstallPlan(requires, depProbe.result) }
      : requires;
  const fixChainRef = useRef(false);
  const [depInstall, startDepInstall] = useEngineInstall(effectiveRequires, () => {
    if (requires) onDepProbe(requires.binary);
    if (fixChainRef.current) {
      fixChainRef.current = false;
      startInstall();
    }
  });
  const startDepFix = useCallback(() => {
    fixChainRef.current = depOutdated;
    startDepInstall();
  }, [depOutdated, startDepInstall]);
  return (
    <EngineCard
      meta={meta}
      profile={profile}
      probe={probe}
      latest={latest}
      install={install}
      onProbe={onProbe}
      /* 显式包一层:startInstall 现带可选钉版参数,裸传会把 onClick 的
         MouseEvent 当 plan 喂进 cliInstallRun。 */
      onInstall={() => startInstall()}
      onInstallVersion={
        meta.versionMenu
          ? (version) => {
              /* 钉版只走声明通道(command/bun),不经 resolveInstallPlan 的
                 npm 副本分支 —— npm 通道 Rust 侧硬编码 @latest(spec 方案取舍 B)。 */
              const pinned = pinPlanVersion(meta.plan, meta.npmPackage, version);
              if (pinned) startInstall(pinned);
            }
          : undefined
      }
      onDepInstallVersion={
        requires?.versionMenu
          ? (version) => {
              /* 普通依赖钉版只更新依赖本身,不复用过旧修复的 OMP 接续链;
               * 探针命中 npm 副本时钉版也走 npm 就地(pinPrerequisiteVersion)。 */
              fixChainRef.current = false;
              const pinned = pinPrerequisiteVersion(requires, version, depProbe?.result);
              if (pinned) startDepInstall(pinned);
            }
          : undefined
      }
      depProbe={depProbe}
      depInstall={depInstall}
      onDepInstall={startDepFix}
      onDepProbe={() => requires && onDepProbe(requires.binary)}
      creds={creds}
      expanded={expanded}
      onToggleExpand={onToggleExpand}
      cursor={cursor}
      onCursor={onCursor}
      onNewSession={onNewSession}
      homePanel={HomePanel ? <HomePanel /> : undefined}
    />
  );
}
