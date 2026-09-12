/**
 * 添加 WSL 工作区 tab(添加工作区弹层的来源贡献,经 workspaceOrigins 注册)。
 * 发行版数据源跟随 WSL 卡配置:settings.wsl.remoteHostId 有 → 经 SSH 远程探测
 * (mac 客户端即此路);否则本机 wsl_info(仅 Windows)。目录浏览统一走
 * ipc.wslListDir(本机/远程双模式)。落库:本机 → root = UNC(wslToUnc);
 * 远程 → root = Linux 绝对路径;wsl 元数据 { distro, hostId } 随工作区持久化。
 */

import { useCallback, useEffect, useState } from "react";
import { ipc, type WslDistro, type WslDirEntry } from "@kernel/ipc";
import { t } from "@kernel/i18n";
import { addWorkspace } from "@kernel/workspace";
import type { WorkspaceOriginAddTabProps } from "@kernel/workspaceOrigins";
import { wslToUnc } from "./wslCore";
import { useSettingsState } from "@kernel/settings";

function joinPath(base: string, name: string): string {
  if (base === "~") return `~/${name}`;
  return `${base.replace(/\/+$/, "")}/${name}`;
}

function parentOf(p: string): string {
  if (p === "~" || p === "/") return p;
  const up = p.replace(/\/[^/]+$/, "");
  return up === "" ? "/" : up;
}

export function AddWslTab({ onAdded }: WorkspaceOriginAddTabProps) {
  const { settings } = useSettingsState();
  const hostId = settings.wsl.remoteHostId;
  const sshHost = hostId ? (settings.ssh.hosts.find((h) => h.id === hostId) ?? null) : null;
  const [distros, setDistros] = useState<WslDistro[] | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [distro, setDistro] = useState("");
  const [dir, setDir] = useState("~");
  const [entries, setEntries] = useState<WslDirEntry[] | null>(null);
  const [dirErr, setDirErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = sshHost
      ? ipc.wslRemoteInfo(sshHost)
      : ipc.wslInfo().catch(() => null);
    void load
      .then((r) => {
        if (cancelled) return;
        if (r?.available && r.distros.length) {
          setDistros(r.distros);
          setDistro((r.distros.find((d) => d.default) ?? r.distros[0]).name);
        } else if (!sshHost) {
          setLoadErr(t("本机未检测到 WSL;请在 welcome 页 WSL 卡配置远程主机后在此导入。"));
        } else {
          setLoadErr(t("远程宿主未检测到 WSL 发行版。"));
        }
      })
      .catch((e) => {
        if (!cancelled) setLoadErr(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [sshHost]);

  const loadDir = useCallback(
    (path: string) => {
      if (!distro) return;
      setDirErr(null);
      void ipc
        .wslListDir(distro, path, sshHost ?? undefined)
        .then((r) => {
          setDir(path);
          setEntries(r);
        })
        .catch((e) => setDirErr(e instanceof Error ? e.message : String(e)));
    },
    [distro, sshHost],
  );

  const add = () => {
    const target = dir === "~" ? "" : dir;
    if (!distro || !target) return;
    if (sshHost) addWorkspace(target, { distro, hostId: sshHost.id });
    else addWorkspace(wslToUnc(distro, target), { distro, hostId: null });
    onAdded();
  };

  return (
    <>
      <label className="wsl-field">
        <span>{t("发行版")}</span>
        <select value={distro} onChange={(e) => { setDistro(e.target.value); setEntries(null); }}>
          {(distros ?? []).map((d) => (
            <option key={d.name} value={d.name}>
              {d.name}({d.running ? t("运行中") : t("已停止")})
            </option>
          ))}
        </select>
      </label>
      {loadErr && <div className="wsl-remote-err">{loadErr}</div>}
      {distro && (
        <div className="wsl-dir-browser">
          <div className="wsl-dir-crumb">
            <button type="button" className="wsl-btn ghost" onClick={() => loadDir(dir === "~" ? "~" : parentOf(dir))}>
              {t("上一级")}
            </button>
            <code title={dir}>{dir}</code>
            <button type="button" className="wsl-btn ghost" onClick={() => loadDir(dir)}>
              {t("刷新")}
            </button>
          </div>
          {dirErr && <div className="wsl-remote-err">{dirErr}</div>}
          {entries === null && !dirErr && (
            <button type="button" className="wsl-btn" onClick={() => loadDir("~")}>
              {t("浏览目录")}
            </button>
          )}
          {entries !== null && (
            <div className="wsl-dir-list">
              {(() => {
                const dirs = entries.filter((e) => e.isDir);
                return (
                  <>
                    {dirs.map((e) => (
                      <button key={e.name} type="button" className="wsl-dir-row" onClick={() => loadDir(joinPath(dir, e.name))}>
                        {e.name}/
                      </button>
                    ))}
                    {dirs.length === 0 && <span className="wsl-hint">{t("(无子目录)")}</span>}
                  </>
                );
              })()}
            </div>
          )}
          <div className="wsl-hint">
            {sshHost
              ? t("添加后 root 为远程 Linux 路径;会话经 WSL 卡或侧栏打开(SSH 包装)。")
              : t("添加后以 \\\\wsl.localhost UNC 登记为本机 WSL 工作区。")}
          </div>
        </div>
      )}
      <div className="wsl-dialog-foot">
        <button type="button" className="wsl-btn primary" disabled={!distro || dir === "~" || !entries} onClick={add}>
          {t("添加")}
        </button>
      </div>
    </>
  );
}
