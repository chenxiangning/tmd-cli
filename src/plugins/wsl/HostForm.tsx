/**
 * 手动添加主机表单(远程段内联展开)—— 提交即存入 ssh.hosts(复用 SSH 簿,
 * 同 host|port|user 查重,先例 sshHostIdentityKey)并自动选中。
 * 自 RemoteSection 拆出(文件规模铁则)。
 */

import { useState } from "react";
import type { SshHostConfig } from "@kernel/ipc";
import { sshHostIdentityKey } from "@kernel/sshTypes";
import { t } from "@kernel/i18n";
import { updateSettings, useSettingsState } from "@kernel/settings";

export function HostForm({ onSaved }: { onSaved: (id: string) => void }) {
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
    if (settings.ssh.hosts.some((x) => sshHostIdentityKey(x) === sshHostIdentityKey({ host: h, port: portNum, username: u }))) {
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
      <div className="wsl-host-form-foot">
        <button type="button" className="wsl-btn" onClick={submit}>
          {t("保存并选择")}
        </button>
      </div>
    </div>
  );
}
