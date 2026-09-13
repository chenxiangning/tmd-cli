/**
 * WSL 卡远程连接段 —— 经 SSH 连 Windows 宿主探测发行版 / 打开 WSL 会话。
 *
 * 主机来源两路(大仙需求「展开配置远程 WSL 地址,或复用 ssh 配置」):
 * - 下拉选 settings.ssh.hosts 已存主机(SSH 设置页 CRUD/导入/凭据清洗全现成);
 * - 「手动添加」内联表单(host/port/user/password)→ 存入 ssh.hosts(同 host|port|user
 *   查重,先例 sshHostIdentityKey)→ 自动选中。wsl 域只存选中 id(remoteHostId)。
 *
 * SSH 进入 = host.createSshSession(config, undefined, wslRemoteSpawnCommand(...), engineProfileId);
 * 引擎/目录选值上提至本组件(openDistro 展开面板内点选),发行版行展开 DistroPanel(探针 + 目录)。
 */

import { useState } from "react";
import { CaretDownIcon, CaretRightIcon, PlusIcon } from "@phosphor-icons/react";
import type { SshHostConfig, WslInfo } from "@kernel/ipc";
import { ipc } from "@kernel/ipc";
import { t } from "@kernel/i18n";
import { updateSettings, useSettingsState } from "@kernel/settings";
import { host } from "@kernel/host";
import { wslRemoteSpawnCommand } from "./wslCore";
import { AddWslTab } from "./AddWslTab";
import { DistroPanel, Hl } from "./DistroPanel";

/** 非 Windows 开发机(mac)无 Tauri runtime 时的 UI 预览桩:仅 DEV 生效。 */
const DEV_REMOTE_FALLBACK: WslInfo = {
  available: true,
  wslVersion: "WSL 2.4.13(dev 预览桩)",
  distros: [{ name: "Ubuntu", version: 2, running: true, default: true }],
  linuxHome: null,
  linuxUser: null,
};

function hostLabel(h: { name: string; username: string; host: string }): string {
  return h.name.trim() || `${h.username}@${h.host}`;
}

function identityKey(h: { host: string; port?: number; username: string }): string {
  return `${h.host.trim().toLowerCase()}|${h.port || 22}|${h.username.trim().toLowerCase()}`;
}

/** 手动添加主机表单:提交即存入 ssh.hosts(复用 SSH 簿,查重先到先得)并选中。 */
function HostForm({ onSaved }: { onSaved: (id: string) => void }) {
  const { settings } = useSettingsState();
  const [host_, setHost_] = useState("");
  const [port, setPort] = useState("22");
  const [user, setUser] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState<string | null>(null);

  const submit = () => {
    const h = host_.trim();
    const u = user.trim();
    if (!h || !u) {
      setErr(t("主机地址与用户名必填"));
      return;
    }
    const portNum = Math.min(Math.max(parseInt(port, 10) || 22, 1), 65535);
    if (settings.ssh.hosts.some((x) => identityKey(x) === identityKey({ host: h, port: portNum, username: u }))) {
      setErr(t("该主机已存在(同地址/端口/用户名),请在下拉中选择"));
      return;
    }
    const config: SshHostConfig = {
      id: `ssh-${crypto.randomUUID().slice(0, 8)}`,
      name: `${u}@${h}`,
      host: h,
      port: portNum,
      username: u,
      authType: "password",
      password,
      privateKey: "",
      privateKeyPath: "",
      privateKeyPassphrase: "",
    };
    updateSettings({ ssh: { hosts: [...settings.ssh.hosts, config] } });
    onSaved(config.id);
  };

  return (
    <div className="wsl-host-form">
      <div className="wsl-host-grid">
        <label>
          <span>{t("地址")}</span>
          <input value={host_} onChange={(e) => setHost_(e.target.value)} placeholder="192.168.1.7" spellCheck={false} />
        </label>
        <label>
          <span>{t("端口")}</span>
          <input value={port} onChange={(e) => setPort(e.target.value)} inputMode="numeric" />
        </label>
        <label>
          <span>{t("用户")}</span>
          <input value={user} onChange={(e) => setUser(e.target.value)} spellCheck={false} />
        </label>
        <label>
          <span>{t("密码")}</span>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
      </div>
      {err && <div className="wsl-remote-err">{err}</div>}
      <button type="button" className="wsl-btn" onClick={submit}>
        {t("保存并选择")}
      </button>
    </div>
  );
}

