/**
 * 前置依赖引导区 —— 引擎卡内嵌的依赖安装引导(profile.requires 的消费端,
 * 如 omp → bun):依赖未装(notFound)→ 引导文案 + 「安装 {name}」按钮
 * (独立安装日志);探针失败 → 重探按钮;探针中 → 状态文案。
 * 依赖就位后本组件由 EngineCard 整体卸载,主引擎安装/更新按钮随之解锁。
 */

import { ArrowSquareOut, ArrowClockwise } from "@phosphor-icons/react";
import { t } from "@kernel/i18n";
import type { EngineProbeState, InstallState } from "./EngineCard";
import { InstallLog } from "./InstallLog";
import type { PrerequisiteMeta } from "./engineMeta";

export function PrerequisiteGuide({
  requires,
  probe,
  install,
  onInstall,
  onProbe,
}: {
  requires: PrerequisiteMeta;
  probe: EngineProbeState;
  install: InstallState;
  onInstall: () => void;
  onProbe: () => void;
}) {
  return (
    <div className="welcome-prereq">
      <div className="welcome-prereq-row">
        <span className="welcome-prereq-text">
          {probe.status === "loading" && t("探针前置依赖 {name}…", { name: requires.name })}
          {probe.status === "notFound" && (
            <>
              {t("依赖 {name} 运行时 —— 先安装 {name},再安装/更新本引擎", {
                name: requires.name,
              })}
              {requires.docsUrl && (
                <a
                  className="welcome-prereq-docs"
                  href={requires.docsUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  {t("{name} 官网", { name: requires.name })}
                  <ArrowSquareOut size={11} aria-hidden />
                </a>
              )}
            </>
          )}
          {probe.status === "error" && t("前置依赖 {name} 探针失败", { name: requires.name })}
        </span>
        <span className="welcome-prereq-actions">
          {probe.status === "notFound" && requires.plan && (
            <button
              type="button"
              className="welcome-install-btn"
              onClick={onInstall}
              disabled={install.running}
              title={requires.installHint}
            >
              {install.running
                ? t("正在安装 {name}…", { name: requires.name })
                : t("安装 {name}", { name: requires.name })}
            </button>
          )}
          {probe.status === "error" && (
            <button
              type="button"
              className="welcome-icon-btn"
              onClick={onProbe}
              disabled={install.running}
              aria-label={t("重新探针前置依赖")}
              title={t("重新探针")}
            >
              <ArrowClockwise size={12} aria-hidden />
            </button>
          )}
        </span>
      </div>
      {(install.running || install.lines.length > 0) && (
        <InstallLog install={install} label={t("{name} 安装", { name: requires.name })} />
      )}
    </div>
  );
}
