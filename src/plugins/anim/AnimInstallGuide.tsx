/**
 * anim · tmd-anim 未就绪安装引导(两种形态,判定归调用方、本组件纯展示):
 * - card:应用或项目目录缺席时的空态主卡 —— 图标 + 结论句 + Releases 下载钮
 *   + 下载地址直显(URL 要求上页面)+ 建桩开 AI 会话次级动作。
 * - banner:列表已有项目但应用缺席时的顶部横幅(不抢列表主位)。
 */
import { ArrowSquareOut, DownloadSimple, FilmSlate, Info } from "@phosphor-icons/react";
import { openExternalUrl } from "@kernel/ipc";
import { t } from "@kernel/i18n";

/** 下载落点(GitHub Releases;横幅与空态卡共用,页面上直显)。 */
export const ANIM_RELEASES_URL = "https://github.com/chenxiangning/tmd-anim/releases";

export function AnimInstallGuide({
  variant,
  starting,
  onStub,
}: {
  variant: "card" | "banner";
  /** 仅 card 形态:次级动作「先建项目桩,直接开 AI 会话」。 */
  onStub?: () => void;
  starting?: boolean;
}) {
  if (variant === "banner") {
    return (
      <div className="flex items-center gap-2.5 rounded-md border border-(--tmd-border) bg-(--tmd-bg-subtle) px-3 py-2.5">
        <Info size="1rem" className="flex-none text-(--tmd-accent)" />
        <p className="min-w-0 flex-1 text-xs text-(--tmd-fg-muted)">
          {t("未检测到本机安装 tmd-anim —— 安装后这里会自动列出你的动画项目。")}
        </p>
        <button
          type="button"
          onClick={() => void openExternalUrl(ANIM_RELEASES_URL)}
          className="flex flex-none items-center gap-1 rounded bg-(--tmd-accent-soft) px-2 py-1 text-xs text-(--tmd-accent) hover:opacity-80"
        >
          <ArrowSquareOut size="0.75rem" />
          {t("获取 tmd-anim")}
        </button>
      </div>
    );
  }
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2.5 py-10 text-center">
      <div className="flex size-14 items-center justify-center rounded-xl border border-(--tmd-border) bg-(--tmd-bg-subtle)">
        <FilmSlate size={28} className="text-(--tmd-fg-muted)" />
      </div>
      <div className="flex flex-col gap-1">
        <p className="text-sm font-semibold text-(--tmd-fg)">{t("未检测到 tmd-anim")}</p>
        <p className="max-w-md text-xs leading-relaxed text-(--tmd-fg-muted)">
          {t("未找到 tmd-anim 应用或项目目录(~/.tmd-anim/projects)。安装后,这里会自动列出你的动画项目。")}
        </p>
      </div>
      <button
        type="button"
        onClick={() => void openExternalUrl(ANIM_RELEASES_URL)}
        className="mt-1 flex items-center gap-1.5 rounded-md bg-(--tmd-accent-soft) px-3 py-1.5 text-xs font-medium text-(--tmd-accent) hover:opacity-80"
      >
        <DownloadSimple size="0.875rem" />
        {t("前往 Releases 下载")}
      </button>
      <button
        type="button"
        onClick={() => void openExternalUrl(ANIM_RELEASES_URL)}
        className="font-mono text-[0.6875rem] text-(--tmd-fg-muted) underline decoration-(--tmd-border) underline-offset-2 hover:text-(--tmd-accent)"
      >
        {ANIM_RELEASES_URL}
      </button>
      {onStub && (
        <button
          type="button"
          disabled={starting}
          onClick={onStub}
          className="mt-2 text-xs text-(--tmd-fg-muted) hover:text-(--tmd-accent) disabled:opacity-50"
        >
          {t("也可以先建一个项目桩,直接开 AI 会话")}
        </button>
      )}
    </div>
  );
}
