/**
 * 前置依赖引导区 —— 引擎卡内嵌的依赖安装引导(profile.requires 的消费端,
 * 如 omp → bun):依赖未装(notFound)→ 引导文案 + 「安装 {name}」按钮
 * (独立安装日志);过旧(minVersion 下限,如 bun 1.4.0 < 1.4.4)→ 版本
 * 说明 + 「一键修复」按钮(依赖 script 通道升级,EngineSection 在 onDone
 * 自动接续本引擎更新);探针失败 → 重探按钮;探针中 → 状态文案。
 * 依赖就位且达标后本组件由 EngineCard 整体卸载,主引擎按钮随之解锁。
 * (文案/按钮/日志拆三件:no-high-complexity 降分支,EngineCardParts 先例。)
 */

import { ArrowSquareOut, ArrowClockwise } from "@phosphor-icons/react";
import { t } from "@kernel/i18n";
import type { EngineProbeState, InstallState } from "./EngineCard";
import { InstallLog } from "./InstallLog";
import type { PrerequisiteMeta } from "./engineMeta";

/** 官网链接(notFound/过旧两个文案分支共用;未声明 docsUrl 不渲染)。 */
function PrereqDocsLink({ requires }: { requires: PrerequisiteMeta }) {
  if (!requires.docsUrl) return null;
  return (
    <a className="welcome-prereq-docs" href={requires.docsUrl} target="_blank" rel="noreferrer">
      {t("{name} 官网", { name: requires.name })}
      <ArrowSquareOut size="0.75rem" aria-hidden />
    </a>
  );
}

/** 文案列:探针中/失败/未装/过旧四分支,ok 且达标不渲染(引导区整体已卸载)。 */
function PrereqText({
  requires,
  probe,
  fixing,
  engineName,
}: {
  requires: PrerequisiteMeta;
  probe: EngineProbeState;
  /** 过旧态(minVersion 下限触发)。 */
  fixing: boolean;
  engineName: string;
}) {
  if (probe.status === "loading") {
    return (
      <span className="welcome-prereq-text">
        {t("探针前置依赖 {name}…", { name: requires.name })}
      </span>
    );
  }
  if (probe.status === "error") {
    return (
      <span className="welcome-prereq-text">
        {t("前置依赖 {name} 探针失败", { name: requires.name })}
      </span>
    );
  }
  if (probe.status === "notFound") {
    return (
      <span className="welcome-prereq-text">
        {t("依赖 {name} 运行时 —— 先安装 {name},再安装/更新本引擎", {
          name: requires.name,
        })}
        <PrereqDocsLink requires={requires} />
      </span>
    );
  }
  if (fixing) {
    return (
      <span className="welcome-prereq-text">
        {t("依赖 {name} {current} 过旧,{engine} 需 ≥{floor}", {
          name: requires.name,
          current: probe.result?.version ?? "",
          engine: engineName,
          floor: requires.minVersion ?? "",
        })}
        <PrereqDocsLink requires={requires} />
      </span>
    );
  }
  return <span className="welcome-prereq-text" />;
}

/** 动作列:未装出「安装 {name}」、过旧出「一键修复」(共用 install 状态)、
 * 探针失败出重探;未声明安装通道(plan=null)只引导不出按钮。 */
function PrereqActions({
  requires,
  probe,
  install,
  fixing,
  engineName,
  onInstall,
  onProbe,
}: {
  requires: PrerequisiteMeta;
  probe: EngineProbeState;
  install: InstallState;
  fixing: boolean;
  engineName: string;
  onInstall: () => void;
  onProbe: () => void;
}) {
  return (
    <span className="welcome-prereq-actions">
      {probe.status === "notFound" && requires.plan && (
        <button
          type="button"
          className="welcome-ab go"
          onClick={onInstall}
          disabled={install.running}
          title={requires.installHint}
        >
          {install.running
            ? t("正在安装 {name}…", { name: requires.name })
            : t("安装 {name}", { name: requires.name })}
        </button>
      )}
      {fixing && requires.plan && (
        <button
          type="button"
          className="welcome-ab go"
          onClick={onInstall}
          disabled={install.running}
          title={t("修复 {name} 并自动更新 {engine}", {
            name: requires.name,
            engine: engineName,
          })}
        >
          {install.running
            ? t("正在修复 {name}…", { name: requires.name })
            : t("一键修复")}
        </button>
      )}
      {probe.status === "error" && (
        <button
          type="button"
          className="welcome-ab"
          onClick={onProbe}
          disabled={install.running}
          aria-label={t("重新探针前置依赖")}
          title={t("重新探针")}
        >
          <ArrowClockwise size="0.75rem" aria-hidden />
        </button>
      )}
    </span>
  );
}

export function PrerequisiteGuide({
  requires,
  probe,
  install,
  outdated,
  engineName,
  onInstall,
  onProbe,
}: {
  requires: PrerequisiteMeta;
  probe: EngineProbeState;
  install: InstallState;
  /** 过旧态(minVersion 下限触发):文案/按钮切换到一键修复分支。 */
  outdated?: boolean;
  /** 宿主引擎展示名(过旧文案「{engine} 需 ≥{floor}」用)。 */
  engineName?: string;
  onInstall: () => void;
  onProbe: () => void;
}) {
  const fixing = outdated === true && probe.status === "ok";
  return (
    <div className="welcome-prereq">
      <div className="welcome-prereq-row">
        <PrereqText
          requires={requires}
          probe={probe}
          fixing={fixing}
          engineName={engineName ?? ""}
        />
        <PrereqActions
          requires={requires}
          probe={probe}
          install={install}
          fixing={fixing}
          engineName={engineName ?? ""}
          onInstall={onInstall}
          onProbe={onProbe}
        />
      </div>
      {(install.running || install.lines.length > 0) && (
        <InstallLog
          install={install}
          label={
            fixing
              ? t("{name} 修复", { name: requires.name })
              : t("{name} 安装", { name: requires.name })
          }
        />
      )}
    </div>
  );
}
