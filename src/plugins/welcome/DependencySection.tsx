/**
 * 前置依赖行下区:未就位/过旧引导,以及引导隐藏后的手动钉版日志。
 * 自 EngineCard 拆出,避免主行组件叠加依赖分支复杂度。
 */
import { t } from "@kernel/i18n";
import type { EngineProbeState, InstallState } from "./EngineCard";
import type { PrerequisiteMeta } from "./engineMeta";
import { depOutdatedOf } from "./latestVersion";
import { InstallLog } from "./InstallLog";
import { PrerequisiteGuide } from "./PrerequisiteGuide";

export function DependencySection({
  requires,
  engineName,
  probe,
  install,
  onInstall,
  onProbe,
}: {
  requires?: PrerequisiteMeta;
  engineName: string;
  probe?: EngineProbeState;
  install: InstallState;
  onInstall: () => void;
  onProbe: () => void;
}) {
  if (!requires || !probe) return null;
  const outdated = depOutdatedOf(requires, probe);
  const guideVisible = probe.status !== "ok" || outdated;
  return (
    <>
      {guideVisible && (
        <PrerequisiteGuide
          requires={requires}
          probe={probe}
          install={install}
          outdated={outdated}
          engineName={engineName}
          onInstall={onInstall}
          onProbe={onProbe}
        />
      )}
      {!guideVisible && (install.running || install.lines.length > 0) && (
        <InstallLog install={install} label={t("{name} 安装", { name: requires.name })} />
      )}
    </>
  );
}
