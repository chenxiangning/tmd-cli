/**
 * WSL 目录浏览器(单一实现)—— 三处同构收敛:AddWslTab / DistroPanel /
 * WorkspaceDialog。懒加载逐级进入;crumb 与目录行类名沿用拆分前形状
 * (wsl-dir-browser / wsl-dir-crumb / wsl-dir-path / wsl-dir-list / wsl-dir-row)。
 */

import { useState, type ReactNode } from "react";
import { ArrowClockwiseIcon, ArrowUpIcon, FolderSimpleIcon } from "@phosphor-icons/react";
import type { SshHostConfig, WslDirEntry } from "@kernel/ipc";
import { ipc } from "@kernel/ipc";
import { t } from "@kernel/i18n";
import { joinWslPath, parentWslPath } from "./wslCore";

export function WslDirBrowser({
  distro,
  host,
  start,
  up = "crumb",
  refresh = false,
  pickLabel,
  onPick,
  onLoaded,
  showFiles = false,
  emptyHint,
  desc,
}: {
  distro: string;
  /** SSH 远程模式(缺省 = 本机 wsl.exe)。 */
  host?: SshHostConfig | null;
  /** 初始展示层,也是「浏览目录」首拉目标。 */
  start: string;
  /** 上一级入口:crumb 按钮(默认)/ 目录列表置顶 ".." 行 / 无。 */
  up?: "crumb" | "row" | null;
  /** crumb 刷新按钮(DistroPanel 展开态)。 */
  refresh?: boolean;
  /** crumb 右侧「选这一层」按钮文案(WorkspaceDialog),配 onPick。 */
  pickLabel?: string;
  onPick?: (path: string) => void;
  /** 每次成功加载上报当前层(AddWslTab 汇报添加目标 / DistroPanel 上提选值)。 */
  onLoaded?: (dir: string) => void;
  /** false = 只列目录;"off" = 非目录行禁用展示(WorkspaceDialog)。 */
  showFiles?: boolean | "off";
  /** 空列表 hint 文案(默认「(空目录)」;AddWslTab 因过滤目录传「(无子目录)」)。 */
  emptyHint?: string;
  /** crumb 下附加说明段(DistroPanel)。 */
  desc?: ReactNode;
}) {
  const [dir, setDir] = useState(start);
  const [entries, setEntries] = useState<WslDirEntry[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = (path: string) => {
    setErr(null);
    void ipc
      .wslListDir(distro, path, host ?? undefined)
      .then((r) => {
        setDir(path);
        setEntries(r);
        onLoaded?.(path);
      })
      .catch((e) => setErr(e instanceof Error ? e.message : String(e)));
  };

  const rows = entries?.filter((e) => e.isDir || showFiles === "off") ?? null;
  return (
    <div className="wsl-dir-browser">
      <div className="wsl-dir-crumb">
        {up === "crumb" && (
          <button
            type="button"
            className="wsl-icon-btn"
            title={t("上一级")}
            aria-label={t("上一级")}
            onClick={() => load(dir === "~" ? "~" : parentWslPath(dir))}
          >
            <ArrowUpIcon size={12} aria-hidden />
          </button>
        )}
        <code className="wsl-dir-path" title={dir}>
          {dir}
        </code>
        {refresh && (
          <button type="button" className="wsl-icon-btn" title={t("刷新")} aria-label={t("刷新")} onClick={() => load(dir)}>
            <ArrowClockwiseIcon size={12} aria-hidden />
          </button>
        )}
        {pickLabel && (
          <button type="button" className="wsl-btn sm" onClick={() => onPick?.(dir)} disabled={dir === "/"}>
            {pickLabel}
          </button>
        )}
      </div>
      {desc}
      {err && <div className="wsl-remote-err">{err}</div>}
      {entries === null && !err && (
        <button type="button" className="wsl-btn sm" onClick={() => load(start)}>
          <FolderSimpleIcon size="0.75rem" aria-hidden /> {t("浏览目录")}
        </button>
      )}
      {rows !== null && (
        <div className="wsl-dir-list">
          {up === "row" && dir !== "~" && (
            <button
              type="button"
              className="wsl-dir-row"
              aria-label={t("上一级")}
              onClick={() => load(dir.replace(/\/[^/]+$/, "") || "/")}
            >
              <ArrowUpIcon size={11} aria-hidden />
              <span>..</span>
            </button>
          )}
          {rows.map((e) =>
            e.isDir ? (
              <button key={e.name} type="button" className="wsl-dir-row" onClick={() => load(joinWslPath(dir, e.name))}>
                <FolderSimpleIcon size={12} aria-hidden />
                <span>{e.name}</span>
              </button>
            ) : (
              <span key={e.name} className="wsl-dir-row off">
                <FolderSimpleIcon size={12} aria-hidden />
                <span>{e.name}</span>
              </span>
            ),
          )}
          {rows.length === 0 && <span className="wsl-hint">{emptyHint ?? t("(空目录)")}</span>}
        </div>
      )}
    </div>
  );
}
