/**
 * 添加 WSL 工作区 tab(添加工作区弹层的来源贡献,经 workspaceOrigins 注册)。
 * 发行版数据源跟随 WSL 卡配置:settings.wsl.remoteHostId 有 → 经 SSH 远程探测
 * (mac 客户端即此路);否则本机 wsl_info(仅 Windows)。目录浏览统一走
 * ipc.wslListDir(本机/远程双模式)。落库:本机 → root = UNC(wslToUnc);
 * 远程 → root = Linux 绝对路径;wsl 元数据 { distro, hostId } 随工作区持久化。
 */

import { useEffect, useState } from "react";
import { ipc, type WslDistro } from "@kernel/ipc";
import { t } from "@kernel/i18n";
import { addWorkspace } from "@kernel/workspace";
import type { WorkspaceOriginAddTabProps } from "@kernel/workspaceOrigins";
import { wslToUnc, wslWorkspaceTargetOk } from "./wslCore";
import { useSettingsState } from "@kernel/settings";
import { WslDirBrowser } from "./WslDirBrowser";

export function AddWslTab({ onAdded }: WorkspaceOriginAddTabProps) {
  const { settings } = useSettingsState();
  const hostId = settings.wsl.remoteHostId;
  const sshHost = hostId ? (settings.ssh.hosts.find((h) => h.id === hostId) ?? null) : null;
  const [distros, setDistros] = useState<WslDistro[] | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [distro, setDistro] = useState("");
  /* 最近成功加载的目录层 = 添加目标(WslDirBrowser 每次成功加载上报)。 */
  const [pickedDir, setPickedDir] = useState<string | null>(null);

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
          setLoadErr(t("本机未检测到 WSL;打开 WSL 面板配置远程主机后在此导入。"));
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

  const add = () => {
    const target = pickedDir?.trim() ?? "";
    /* 本机分支绝对路径闸:曾漏 `~/xxx` 直喂 wslToUnc 拼出 `Ubuntu~` 假发行版
       毒根,新建会话即 WSL_E_DISTRO_NOT_FOUND(2026-09-13 实证)。 */
    if (!distro || !wslWorkspaceTargetOk(target, !!sshHost)) return;
    if (sshHost) addWorkspace(target, { distro, hostId: sshHost.id });
    else addWorkspace(wslToUnc(distro, target), { distro, hostId: null });
    onAdded();
  };

  return (
    <>
      <label className="wsl-field">
        <span>{t("发行版")}</span>
        <select value={distro} onChange={(e) => { setDistro(e.target.value); setPickedDir(null); }}>
          {(distros ?? []).map((d) => (
            <option key={d.name} value={d.name}>
              {d.name}({d.running ? t("运行中") : t("已停止")})
            </option>
          ))}
        </select>
      </label>
      {loadErr && <div className="wsl-remote-err">{loadErr}</div>}
      {distro && (
        /* key=distro:换发行版即重置浏览态(原 setEntries(null) 语义)。 */
        <WslDirBrowser
          key={distro}
          distro={distro}
          host={sshHost}
          start={sshHost ? "~" : "/"}
          onLoaded={setPickedDir}
          emptyHint={t("(无子目录)")}
        />
      )}
      {distro && (
        <div className="wsl-hint">
          {sshHost
            ? t("添加后 root 为远程 Linux 路径;会话经 WSL 卡或侧栏打开(SSH 包装)。")
            : t("添加后以 \\\\wsl.localhost UNC 登记为本机 WSL 工作区。")}
        </div>
      )}
      <div className="wsl-dialog-foot">
        <button type="button" className="wsl-btn primary" disabled={!distro || !pickedDir || !wslWorkspaceTargetOk(pickedDir, !!sshHost)} onClick={add}>
          {t("添加")}
        </button>
      </div>
    </>
  );
}
