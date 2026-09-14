/**
 * 远程发行版子面板 —— 发行版行展开:目录浏览(懒加载)+ 引擎探针;引擎/目录
 * 选值上提 RemoteSection,由面板级「SSH 进入」统一消费。
 *
 * 目录起点 ~;逐级进入;选中目录作为会话 --cd 目标。引擎探针 bins 来自
 * cli profile 清单(host.getCliProfiles,内核零引擎知识由命令签名保证)。
 * 探针/目录经同一条 ssh exec 通道命令(wsl_probe_engines / wsl_list_dir),
 * 连接即顺带完成 hostkey TOFU 信任与凭据验证 —— 「SSH 进入」时不再有提示卡竞态。
 */

import { useEffect, useState } from "react";
import type { SshHostConfig, WslDirEntry, WslDistro, WslEngineProbe } from "@kernel/ipc";
import type { CliProfile } from "@kernel/cliProfile";
import { ipc } from "@kernel/ipc";
import { t } from "@kernel/i18n";
import { host } from "@kernel/host";
import { joinWslPath, rememberWslProbes } from "./wslCore";

export function DistroPanel({
  distro,
  host: sshHost,
  pickedEngine,
  onPickEngine,
  dir,
  onPickDir,
}: {
  distro: WslDistro;
  host: SshHostConfig;
  pickedEngine: string | null;
  onPickEngine: (bin: string | null) => void;
  dir: string | null;
  onPickDir: (path: string) => void;
}) {
  const [entries, setEntries] = useState<WslDirEntry[] | null>(null);
  const [dirErr, setDirErr] = useState<string | null>(null);
  const [probes, setProbes] = useState<WslEngineProbe[] | null>(null);
  const [probeErr, setProbeErr] = useState<string | null>(null);

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
        onPickDir(path);
        setEntries(r.filter((e) => e.isDir));
      })
      .catch((e) => setDirErr(e instanceof Error ? e.message : String(e)));
  };

  /* bin → 品牌图标:cli profile 自声明 renderIcon(图标随 profile 走,不另设表)。 */
  const probeIcons: Record<string, NonNullable<CliProfile["renderIcon"]>> = Object.fromEntries(
    host.getCliProfiles().flatMap((p) => (p.renderIcon ? [[p.command, p.renderIcon]] : [])),
  );

  return (
    <div className="wsl-distro-panel">
      <EngineProbeSection
        probes={probes}
        probeErr={probeErr}
        pickedEngine={pickedEngine}
        onPick={onPickEngine}
        icons={probeIcons}
      />
      <DirBrowserSection dir={dir} entries={entries} dirErr={dirErr} onLoadDir={loadDir} />
    </div>
  );
}

/** 引擎探针段:逐 binary 检出行,可点选为「SSH 进入」的引擎。 */
function EngineProbeSection({
  probes,
  probeErr,
  pickedEngine,
  onPick,
  icons,
}: {
  probes: WslEngineProbe[] | null;
  probeErr: string | null;
  pickedEngine: string | null;
  onPick: (bin: string | null) => void;
  icons: Record<string, NonNullable<CliProfile["renderIcon"]>>;
}) {
  return (
    <div className="wsl-panel-sec">
      <span className="wsl-panel-lbl">{t("引擎探针")}</span>
      {probes && (
        <span className="wsl-hint">
          {t("仅计发行版内安装(登录 shell PATH,含 ~/.local/bin);/mnt/*(Windows 互操作)路径不计")}
        </span>
      )}
      <div className="wsl-desc">
        <Hl text={t("【点选】检出的引擎行,「SSH 进入」即以该【CLI】启动;不选则进【交互 shell】。")} />
      </div>
      {probeErr && <div className="wsl-remote-err">{probeErr}</div>}
      <div className="wsl-probe-grid">
        {probes?.map((p) => {
          const icon = icons[p.bin];
          return (
            <button
              key={p.bin}
              type="button"
              className={`wsl-probe-row ${p.path ? "" : "off"} ${pickedEngine === p.bin ? "on" : ""}`}
              disabled={!p.path}
              onClick={() => onPick(pickedEngine === p.bin ? null : p.bin)}
              title={p.path ?? t("未检出")}
              aria-label={t("选中 {bin} 作为会话引擎", { bin: p.bin })}
            >
              {icon ? (
                <span className="wsl-probe-icon" aria-hidden>
                  {icon("0.75rem")}
                </span>
              ) : (
                <span className={`wsl-dot ${p.path ? "ok" : ""}`} aria-hidden />
              )}
              <span className="wsl-probe-bin">{p.bin}</span>
              {p.path ? (
                <>
                  <span className="wsl-probe-path">{p.path}</span>
                  <span className="wsl-probe-tag">{t("可用")}</span>
                </>
              ) : (
                <span className="wsl-probe-path wsl-probe-miss">{t("未检出")}</span>
              )}
            </button>
          );
        })}
      </div>
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
      <div className="wsl-desc">
        <Hl text={t("「SSH 进入」以该目录为【启动目录】(--cd);逐级进入,点选即生效。")} />
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
              className="wsl-dir-row"
              onClick={() => onLoadDir(joinWslPath(dir ?? "~", e.name))}
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

/** 文案高亮:把【关键词】染成强调色,详情描述共用。 */
export function Hl({ text }: { text: string }) {
  const parts = text.split(/【(.*?)】/g);
  return (
    <>
      {parts.map((p, i) => (i % 2 === 1 ? <b key={`${i}:${p}`} className="wsl-hl">{p}</b> : p))}
    </>
  );
}
