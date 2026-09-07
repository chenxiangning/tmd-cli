/**
 * SshSettingsSection —— 设置页 SSH 分区:主机簿 CRUD + ~/.ssh/config 扫描导入。
 * 凭据明文随 settings.json 落盘(用户裁决,spec 记录风险);
 * 编辑时空凭据字段 = 保留旧值(导入/改密只在填写时覆盖)。
 * 编辑弹窗与导入弹窗拆至 HostModal.tsx / ImportModal.tsx(文件规模铁则)。
 */

import { useState } from "react";
import { Key, Pencil, Plus, Trash, UploadSimple } from "@phosphor-icons/react";
import { ipc, type SshHostConfig } from "@kernel/ipc";
import { getSettingsState, updateSettings } from "@kernel/settings";
import { t } from "@kernel/i18n";
import type { SshImportCandidate } from "../scan";
import { HostModal } from "./HostModal";
import { ImportModal } from "./ImportModal";

export function SshSettingsSection() {
  const hosts = getSettingsState().settings.ssh.hosts;
  const [editing, setEditing] = useState<SshHostConfig | null>(null);
  const [importOpen, setImportOpen] = useState(false);

  const saveHost = (config: SshHostConfig) => {
    const others = hosts.filter((h) => h.id !== config.id);
    updateSettings({ ssh: { hosts: [...others, config] } });
    setEditing(null);
  };

  const removeHost = (config: SshHostConfig) => {
    if (!window.confirm(t("删除主机「{name}」?已开的会话不受影响。", { name: config.name || config.host }))) return;
    updateSettings({ ssh: { hosts: hosts.filter((h) => h.id !== config.id) } });
  };

  const importCandidates = async (candidates: SshImportCandidate[]) => {
    const existing = getSettingsState().settings.ssh.hosts;
    const next = [...existing];
    for (const candidate of candidates) {
      if (candidate.duplicate) continue;
      next.push({
        id: `ssh-${crypto.randomUUID().slice(0, 8)}`,
        name: candidate.name,
        host: candidate.host,
        port: candidate.port,
        username: candidate.username,
        authType: candidate.authType,
        password: "",
        privateKey: candidate.privateKey,
        privateKeyPath: candidate.privateKeyPath,
        privateKeyPassphrase: "",
      });
    }
    updateSettings({ ssh: { hosts: next } });
    setImportOpen(false);
  };

  return (
    <div className="ssh-settings">
      <div className="ssh-settings-toolbar">
        <button
          type="button"
          className="ssh-btn is-primary"
          onClick={() => setEditing(newHost())}
        >
          <Plus size={12} /> {t("添加主机")}
        </button>
        <button type="button" className="ssh-btn" onClick={() => setImportOpen(true)}>
          <UploadSimple size={12} /> {t("从 ~/.ssh/config 导入")}
        </button>
        {hosts.length > 0 && <span className="ssh-settings-count">{t("{n} 台主机", { n: hosts.length })}</span>}
      </div>
      {hosts.length === 0 ? (
        <div className="ssh-settings-empty">
          {t("还没有 SSH 主机。手动添加,或从 ~/.ssh/config 一键导入。")}
        </div>
      ) : (
        <div className="ssh-host-list">
          {hosts.map((host) => (
            <div className="ssh-host-card" key={host.id}>
              <div className="ssh-host-card-main">
                <div className="ssh-host-card-name">{host.name || host.host}</div>
                <div className="ssh-host-card-endpoint">
                  {host.username ? `${host.username}@` : ""}
                  {host.host}
                  {host.port && host.port !== 22 ? `:${host.port}` : ""}
                </div>
              </div>
              <span className="ssh-auth-chip">{authLabel(host)}</span>
              <div className="ssh-host-card-actions">
                <button
                  type="button"
                  className="ssh-icon-btn"
                  title={t("重置主机密钥信任(下次连接重新确认)")}
                  onClick={() => void resetKnownHost(host)}
                >
                  <Key size={13} />
                </button>
                <button type="button" className="ssh-icon-btn" title={t("编辑")} onClick={() => setEditing(host)}>
                  <Pencil size={13} />
                </button>
                <button type="button" className="ssh-icon-btn" title={t("删除")} onClick={() => removeHost(host)}>
                  <Trash size={13} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
      {editing ? (
        <HostModal host={editing} existing={hosts} onSave={saveHost} onClose={() => setEditing(null)} />
      ) : null}
      {importOpen ? (
        <ImportModal onImport={importCandidates} onClose={() => setImportOpen(false)} />
      ) : null}
    </div>
  );
}

function newHost(): SshHostConfig {
  return {
    id: `ssh-${crypto.randomUUID().slice(0, 8)}`,
    name: "",
    host: "",
    port: 22,
    username: "",
    authType: "password",
    password: "",
    privateKey: "",
    privateKeyPath: "",
    privateKeyPassphrase: "",
  };
}

function authLabel(host: SshHostConfig) {
  if (host.authType === "privateKey") return t("私钥");
  if (host.authType === "keyboardInteractive") return t("键盘认证");
  return t("密码");
}

async function resetKnownHost(host: SshHostConfig) {
  try {
    await ipc.sshKnownHostsReset(host.host, host.port || 22);
  } catch {
    /* 无记录 = 幂等成功。 */
  }
}
