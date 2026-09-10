/**
 * EngineCard 拆件 —— 终端行内的版本列 / 凭据状态 / 动作簇。
 * (no-high-complexity 降分支:EngineCard.tsx 只留行编排与安装钩子。)
 */
import { ArrowSquareOut, ArrowClockwise } from "@phosphor-icons/react";
import { t } from "@kernel/i18n";
import type { CliInstallPlan } from "@kernel/ipc";
import type { CliProfile } from "@kernel/cli";
import type { EngineCredential } from "./credentials";
import type { EngineProbeState, InstallState } from "./EngineCard";

/* ── 版本列 ─────────────────────────────────────────────── */

export function RowVersion({
  probe,
  latest,
  outdated,
}: {
  probe: EngineProbeState;
  latest: string | null | undefined;
  outdated: boolean;
}) {
  if (probe.status === "loading") {
    return <span className="welcome-row-ver">{t("探针中…")}</span>;
  }
  if (probe.status === "notFound") {
    return <span className="welcome-row-ver missing">{t("未安装")}</span>;
  }
  if (probe.status === "error") {
    return <span className="welcome-row-ver missing">{t("探针失败")}</span>;
  }
  const version = probe.result?.version ?? t("已安装");
  /* 落后且拿到最新版:→ latest 高亮;已最新/查询失败:只显版本(tooltip 补)。 */
  const showNew = outdated && typeof latest === "string";
  return (
    <span
      className="welcome-row-ver"
      title={showNew ? t('最新版本 {version},点"更新"升级', { version: latest }) : undefined}
    >
      {version}
      {showNew && <span className="new"> →{latest}</span>}
    </span>
  );
}

/* ── 凭据状态列(点击展开详情)──────────────────────────── */

export function RowCred({
  creds,
  expanded,
  onToggle,
}: {
  creds: EngineCredential[] | undefined;
  expanded: boolean;
  onToggle: () => void;
}) {
  if (!creds || creds.length === 0) {
    return (
      <span className="welcome-row-cred mut" title={t("无已登录供应商")}>
        —
      </span>
    );
  }
  /* note 是信息性(codex「已登录」也带),不作错误信号;有凭据即 ●。真实 button = 原生键盘语义。 */
  return (
    <button
      type="button"
      className="welcome-row-cred"
      onClick={onToggle}
      title={t("凭据与额度{arrow}", { arrow: expanded ? t("(点击收起)") : t("(点击展开)") })}
    >
      ● auth {creds.length}
    </button>
  );
}

/* ── 安装簇:安装|更新|重装 / 安装中(plan 门控 + 文案映射自成一件)── */

function InstallAction({
  installed,
  notFound,
  outdated,
  install,
  plan,
  depBlocked,
  depName,
  latest,
  onInstall,
}: {
  installed: boolean;
  notFound: boolean;
  outdated: boolean;
  install: InstallState;
  plan: CliInstallPlan | null;
  depBlocked: boolean;
  depName: string;
  latest: string | null | undefined;
  onInstall: () => void;
}) {
  if (install.running) {
    return (
      <button type="button" className="welcome-ab" disabled>
        {t("安装中…")}
      </button>
    );
  }
  if (!plan || !(installed || notFound)) return null;
  /* 按钮文案映射(行为不变):未装→安装;落后→更新;已装不落后→重装(同 onInstall)。 */
  const label = installActionLabel(installed, outdated);
  const title = installActionTitle(installed, outdated, depBlocked, depName, latest);
  return (
    <button
      type="button"
      className={outdated && installed ? "welcome-ab pri" : "welcome-ab"}
      onClick={onInstall}
      disabled={depBlocked || install.running}
      title={title}
    >
      {label}
    </button>
  );
}

/** 未装→安装;落后→更新;已装不落后→重装(同 onInstall)。 */
function installActionLabel(installed: boolean, outdated: boolean): string {
  if (!installed) return t("安装");
  return outdated ? t("更新") : t("重装");
}

function installActionTitle(
  installed: boolean,
  outdated: boolean,
  depBlocked: boolean,
  depName: string,
  latest: string | null | undefined,
): string | undefined {
  if (depBlocked) return t("先安装 {name}", { name: depName });
  if (installed && outdated) return t("更新到 {version}", { version: latest });
  if (installed) return t("重新安装/更新到最新版");
  return undefined;
}

/* ── 动作簇:新会话 / 安装|更新|重装 / 重探 / 文档 ──────── */

export function RowActions({
  probe,
  latest,
  outdated,
  install,
  plan,
  depBlocked,
  depName,
  docsUrl,
  onProbe,
  onInstall,
  onNewSession,
}: {
  probe: EngineProbeState;
  latest: string | null | undefined;
  outdated: boolean;
  install: InstallState;
  plan: CliInstallPlan | null;
  depBlocked: boolean;
  depName: string;
  docsUrl: string | undefined;
  onProbe: () => void;
  onInstall: () => void;
  onNewSession: () => void;
}) {
  const installed = probe.status === "ok";
  return (
    <span className="welcome-row-actions">
      {installed && (
        <button type="button" className="welcome-ab go" onClick={onNewSession} title={t("新会话")}>
          {t("新会话")}
        </button>
      )}
      <InstallAction
        installed={installed}
        notFound={probe.status === "notFound"}
        outdated={outdated}
        install={install}
        plan={plan}
        depBlocked={depBlocked}
        depName={depName}
        latest={latest}
        onInstall={onInstall}
      />
      <button
        type="button"
        className="welcome-ab"
        onClick={onProbe}
        disabled={probe.status === "loading" || install.running}
        aria-label={t("重新探针")}
        title={t("重新探针")}
      >
        <ArrowClockwise
          size="0.6875rem"
          aria-hidden
          className={probe.status === "loading" ? "is-spinning" : ""}
        />
      </button>
      {docsUrl && (
        <a className="welcome-ab doc" href={docsUrl} target="_blank" rel="noreferrer">
          {t("官方文档")}
          <ArrowSquareOut size="0.6875rem" aria-hidden />
        </a>
      )}
    </span>
  );
}

/* ── 行头:图标 + 名称(游标/动作簇由行主体排布)────────── */

export function RowHead({
  profile,
  displayName,
}: {
  profile: CliProfile | undefined;
  displayName: string;
}) {
  return (
    <span className="welcome-row-name">
      <span className="icon" aria-hidden>
        {profile?.renderIcon ? profile.renderIcon(14) : null}
      </span>
      <span className="nm">{t(displayName)}</span>
    </span>
  );
}
