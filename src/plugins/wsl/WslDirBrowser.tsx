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

/** 行集推导:目录行优先(showFiles="off" 才保留非目录行);路径形态输入
 *  (/ ~ 起头 = 跳层意图)不参与前缀过滤。控制流出 React 函数体(复杂度闸)。 */
function filterRows(
  entries: WslDirEntry[] | null,
  jump: string,
  showFiles?: "off",
): WslDirEntry[] | null {
  const q = jump.trim().toLowerCase();
  const filtering = q !== "" && !jump.startsWith("/") && !jump.startsWith("~");
  return (
    entries
      ?.filter((e) => e.isDir || showFiles === "off")
      .filter((e) => !filtering || e.name.toLowerCase().startsWith(q)) ?? null
  );
}

/** 路径直达输入框(拆件:双语义控制流不进浏览器主组件体)—— 粘贴绝对路径
 *  (/ 或 ~ 起)回车跳层;普通输入当目录名前缀过滤(逐级翻找的长链路免点);
 *  跳层/换层成功即清空(清空在父 load 成功回调统一落)。 */
function PathJumpInput(props: { value: string; onChange: (v: string) => void; onJump: (path: string) => void }) {
  return (
    <input
      className="wsl-dir-jump"
      value={props.value}
      placeholder={t("粘贴绝对路径回车直达;输入前缀过滤目录")}
      title={t("以 / 或 ~ 开头回车即跳该层;普通输入按目录名前缀过滤")}
      onChange={(e) => props.onChange(e.target.value)}
      onKeyDown={(e) => {
        if (e.key !== "Enter" || e.nativeEvent.isComposing) return;
        const p = props.value.trim();
        if (!p.startsWith("/") && !p.startsWith("~")) return; // 非路径形态 = 纯过滤,不跳
        e.preventDefault();
        props.onJump(p);
      }}
    />
  );
}

export function WslDirBrowser({
  distro,
  host,
  start,
  up = "crumb",
  refresh = false,
  pickLabel,
  onPick,
  onLoaded,
  showFiles,
  emptyHint,
  desc,
}: {
  distro: string;
  /** SSH 远程模式(缺省 = 本机 wsl.exe)。 */
  host?: SshHostConfig | null;
  /** 初始展示层,也是「浏览目录」首拉目标。 */
  start: string;
  /** 上一级入口:crumb 按钮(默认)/ 目录列表置顶 ".." 行 / 无。 */
  up?: "crumb" | "row";
  /** crumb 刷新按钮(DistroPanel 展开态)。 */
  refresh?: boolean;
  /** crumb 右侧「选这一层」按钮文案(WorkspaceDialog),配 onPick。 */
  pickLabel?: string;
  onPick?: (path: string) => void;
  /** 每次成功加载上报当前层(AddWslTab 汇报添加目标 / DistroPanel 上提选值)。 */
  onLoaded?: (dir: string) => void;
  /** "off" = 非目录行禁用展示(WorkspaceDialog);缺省 = 只列目录。 */
  showFiles?: "off";
  /** 空列表 hint 文案(默认「(空目录)」;AddWslTab 因过滤目录传「(无子目录)」)。 */
  emptyHint?: string;
  /** crumb 下附加说明段(DistroPanel)。 */
  desc?: ReactNode;
}) {
  const [dir, setDir] = useState(start);
  const [entries, setEntries] = useState<WslDirEntry[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  /* 路径直达输入框:双语义 —— 粘贴绝对路径(/ 或 ~ 起)回车跳层;普通输入
   * 当目录名前缀过滤(逐级翻找的长链路免点);跳层/换层成功即清空。 */
  const [jump, setJump] = useState("");

  const load = (path: string) => {
    setErr(null);
    setLoading(true);
    void ipc
      .wslListDir(distro, path, host ?? undefined)
      .then((r) => {
        setDir(path);
        setEntries(r);
        setJump("");
        onLoaded?.(path);
      })
      .catch((e) => setErr(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  };

  /* 上一级唯一路径逻辑(crumb 与 ".." 行共用;此前 row 内联 replace 正则是
   * 第二套父路径实现,慢链路上两处行为可能漂移)。 */
  const goUp = () => load(dir === "~" ? "~" : parentWslPath(dir));

  const rows = filterRows(entries, jump, showFiles);
  return (
    <div className="wsl-dir-browser">
      <div className="wsl-dir-crumb">
        {up === "crumb" && (
          <button
            type="button"
            className="wsl-icon-btn"
            title={t("上一级")}
            aria-label={t("上一级")}
            disabled={loading}
            onClick={goUp}
          >
            <ArrowUpIcon size="0.75rem" aria-hidden />
          </button>
        )}
        <code className="wsl-dir-path" title={dir}>
          {dir}
        </code>
        {refresh && (
          <button type="button" className="wsl-icon-btn" title={t("刷新")} aria-label={t("刷新")} disabled={loading} onClick={() => load(dir)}>
            <ArrowClockwiseIcon size="0.75rem" aria-hidden />
          </button>
        )}
        {pickLabel && (
          <button type="button" className="wsl-btn sm" onClick={() => onPick?.(dir)} disabled={dir === "/"}>
            {pickLabel}
          </button>
        )}
      </div>
      {desc}
      <PathJumpInput value={jump} onChange={setJump} onJump={load} />
      {err && <div className="wsl-remote-err">{err}</div>}
      {entries === null && !err && (
        <button type="button" className="wsl-btn sm" disabled={loading} onClick={() => load(start)}>
          <FolderSimpleIcon size="0.75rem" aria-hidden /> {t("浏览目录")}
        </button>
      )}
      {rows !== null && (
        /* 加载中列表降透明+禁连点(SSH 慢链路点目录行数秒无反馈,用户会连点) */
        <div className={"wsl-dir-list" + (loading ? " loading" : "")}>
          {up === "row" && dir !== "~" && (
            <button
              type="button"
              className="wsl-dir-row"
              aria-label={t("上一级")}
              onClick={goUp}
            >
              <ArrowUpIcon size="0.75rem" aria-hidden />
              <span>..</span>
            </button>
          )}
          {rows.map((e) =>
            e.isDir ? (
              <button key={e.name} type="button" className="wsl-dir-row" onClick={() => load(joinWslPath(dir, e.name))}>
                <FolderSimpleIcon size="0.75rem" aria-hidden />
                <span>{e.name}</span>
              </button>
            ) : (
              <span key={e.name} className="wsl-dir-row off">
                <FolderSimpleIcon size="0.75rem" aria-hidden />
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
