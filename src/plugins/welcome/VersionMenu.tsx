/**
 * 引擎版本菜单 —— 主引擎与可选前置依赖双分区。
 * 弹层壳负责 portal / 背板 / Escape / 视口夹取;每个分区独立拉取版本与订阅收藏。
 */
import { useState } from "react";
import { createPortal } from "react-dom";
import { useEscClose } from "@kernel/DialogShell";
import { t } from "@kernel/i18n";
import { clampToViewport } from "@kernel/menuClamp";
import type { EngineMeta } from "./engineMeta";
import { extractSemver } from "./latestVersion";
import { VersionMenuSection } from "./VersionMenuSection";

export { VersionMenuBody } from "./VersionMenuBody";

/** 菜单定位:以点击点为左上,按估算尺寸(260×400)视口内夹取(kernel clampToViewport)。 */
function clampMenuPosition(x: number, y: number): { x: number; y: number } {
  return clampToViewport(x, y, 260, 400);
}

interface DependencyMenu {
  engineId: string;
  name: string;
  npmPackage: string;
  currentVersion: string | null;
  minVersion?: string;
  onPick: (version: string) => void;
}

interface MenuContentProps {
  engineId: string;
  engineName: string;
  npmPackage: string;
  currentVersion: string | null;
  installing: boolean;
  onPick: (version: string) => void;
  dependency?: DependencyMenu;
}

/** 双分区内容(独立导出供渲染契约测试;数据分区内部各自管理加载态)。 */
export function VersionMenuContent({
  engineId,
  engineName,
  npmPackage,
  currentVersion,
  installing,
  onPick,
  dependency,
}: MenuContentProps) {
  return (
    <>
      {dependency && <div className="wsmenu-group-title">{t(engineName)}</div>}
      <VersionMenuSection
        engineId={engineId}
        npmPackage={npmPackage}
        currentVersion={currentVersion}
        installing={installing}
        onPick={onPick}
      />
      {dependency && (
        <>
          <div className="wsmenu-divider" />
          <div className="wsmenu-group-title">
            {t(dependency.name)}
            {dependency.minVersion &&
              ` · ${t("最低 {version}", { version: dependency.minVersion })}`}
          </div>
          <VersionMenuSection
            engineId={dependency.engineId}
            npmPackage={dependency.npmPackage}
            currentVersion={dependency.currentVersion}
            installing={installing}
            onPick={dependency.onPick}
          />
        </>
      )}
    </>
  );
}

/** 弹层壳:portal + 背板点外关闭 + Escape;点选后先关菜单再启动安装。 */
export function VersionMenu({
  anchor,
  onClose,
  ...content
}: MenuContentProps & {
  anchor: { x: number; y: number };
  onClose: () => void;
}) {
  useEscClose(onClose);
  const pos = clampMenuPosition(anchor.x, anchor.y);
  const pick = (fn: (version: string) => void) => (version: string) => {
    onClose();
    fn(version);
  };
  const dependency = content.dependency
    ? { ...content.dependency, onPick: pick(content.dependency.onPick) }
    : undefined;
  return createPortal(
    <>
      <div
        className="wsmenu-backdrop"
        role="presentation"
        onClick={onClose}
        onContextMenu={(e) => {
          e.preventDefault();
          onClose();
        }}
      />
      <div className="wsmenu welcome-vermenu" data-icon-decor="menu" style={{ left: pos.x, top: pos.y }}>
        <VersionMenuContent
          {...content}
          onPick={pick(content.onPick)}
          dependency={dependency}
        />
      </div>
    </>,
    document.body,
  );
}


/** 行内「版本」按钮 + 菜单开合壳:锚点态自持,EngineCard 只判开关与取数。 */
export function VersionMenuAction({
  engineId,
  engineName,
  npmPackage,
  currentVersion,
  installing,
  onPick,
  dependency,
}: {
  engineId: string;
  engineName: string;
  npmPackage: string;
  currentVersion: string | null;
  installing: boolean;
  onPick: (version: string) => void;
  dependency?: DependencyMenu;
}) {
  const [anchor, setAnchor] = useState<{ x: number; y: number } | null>(null);
  return (
    <>
      <button
        type="button"
        className="welcome-ab sec"
        disabled={installing}
        title={t("安装指定版本(回退/收藏)")}
        onClick={(e) => setAnchor({ x: e.clientX, y: e.clientY })}
      >
        {t("版本")}
      </button>
      {anchor && (
        <VersionMenu
          engineId={engineId}
          engineName={engineName}
          npmPackage={npmPackage}
          currentVersion={currentVersion}
          anchor={anchor}
          installing={installing}
          onPick={onPick}
          dependency={dependency}
          onClose={() => setAnchor(null)}
        />
      )}
    </>
  );
}

/** EngineCard→RowActions 的版本菜单插座:主引擎与依赖取数集中在本件。 */
export function VersionMenuSlot({
  meta,
  probeVersion,
  depProbeVersion,
  installing,
  depInstalling = false,
  onInstallVersion,
  onInstallDepVersion,
}: {
  meta: Pick<EngineMeta, "id" | "displayName" | "versionMenu" | "npmPackage" | "requires">;
  probeVersion: string | null | undefined;
  depProbeVersion?: string | null;
  installing: boolean;
  depInstalling?: boolean;
  onInstallVersion?: (version: string) => void;
  onInstallDepVersion?: (version: string) => void;
}) {
  if (!meta.versionMenu || !meta.npmPackage || !onInstallVersion) return null;
  const req = meta.requires;
  const dependency: DependencyMenu | undefined =
    req?.versionMenu && req.npmPackage && onInstallDepVersion
      ? {
          engineId: req.binary,
          name: req.name,
          npmPackage: req.npmPackage,
          currentVersion: extractSemver(depProbeVersion),
          minVersion: req.minVersion,
          onPick: onInstallDepVersion,
        }
      : undefined;
  return (
    <VersionMenuAction
      engineId={meta.id}
      engineName={meta.displayName}
      npmPackage={meta.npmPackage}
      currentVersion={extractSemver(probeVersion)}
      installing={installing || depInstalling}
      onPick={onInstallVersion}
      dependency={dependency}
    />
  );
}
