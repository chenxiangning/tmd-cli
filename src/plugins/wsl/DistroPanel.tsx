/**
 * 远程发行版子面板 —— 发行版行展开:目录浏览(懒加载)+ 引擎探针 + 打开会话。
 *
 * 目录起点 ~;逐级进入;选中目录作为会话 --cd 目标。引擎探针 bins 来自
 * cli profile 清单(host.getCliProfiles,内核零引擎知识由命令签名保证)。
 * 探针/目录经同一条 ssh exec 通道命令(wsl_probe_engines / wsl_list_dir),
 * 连接即顺带完成 hostkey TOFU 信任与凭据验证 —— 「打开会话」时不再有提示卡竞态。
 */

import { useEffect, useState } from "react";
import type { SshHostConfig, WslDirEntry, WslDistro, WslEngineProbe } from "@kernel/ipc";
import { ipc } from "@kernel/ipc";
import { t } from "@kernel/i18n";
import { host } from "@kernel/host";
import { rememberWslProbes, wslRemoteSpawnCommand } from "./wslCore";

function joinPath(base: string, name: string): string {
  if (base === "~") return `~/${name}`;
  return `${base.replace(/\/+$/, "")}/${name}`;
}

export function DistroPanel({ distro, host: sshHost }: { distro: WslDistro; host: SshHostConfig }) {
  const [dir, setDir] = useState<string | null>(null);
  const [entries, setEntries] = useState<WslDirEntry[] | null>(null);
  const [dirErr, setDirErr] = useState<string | null>(null);
  const [probes, setProbes] = useState<WslEngineProbe[] | null>(null);
  const [probeErr, setProbeErr] = useState<string | null>(null);
  const [pickedEngine, setPickedEngine] = useState<string | null>(null);
  const [opening, setOpening] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const bins = host.getCliProfiles().map((p) => p.command);
    void ipc
      .wslProbeEngines(distro.name, bins, sshHost)
      .then((r) => {
        if (cancelled) return;
        setProbes(r);
        const detected: string[] = [];
        for (const probe of r) {
          if (probe.path) detected.push(probe.bin);
        }
        rememberWslProbes(distro.name, detected);
      })
      .catch((e) => {
        if (!cancelled) setProbeErr(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [distro.name, sshHost]);

  const loadDir = (path: string) => {
    setDirErr(null);
    void ipc
      .wslListDir(distro.name, path, sshHost)
      .then((r) => {
        setDir(path);
        setEntries(r.filter((e) => e.isDir));
      })
      .catch((e) => setDirErr(e instanceof Error ? e.message : String(e)));
  };

  const openSession = () => {
    if (opening) return;
    setOpening(true);
    /* 选了引擎:profile id 随会话透传(SessionMeta.engine),composer 按 CLI
       profile 工作;未选引擎 = 交互 shell,无 composer(与本地内置终端同构)。 */
    const engineProfile = pickedEngine
      ? host.getCliProfiles().find((p) => p.command === pickedEngine)?.id
      : undefined;
    void host
      .createSshSession(
        sshHost,
        undefined,
        wslRemoteSpawnCommand(distro.name, { cd: dir ?? undefined, engine: pickedEngine ?? undefined }),
        engineProfile,
      )
      .catch((e) => setProbeErr(e instanceof Error ? e.message : String(e)))
      .finally(() => setOpening(false));
  };

  return (
    <div className="wsl-distro-panel">
      <EngineProbeSection probes={probes} probeErr={probeErr} pickedEngine={pickedEngine} onPick={setPickedEngine} />
      <DirBrowserSection dir={dir} entries={entries} dirErr={dirErr} onLoadDir={loadDir} />
      <button type="button" className="wsl-btn primary" disabled={opening} onClick={openSession}>
        {opening ? t("连接中…") : t("打开会话")}
        {pickedEngine ? ` · ${pickedEngine}` : ""}
        {dir && dir !== "~" ? ` · ${dir}` : ""}
      </button>
    </div>
  );
}

/** 引擎探针段:逐 binary 检出行,可点选为「打开会话」的引擎。 */
function EngineProbeSection({
  probes,
  probeErr,
  pickedEngine,
  onPick,
}: {
  probes: WslEngineProbe[] | null;
  probeErr: string | null;
  pickedEngine: string | null;
  onPick: (bin: string | null) => void;
}) {
  return (
    <div className="wsl-panel-sec">
      <span className="wsl-panel-lbl">{t("引擎探针")}</span>
      {probes && (
        <span className="wsl-hint">
          {t("仅计发行版内安装(登录 shell PATH,含 ~/.local/bin);/mnt/*(Windows 互操作)路径不计")}
        </span>
      )}
      {probeErr && <div className="wsl-remote-err">{probeErr}</div>}
      {probes?.map((p) => (
        <button
          key={p.bin}
          type="button"
          className={`wsl-probe-row ${p.path ? "" : "off"} ${pickedEngine === p.bin ? "on" : ""}`}
          disabled={!p.path}
          onClick={() => onPick(pickedEngine === p.bin ? null : p.bin)}
          title={p.path ?? t("未检出")}
          aria-label={t("选中 {bin} 作为会话引擎", { bin: p.bin })}
        >
          <span className={`wsl-dot ${p.path ? "ok" : ""}`} aria-hidden />
          <span>{p.bin}</span>
          <span className="wsl-probe-path">{p.path ?? t("未检出")}</span>
        </button>
      ))}
    </div>
  );
}

/** 目录浏览段:初始「浏览目录」→ 加载后「刷新」;逐级进入,上一级行置顶。 */
function DirBrowserSection({
  dir,
  entries,
  dirErr,
  onLoadDir,
}: {
  dir: string | null;
  entries: WslDirEntry[] | null;
  dirErr: string | null;
  onLoadDir: (path: string) => void;
}) {
  const up = dir && dir !== "~" ? dir.replace(/\/[^/]+$/, "") || "/" : null;
  return (
    <div className="wsl-panel-sec">
      <span className="wsl-panel-lbl">{t("起始目录")}</span>
      <div className="wsl-dir-crumb">
        <button type="button" className="wsl-btn ghost" onClick={() => onLoadDir(dir ?? "~")}>
          {dir === null ? t("浏览目录") : t("刷新")}
        </button>
        <code>{dir ?? "~"}</code>
      </div>
      {dirErr && <div className="wsl-remote-err">{dirErr}</div>}
      {entries !== null && (
        <div className="wsl-dir-list">
          {up !== null && (
            <button type="button" className="wsl-dir-row" onClick={() => onLoadDir(up)} aria-label={t("上一级")}>
              ..
            </button>
          )}
          {entries.map((e) => (
            <button
              key={e.name}
              type="button"
              className={`wsl-dir-row ${dir === joinPath(dir ?? "~", e.name) ? "on" : ""}`}
              onClick={() => onLoadDir(joinPath(dir ?? "~", e.name))}
            >
              {e.name}
            </button>
          ))}
          {entries.length === 0 && <span className="wsl-hint">{t("(空目录)")}</span>}
        </div>
      )}
    </div>
  );
}
