/**
 * 版本弹窗拆件 —— 检查动作行 / 检查结果行 / 自动更新区。
 * (only-export-components 与 no-high-complexity 降分支:VersionPopover 留编排。)
 */
import { ArrowClockwise, DownloadSimple } from "@phosphor-icons/react";
import { t } from "@kernel/i18n";
import { openExternalUrl } from "@kernel/ipc";
import type { ReleaseInfo } from "./updateCheck";
import { parseInlineMarkdown } from "./inlineMarkdown";
import { runAutoUpdate, useAutoUpdate, type AutoUpdateStage } from "./autoUpdate";

/** 条目行内 Markdown 渲染(解析在 ./inlineMarkdown)。key 取 类型+内容+同内容
 *  序号:静态内容下稳定、不重不漏;链接拦默认行为走系统浏览器(webview 内跳转
 *  会带走应用)。 */
export function InlineMarkdown({ text }: { text: string }) {
  const seen = new Map<string, number>();
  return (
    <>
      {parseInlineMarkdown(text).map((seg) => {
        const base = `${seg.type}:${seg.value}${seg.type === "link" ? `:${seg.href}` : ""}`;
        const n = (seen.get(base) ?? 0) + 1;
        seen.set(base, n);
        const key = n === 1 ? base : `${base}#${n}`;
        if (seg.type === "code") return <code key={key}>{seg.value}</code>;
        if (seg.type === "bold") return <strong key={key}>{seg.value}</strong>;
        if (seg.type === "link")
          return (
            <a
              key={key}
              href={seg.href}
              onClick={(e) => {
                e.preventDefault();
                void openExternalUrl(seg.href);
              }}
            >
              {seg.value}
            </a>
          );
        return <span key={key}>{seg.value}</span>;
      })}
    </>
  );
}

export type CheckStatus = "idle" | "checking" | "latest" | "outdated" | "error";

/** 非 error 态的一行提示;outdated 走高亮横幅,error 走红色原因行。 */
const STATUS_TEXT: Record<"idle" | "checking" | "latest", string> = {
  idle: "点击「检查更新」查询 GitHub 最新发布版本。",
  checking: "正在检查更新…",
  latest: "已是最新版本。",
};

/** 检查/下载按钮(atom 通道:发现 + 详情;安装执行在自动更新按钮)。
 *  只出按钮不带行容器,由调用方与自动更新按钮并排进同一个 vp-actions。 */
export function CheckActions({
  checking,
  onCheck,
  onDownload,
}: {
  checking: boolean;
  onCheck: () => void;
  onDownload: () => void;
}) {
  return (
    <>
      <button type="button" className="vp-btn" onClick={onCheck} disabled={checking}>
        <ArrowClockwise size="0.8125rem" className={checking ? "vp-spin" : undefined} />
        {checking ? t("检查中…") : t("检查更新")}
      </button>
      <button type="button" className="vp-btn" onClick={onDownload}>
        <DownloadSimple size="0.8125rem" />
        {t("前往下载")}
      </button>
    </>
  );
}

/** 检查结果区:outdated 高亮横幅 / error 原因行 / 其余一行提示(三态互斥)。 */
export function CheckResultView({
  status,
  release,
  checkError,
}: {
  status: CheckStatus;
  release: ReleaseInfo | null;
  checkError: string | null;
}) {
  if (status === "outdated" && release) {
    return (
      <div className="vp-outdated">
        <div className="vp-outdated-line">
          {t("发现新版本")}
          <span className="vp-outdated-ver">v{release.version}</span>
          {release.publishedAt && (
            <span className="vp-date">{release.publishedAt.slice(0, 10)}</span>
          )}
        </div>
        {release.notes && <div className="vp-notes">{release.notes}</div>}
      </div>
    );
  }
  if (status === "error" && checkError) {
    return <div className="vp-status vp-status-err">{checkError}</div>;
  }
  if (status !== "outdated" && status !== "error") {
    return <div className="vp-status">{t(STATUS_TEXT[status])}</div>;
  }
  return null;
}

/** 自动更新进行中的按钮文案(下载中附百分比,总量未知只显省略号);
 *  非 busy 阶段不会走到(调用点已用 busy 门控),兜底回检查文案。 */
function autoStageLabel(stage: AutoUpdateStage, percent: number | null): string {
  if (stage === "downloading") return percent !== null ? t("下载中 {percent}%", { percent }) : t("下载中…");
  if (stage === "installing") return t("安装中…");
  if (stage === "restarting") return t("即将重启…");
  return t("正在检查更新…");
}

/**
 * 自动更新按钮 —— 一键「检查 + 下载 + 安装 + 重启」(tauri-plugin-updater
 * latest.json 签名通道,codemoss 同款)。按钮态随阶段切换,是弹窗唯一主操作;
 * 进度条与结果行由 AutoUpdateStatus 出,两件共用 useAutoUpdate 快照。
 */
export function AutoUpdateButton() {
  const auto = useAutoUpdate();
  const busy =
    auto.stage === "checking" ||
    auto.stage === "downloading" ||
    auto.stage === "installing" ||
    auto.stage === "restarting";
  return (
    <button
      type="button"
      className="vp-btn vp-btn-primary"
      onClick={runAutoUpdate}
      disabled={busy}
    >
      <DownloadSimple size="0.8125rem" />
      {busy ? autoStageLabel(auto.stage, auto.percent) : t("自动更新")}
    </button>
  );
}

/** 自动更新的过程与结果:下载进度条 / latest 一行提示 / error 红色原因行。 */
export function AutoUpdateStatus() {
  const auto = useAutoUpdate();
  return (
    <>
      {auto.stage === "downloading" && (
        <div
          className="vp-progress"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={auto.percent ?? undefined}
        >
          <div className="vp-progress-fill" style={{ width: `${auto.percent ?? 0}%` }} />
        </div>
      )}
      {auto.stage === "latest" && <div className="vp-status">{t("已是最新版本。")}</div>}
      {auto.stage === "error" && auto.error && (
        <div className="vp-status vp-status-err">{auto.error}</div>
      )}
    </>
  );
}