export function WslRemoteSection() {
  const { settings } = useSettingsState();
  const hosts = settings.ssh.hosts;
  const selected = hosts.find((h) => h.id === settings.wsl.remoteHostId) ?? null;
  const [info, setInfo] = useState<WslInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [openDistro, setOpenDistro] = useState<string | null>(null);
  const [opening, setOpening] = useState(false);
  const [addingWs, setAddingWs] = useState(false);
  /* 展开面板的引擎/目录选值(上提自 DistroPanel;「SSH 进入」统一消费)。 */
  const [pickedEngine, setPickedEngine] = useState<string | null>(null);
  const [pickedDir, setPickedDir] = useState<string | null>(null);

  const pickHost = (id: string) => {
    /* updateSettings 按 top-key 整域替换:wsl 域必须带全,否则互踩。 */
    updateSettings({ wsl: { ...settings.wsl, remoteHostId: id } });
    setInfo(null);
    setOpenDistro(null);
    setPickedEngine(null);
    setPickedDir(null);
    setError(null);
  };
  const toggleDistro = (name: string) => {
    const next = openDistro === name ? null : name;
    setOpenDistro(next);
    if (next !== openDistro) {
      setPickedEngine(null);
      setPickedDir(null);
    }
  };
  const probe = async () => {
    if (!selected || loading) return;
    setLoading(true);
    setError(null);
    setOpenDistro(null);
    /* 重连即换面板:清上一次的引擎/目录选值,防陈旧选值套到新发行版。 */
    setPickedEngine(null);
    setPickedDir(null);
    try {
      const r = await ipc.wslRemoteInfo(selected);
      const eff = r?.available ? r : import.meta.env.DEV ? DEV_REMOTE_FALLBACK : null;
      setInfo(eff);
      /* 连接成功即自动展开默认发行版的探针面板(2026-09-14:免二次点击)。 */
      const first = eff ? (eff.distros.find((d) => d.default) ?? eff.distros[0]) : null;
      setOpenDistro(first ? first.name : null);
      if (!r?.available && !import.meta.env.DEV) setError(t("宿主未检测到 WSL 发行版(未安装或 wsl.exe 不在 PATH)。"));
    } catch (e) {
      /* 凭据/hostkey/网络错误在此如实呈现 —— 不留空白幕布。 */
      setInfo(import.meta.env.DEV ? DEV_REMOTE_FALLBACK : null);
      if (import.meta.env.DEV) setOpenDistro(DEV_REMOTE_FALLBACK.distros[0].name);
      if (!import.meta.env.DEV) setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  /* 面板级快捷动作:SSH 进入所选发行版(未展开用默认);引擎/目录取面板选值。 */
  const sshEnter = () => {
    if (!selected || !info?.available || opening) return;
    const open = openDistro ? info.distros.find((d) => d.name === openDistro) : null;
    const d = open ?? (info.distros.find((x) => x.default) ?? info.distros[0]);
    /* 选了引擎:profile id 随会话透传(SessionMeta.engine),composer 按 CLI
       profile 工作;未选引擎 = 交互 shell,无 composer(与本地内置终端同构)。 */
    const engineProfile = pickedEngine
      ? host.getCliProfiles().find((p) => p.command === pickedEngine)?.id
      : undefined;
    setOpening(true);
    void host
      .createSshSession(
        selected,
        undefined,
        wslRemoteSpawnCommand(d.name, { cd: pickedDir ?? undefined, engine: pickedEngine ?? undefined }),
        engineProfile,
      )
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setOpening(false));
  };

  return (
    <div className="wsl-remote">
      <div className="wsl-remote-row">
        <span className="wsl-remote-lbl">{t("远程主机")}</span>
        <select
          className="wsl-remote-select"
          value={selected?.id ?? ""}
          onChange={(e) => pickHost(e.target.value)}
          aria-label={t("远程 WSL 宿主")}
        >
          <option value="">{hosts.length ? t("未选择") : t("(尚无主机,点右侧手动添加)")}</option>
          {hosts.map((h) => (
            <option key={h.id} value={h.id}>
              {hostLabel(h)}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="wsl-btn ghost"
          title={t("手动添加主机")}
          onClick={() => setFormOpen((v) => !v)}
        >
          <PlusIcon size="0.75rem" aria-hidden />
        </button>
        <button type="button" className="wsl-btn" disabled={!selected || loading} onClick={() => void probe()}>
          {loading ? t("连接中…") : t("连接")}
        </button>
      </div>
      <div className="wsl-desc">
        <Hl text={t("点【连接】探测远程【发行版】与已装【引擎】,自动展开发行版面板。")} />
      </div>
      {formOpen && (
        <HostForm
          onSaved={(id) => {
            pickHost(id);
          }}
        />
      )}
      {error && <div className="wsl-remote-err">{error}</div>}
      {info?.available && selected && (
        <>
          <div className="wsl-actions">
            <button type="button" className="wsl-btn primary" disabled={opening} onClick={sshEnter}>
              {opening ? t("连接中…") : t("SSH 进入")}
            </button>
            <button type="button" className="wsl-btn" onClick={() => setAddingWs(true)}>
              {t("添加 WSL 工作区")}
            </button>
          </div>
          <div className="wsl-desc">
            <Hl text={t("【SSH 进入】直进所选发行版终端(未展开用默认),引擎/目录在发行版面板里选;【添加 WSL 工作区】把目录登记进侧栏,会话自动走【SSH】。")} />
          </div>
        </>
      )}
      {info?.available &&
        info.distros.map((d) => (
          <div className="wsl-distro-block" key={d.name}>
            <button
              type="button"
              className="wsl-distro-row wsl-distro-toggle"
              onClick={() => toggleDistro(d.name)}
            >
              {openDistro === d.name ? (
                <CaretDownIcon size="0.625rem" aria-hidden />
              ) : (
                <CaretRightIcon size="0.625rem" aria-hidden />
              )}
              <span className={`wsl-dot ${d.running ? "ok" : ""}`} aria-hidden />
              <span className="wsl-distro-name">{d.name}</span>
              <span className="wsl-distro-ver">WSL {d.version}</span>
              <span className="wsl-distro-state">{d.running ? t("运行中") : t("已停止")}</span>
            </button>
            {openDistro === d.name && selected && (
              <DistroPanel
                distro={d}
                host={selected}
                pickedEngine={pickedEngine}
                onPickEngine={setPickedEngine}
                dir={pickedDir}
                onPickDir={setPickedDir}
              />
            )}
          </div>
        ))}
      {addingWs && selected && (
        <div className="wsl-backdrop" role="presentation" onClick={() => setAddingWs(false)}>
          <dialog open className="wsl-dialog m-0" aria-label={t("添加 WSL 工作区")} onClick={(e) => e.stopPropagation()}>
            <div className="wsl-dialog-head">
              <span>{t("添加 WSL 工作区")}</span>
              <button type="button" className="wsl-dialog-x" onClick={() => setAddingWs(false)} aria-label={t("关闭")}>
                ×
              </button>
            </div>
            <AddWslTab onAdded={() => setAddingWs(false)} />
          </dialog>
        </div>
      )}
    </div>
  );
}
