/**
 * 版本菜单纯渲染体:当前版本 + 收藏 + 最新稳定版。
 * 主引擎与前置依赖共用;拉取、订阅与弹层定位由外层负责。
 */
import { ArrowClockwise, Star } from "@phosphor-icons/react";
import { t } from "@kernel/i18n";
import { toggleVersionFav, versionFavKey } from "./versionFavs";

export function VersionMenuBody({
  engineId,
  currentVersion,
  versions,
  favVersions,
  favs,
  installing,
  onPick,
  onRetry,
}: {
  engineId: string;
  /** 当前安装版本(已 extractSemver);null = 抠不出。 */
  currentVersion: string | null;
  /** 最新 10 个稳定版:undefined = 拉取中,null = 失败。 */
  versions: string[] | null | undefined;
  /** 本引擎/依赖收藏版本(semver 降序)。 */
  favVersions: string[];
  /** 全量收藏 map(判星态用)。 */
  favs: Record<string, { favedAt: number }>;
  installing: boolean;
  onPick: (version: string) => void;
  onRetry: () => void;
}) {
  const renderRow = (version: string, isCurrent: boolean, section: string) => {
    const faved = versionFavKey(engineId, version) in favs;
    return (
      <div className="wsmenu-item-row" key={`${section}-${version}`}>
        <button
          type="button"
          className="wsmenu-item"
          disabled={installing}
          title={t("安装 {name}", { name: version })}
          onClick={() => onPick(version)}
        >
          <span className="wsmenu-item-label">
            {version}
            {isCurrent && <span className="welcome-vermenu-cur">{t("当前")}</span>}
          </span>
        </button>
        <button
          type="button"
          className={`welcome-vermenu-star${faved ? " is-faved" : ""}`}
          aria-label={faved ? t("取消收藏该版本") : t("收藏该版本")}
          title={faved ? t("取消收藏该版本") : t("收藏该版本")}
          onClick={() => toggleVersionFav(engineId, version)}
        >
          <Star size="0.875rem" weight={faved ? "fill" : "regular"} aria-hidden />
        </button>
      </div>
    );
  };
  return (
    <>
      <div className="wsmenu-group-title">{t("当前版本")}</div>
      {currentVersion ? (
        renderRow(currentVersion, true, "cur")
      ) : (
        <div className="wsmenu-note">{t("未能解析当前版本")}</div>
      )}
      {favVersions.length > 0 && (
        <>
          <div className="wsmenu-divider" />
          <div className="wsmenu-group-title">{t("收藏")}</div>
          {favVersions.map((v) => renderRow(v, v === currentVersion, "fav"))}
        </>
      )}
      <div className="wsmenu-divider" />
      <div className="wsmenu-group-title">{t("最新版本")}</div>
      {versions === undefined ? (
        <div className="wsmenu-note">{t("加载版本列表…")}</div>
      ) : versions === null ? (
        <div className="wsmenu-note">
          {t("获取版本列表失败")}
          <button type="button" className="welcome-vermenu-retry" onClick={onRetry}>
            <ArrowClockwise size="0.75rem" aria-hidden />
            {t("重试")}
          </button>
        </div>
      ) : (
        versions.map((v) => renderRow(v, v === currentVersion, "top"))
      )}
    </>
  );
}
