/**
 * EngineCard 拆件 —— 头部状态 pills 与动作按钮簇
 * (no-high-complexity 降分支):EngineCard.tsx 只留卡片编排与安装钩子。
 */
import { ArrowSquareOut, ArrowClockwise, XCircle } from "@phosphor-icons/react";
import { t } from "@kernel/i18n";
import type { CliInstallPlan } from "@kernel/ipc";
import type { CliProfile } from "@kernel/cli";
import type { EngineProbeState, InstallState } from "./EngineCard";

/** 探针状态 pills:探针中/版本/落后→最新/已是最新/未安装/探针失败。 */
export function EngineStatusPills({
  probe,
  latest,
  outdated,
}: {
  probe: EngineProbeState;
  /** 最新版本:undefined=查询中,null=查询失败(不渲染),string=已拿到。 */
  latest: string | null | undefined;
  outdated: boolean;
}) {
  return (
    <span className="welcome-engine-status">
      {probe.status === "loading" && (
        <span className="welcome-pill is-loading">{t("探针中…")}</span>
      )}
      {probe.status === "ok" && (
        <span className="welcome-pill">
          {probe.result?.version ?? t("已安装")}
        </span>
      )}
      {probe.status === "ok" && typeof latest === "string" && outdated && (
        <span
          className="welcome-pill is-outdated"
          title={t('最新版本 {version},点"更新"升级', { version: latest })}
        >
          → {latest}
        </span>
      )}
      {probe.status === "ok" && typeof latest === "string" && !outdated && (
        <span className="welcome-pill is-latest" title={t("最新版本 {version}", { version: latest })}>
          {t("已是最新")}
        </span>
      )}
      {probe.status === "notFound" && (
        <span className="welcome-pill is-missing">{t("未安装")}</span>
      )}
      {probe.status === "error" && (
        <span className="welcome-pill is-error">{t("探针失败")}</span>
      )}
    </span>
  );
}

/** 引擎动作簇:安装(未装)/ 更新(已装)/ 重探(常驻)。 */
export function EngineActions({
  probe,
  latest,
  outdated,
  install,
  plan,
  depBlocked,
  depName,
  onProbe,
  onInstall,
}: {
  probe: EngineProbeState;
  latest: string | null | undefined;
  outdated: boolean;
  install: InstallState;
  plan: CliInstallPlan | null;
  depBlocked: boolean;
  depName: string;
  onProbe: () => void;
  onInstall: () => void;
}) {
  return (
    <span className="welcome-engine-actions">
      {probe.status === "notFound" && !install.running && plan && (
        <button
          type="button"
          className="welcome-install-btn"
          onClick={onInstall}
          disabled={depBlocked}
          title={depBlocked ? t("先安装 {name}", { name: depName }) : undefined}
        >
          {t("安装")}
        </button>
      )}
      {probe.status === "ok" && install.ok !== true && plan && (
        <button
          type="button"
          className={
            outdated ? "welcome-icon-btn has-update" : "welcome-icon-btn"
          }
          onClick={onInstall}
          disabled={install.running || depBlocked}
          title={
            depBlocked
              ? t("先安装 {name}", { name: depName })
              : outdated
                ? t("更新到 {version}", { version: latest })
                : t("重新安装/更新到最新版")
          }
        >
          {t("更新")}
        </button>
      )}
      <button
        type="button"
        className="welcome-icon-btn"
        onClick={onProbe}
        disabled={probe.status === "loading" || install.running}
        aria-label={t("重新探针")}
        title={t("重新探针")}
      >
        <ArrowClockwise
          size="0.75rem"
          aria-hidden
          className={probe.status === "loading" ? "is-spinning" : ""}
        />
      </button>
    </span>
  );
}

/** 引擎头:图标 + 名称 + 官方文档链接 + pills + 动作簇。 */
export function EngineHead({
  profile,
  displayName,
  docsUrl,
  children,
}: {
  profile: CliProfile | undefined;
  displayName: string;
  docsUrl: string | undefined;
  children: React.ReactNode;
}) {
  return (
    <header className="welcome-engine-head">
      <span className="welcome-engine-icon" aria-hidden>
        {profile?.renderIcon ? profile.renderIcon("1.375rem") : <XCircle size="1.375rem" />}
      </span>
      <span className="welcome-engine-name">{t(displayName)}</span>
      {docsUrl && (
        <a className="welcome-engine-docs" href={docsUrl} target="_blank" rel="noreferrer">
          {t("官方文档")}
          <ArrowSquareOut size="0.6875rem" aria-hidden />
        </a>
      )}
      {children}
    </header>
  );
}
