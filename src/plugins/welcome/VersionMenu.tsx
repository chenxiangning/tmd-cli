/**
 * 引擎版本菜单 —— 「版本」按钮弹层(wsmenu 范式:portal + backdrop + Escape +
 * 视口夹取):当前版本行(固定,可收藏)+ 收藏段(不占 top10 名额)+ 最新 10 个
 * 稳定版。点版本行 = 钉版安装(走引擎卡既有流式安装链路);星标切换收藏
 * (settings.engineVersionFavs,跨重启保留)。
 * 数据:版本列表开菜单懒拉(fetchVersionList,5min TTL,失败可重试);
 * 收藏读 settings 实时订阅(useSettingsState)。
 */
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowClockwise, Star } from "@phosphor-icons/react";
import { t } from "@kernel/i18n";
import { useSettingsState } from "@kernel/settings";
import { extractSemver, fetchVersionList } from "./latestVersion";
import { listVersionFavs, toggleVersionFav, versionFavKey } from "./versionFavs";

/** 菜单定位:以点击点为左上,按估算尺寸(260×400)视口内夹取(同 wsmenu 模式)。 */
function clampMenuPosition(x: number, y: number): { x: number; y: number } {
  return {
    x: Math.min(Math.max(8, x), window.innerWidth - 260 - 12),
    y: Math.min(Math.max(8, y), window.innerHeight - 400 - 12),
  };
}

/** 菜单内容(纯展示;拉取/订阅/定位在壳组件,本件拆出供渲染契约测试)。 */
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
  /** 本引擎收藏版本(semver 降序)。 */
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
          <Star size="0.8125rem" weight={faved ? "fill" : "regular"} aria-hidden />
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

/** 弹层壳:portal + 背板点外关闭 + Escape + 版本列表拉取。 */
export function VersionMenu({
  engineId,
  npmPackage,
  currentVersion,
  anchor,
  installing,
  onPick,
  onClose,
}: {
  engineId: string;
  npmPackage: string;
  currentVersion: string | null;
  /** 弹出锚点(点击坐标)。 */
  anchor: { x: number; y: number };
  installing: boolean;
  onPick: (version: string) => void;
  onClose: () => void;
}) {
  const [versions, setVersions] = useState<string[] | null | undefined>(undefined);
  /* 重试计数:失败行点重试 bump,触发重拉。 */
  const [tick, setTick] = useState(0);
  const favs = useSettingsState().settings.engineVersionFavs;

  useEffect(() => {
    let alive = true;
    setVersions(undefined);
    void fetchVersionList(npmPackage).then((v) => {
      if (alive) setVersions(v);
    });
    return () => {
      alive = false;
    };
  }, [npmPackage, tick]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const pos = clampMenuPosition(anchor.x, anchor.y);
  return createPortal(
    <>
      {/* 透明背板:纯点外关闭(左键/右键皆关),role=presentation 豁免静态元素交互规则 */}
      <div
        className="wsmenu-backdrop"
        role="presentation"
        onClick={onClose}
        onContextMenu={(e) => {
          e.preventDefault();
          onClose();
        }}
      />
      <div className="wsmenu welcome-vermenu" style={{ left: pos.x, top: pos.y }}>
        <VersionMenuBody
          engineId={engineId}
          currentVersion={currentVersion}
          versions={versions}
          favVersions={listVersionFavs(favs, engineId)}
          favs={favs}
          installing={installing}
          onPick={(v) => {
            onClose();
            onPick(v);
          }}
          onRetry={() => setTick((n) => n + 1)}
        />
      </div>
    </>,
    document.body,
  );
}


/** 行内「版本」按钮 + 菜单开合壳:锚点态自持,EngineCard 只判开关与取数。 */
export function VersionMenuAction({
  engineId,
  npmPackage,
  currentVersion,
  installing,
  onPick,
}: {
  engineId: string;
  npmPackage: string;
  /** 当前安装版本(已 extractSemver);null = 抠不出。 */
  currentVersion: string | null;
  installing: boolean;
  onPick: (version: string) => void;
}) {
  const [anchor, setAnchor] = useState<{ x: number; y: number } | null>(null);
  return (
    <>
      <button
        type="button"
        className="welcome-ab"
        disabled={installing}
        title={t("安装指定版本(回退/收藏)")}
        onClick={(e) => setAnchor({ x: e.clientX, y: e.clientY })}
      >
        {t("版本")}
      </button>
      {anchor && (
        <VersionMenu
          engineId={engineId}
          npmPackage={npmPackage}
          currentVersion={currentVersion}
          anchor={anchor}
          installing={installing}
          onPick={onPick}
          onClose={() => setAnchor(null)}
        />
      )}
    </>
  );
}

/** EngineCard→RowActions 的版本菜单插座:开关判定 + 取数集中在本件,
 *  EngineCard/RowActions 不增分支(no-high-complexity 降分支纪律)。 */
export function VersionMenuSlot({
  meta,
  probeVersion,
  installing,
  onInstallVersion,
}: {
  meta: { id: string; versionMenu: boolean; npmPackage?: string };
  /** 探针原始版本串(本件内 extractSemver)。 */
  probeVersion: string | null | undefined;
  installing: boolean;
  onInstallVersion?: (version: string) => void;
}) {
  if (!meta.versionMenu || !meta.npmPackage || !onInstallVersion) return null;
  return (
    <VersionMenuAction
      engineId={meta.id}
      npmPackage={meta.npmPackage}
      currentVersion={extractSemver(probeVersion)}
      installing={installing}
      onPick={onInstallVersion}
    />
  );
}