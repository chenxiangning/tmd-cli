/**
 * 首页窗体标题条 —— 标题 / 键盘与交互提示 / 手动刷新 / GitHub 链接。
 *
 * 首页数据已 SWR 缓存(pageCache),回首页不再自动重拉,此按钮是唯一手动
 * 全量刷新入口:强制重探全部引擎与前置依赖(落 loading 可见),最新版与
 * 凭据额度由父级 refreshTick 重跑 effect 静默续拉。旋转反馈锚定探针态。
 */
import { ArrowClockwise } from "@phosphor-icons/react";
import { openExternalUrl } from "@kernel/ipc";
import { t } from "@kernel/i18n";

const GITHUB_URL = "https://github.com/chenxiangning/tmd-cli";

export function WelcomeTbar({
  refreshing,
  onRefresh,
}: {
  /** 任一可见引擎探针进行中 = 刷新中(按钮禁用 + 图标旋转)。 */
  refreshing: boolean;
  onRefresh: () => void;
}) {
  return (
    <header className="welcome-tbar">
      <span>tmd-cli — {t("引擎选择器")}</span>
      <span className="welcome-hintline">
        {t("↑↓ 选引擎 · ⏎ 以所选工作区启动新会话 · 点击 ● 展开凭据额度")}
      </span>
      <button
        type="button"
        className="welcome-refresh"
        onClick={onRefresh}
        disabled={refreshing}
        aria-label={t("刷新首页数据")}
        title={t("刷新首页数据")}
      >
        <ArrowClockwise
          size="0.75rem"
          aria-hidden
          className={refreshing ? "is-spinning" : ""}
        />
      </button>
      <a
        className="welcome-tbar-right"
        href={GITHUB_URL}
        onClick={(e) => {
          e.preventDefault();
          void openExternalUrl(GITHUB_URL);
        }}
      >
        {t("GitHub 仓库")} · MIT
      </a>
    </header>
  );
}
