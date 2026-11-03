/**
 * 单个版本数据源分区:开菜单懒拉、5min TTL、失败重试、收藏订阅。
 * 主引擎与依赖各自实例化,加载/失败状态互不影响。
 */
import { useEffect, useState } from "react";
import { useSettingsState } from "@kernel/settings";
import { fetchVersionList } from "./latestVersion";
import { listVersionFavs } from "./versionFavs";
import { VersionMenuBody } from "./VersionMenuBody";

export function VersionMenuSection({
  engineId,
  npmPackage,
  currentVersion,
  installing,
  onPick,
}: {
  engineId: string;
  npmPackage: string;
  currentVersion: string | null;
  installing: boolean;
  onPick: (version: string) => void;
}) {
  const [versions, setVersions] = useState<string[] | null | undefined>(undefined);
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

  return (
    <VersionMenuBody
      engineId={engineId}
      currentVersion={currentVersion}
      versions={versions}
      favVersions={listVersionFavs(favs, engineId)}
      favs={favs}
      installing={installing}
      onPick={onPick}
      onRetry={() => setTick((n) => n + 1)}
    />
  );
}
