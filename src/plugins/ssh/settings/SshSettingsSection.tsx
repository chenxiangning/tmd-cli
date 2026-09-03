/**
 * SshSettingsSection —— 设置页 SSH 分区:主机簿 CRUD + ~/.ssh/config 扫描导入。
 * 凭据明文随 settings.json 落盘(用户裁决,spec 记录风险);
 * 编辑时空凭据字段 = 保留旧值(导入/改密只在填写时覆盖)。
 */

import { useEffect, useState } from "react";
import { KeyRound, Plus, RefreshCw, Server, Trash2, Upload } from "lucide-react";
import { ipc, type SshHostConfig } from "@kernel/ipc";
import { getSettingsState, updateSettings } from "@kernel/settings";
import { scanSshImportCandidates, type SshImportCandidate } from "../scan";

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
    if (!window.confirm(`删除主机「${config.name || config.host}」?已开的会话不受影响。`)) return;
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
          <Plus size={12} /> 添加主机
        </button>
        <button type="button" className="ssh-btn" onClick={() => setImportOpen(true)}>
          <Upload size={12} /> 从 ~/.ssh/config 导入
        </button>
      </div>
      {hosts.length === 0 ? (
        <div className="ssh-settings-empty">
          还没有 SSH 主机。手动添加,或从 ~/.ssh/config 一键导入。
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
                  {host.port && host.port !== 22 ? `:${host.port}` : ""} · {authLabel(host)}
                </div>
              </div>
              <div className="ssh-host-card-actions">
                <button
                  type="button"
                  title="重置主机密钥信任(下次连接重新确认)"
                  onClick={() => void resetKnownHost(host)}
                >
                  <KeyRound size={11} />
                </button>
                <button type="button" title="编辑" onClick={() => setEditing(host)}>
                  <RefreshCw size={11} />
                </button>
                <button type="button" title="删除" onClick={() => removeHost(host)}>
                  <Trash2 size={11} />
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
  if (host.authType === "privateKey") return "私钥";
  if (host.authType === "keyboardInteractive") return "键盘认证";
  return "密码";
}

async function resetKnownHost(host: SshHostConfig) {
  try {
    await ipc.sshKnownHostsReset(host.host, host.port || 22);
  } catch {
    /* 无记录 = 幂等成功。 */
  }
}

function HostModal({
  host,
  existing,
  onSave,
  onClose,
}: {
  host: SshHostConfig;
  existing: SshHostConfig[];
  onSave: (config: SshHostConfig) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<SshHostConfig>(host);
  const isNew = !existing.some((h) => h.id === host.id);
  const set = (patch: Partial<SshHostConfig>) => setDraft((prev) => ({ ...prev, ...patch }));

  const submit = () => {
    const hostTrim = draft.host.trim();
    const userTrim = draft.username.trim();
    if (!hostTrim || !userTrim) {
      window.alert("主机地址与用户名必填");
      return;
    }
    if (existing.some((h) => h.id !== draft.id && h.host === hostTrim && (h.port || 22) === (draft.port || 22) && h.username === userTrim)) {
      window.alert("相同 host:port@user 的主机已存在");
      return;
    }
    onSave({
      ...draft,
      host: hostTrim,
      username: userTrim,
      name: draft.name.trim(),
      port: draft.port || 22,
    });
  };

  return (
    <div className="ssh-modal-backdrop" onClick={onClose}>
      <div className="ssh-modal" onClick={(e) => e.stopPropagation()}>
        <div className="ssh-modal-title">
          <Server size={14} aria-hidden />
          <span>{isNew ? "添加 SSH 主机" : "编辑 SSH 主机"}</span>
        </div>
        <div className="ssh-form">
          <label>
            名称
            <input value={draft.name} placeholder="可选" onChange={(e) => set({ name: e.target.value })} />
          </label>
          <label>
            主机地址 *
            <input value={draft.host} placeholder="example.com" onChange={(e) => set({ host: e.target.value })} />
          </label>
          <div className="ssh-form-row">
            <label>
              端口
              <input
                value={draft.port || ""}
                inputMode="numeric"
                placeholder="22"
                onChange={(e) => set({ port: Number(e.target.value) || 0 })}
              />
            </label>
            <label>
              用户名 *
              <input value={draft.username} placeholder="root" onChange={(e) => set({ username: e.target.value })} />
            </label>
          </div>
          <label>
            认证方式
            <select value={draft.authType} onChange={(e) => set({ authType: e.target.value })}>
              <option value="password">密码</option>
              <option value="privateKey">私钥</option>
              <option value="keyboardInteractive">键盘交互(MFA)</option>
            </select>
          </label>
          {draft.authType === "password" ? (
            <label>
              密码{!isNew && draft.password ? "(留空保留)" : ""}
              <input type="password" value={draft.password} onChange={(e) => set({ password: e.target.value })} />
            </label>
          ) : null}
          {draft.authType === "privateKey" ? (
            <>
              <label>
                私钥内容{!isNew && draft.privateKey ? "(留空保留)" : ""}
                <textarea
                  rows={4}
                  placeholder="-----BEGIN OPENSSH PRIVATE KEY-----"
                  value={draft.privateKey}
                  onChange={(e) => set({ privateKey: e.target.value })}
                />
              </label>
              <div className="ssh-form-row">
                <label>
                  私钥路径(内容为空时读取)
                  <input
                    value={draft.privateKeyPath}
                    placeholder="~/.ssh/id_ed25519"
                    onChange={(e) => set({ privateKeyPath: e.target.value })}
                  />
                </label>
                <label>
                  私钥口令
                  <input
                    type="password"
                    value={draft.privateKeyPassphrase}
                    onChange={(e) => set({ privateKeyPassphrase: e.target.value })}
                  />
                </label>
              </div>
            </>
          ) : null}
          <label>
            代理(可选)
            <div className="ssh-form-row">
              <select value={draft.proxy?.type ?? ""} onChange={(e) => setProxyType(set, draft, e.target.value)}>
                <option value="">不使用</option>
                <option value="http">HTTP</option>
                <option value="socks5">SOCKS5</option>
              </select>
              <input
                value={draft.proxy?.url ?? ""}
                placeholder="127.0.0.1"
                onChange={(e) => setProxyField(set, draft, "url", e.target.value)}
              />
              <input
                value={draft.proxy?.port ?? ""}
                inputMode="numeric"
                placeholder="端口"
                onChange={(e) => setProxyField(set, draft, "port", Number(e.target.value) || 0)}
              />
            </div>
          </label>
        </div>
        <div className="ssh-modal-actions">
          <button type="button" onClick={onClose}>
            取消
          </button>
          <button type="button" className="is-primary" onClick={submit}>
            保存
          </button>
        </div>
      </div>
    </div>
  );
}

function setProxyType(
  set: (patch: Partial<SshHostConfig>) => void,
  draft: SshHostConfig,
  type: string,
) {
  if (!type) {
    set({ proxy: undefined });
    return;
  }
  set({ proxy: { type, url: draft.proxy?.url ?? "", port: draft.proxy?.port ?? 0, username: "", password: "" } });
}

function setProxyField(
  set: (patch: Partial<SshHostConfig>) => void,
  draft: SshHostConfig,
  field: "url" | "port",
  value: string | number,
) {
  if (!draft.proxy) return;
  set({ proxy: { ...draft.proxy, [field]: value } });
}

function ImportModal({
  onImport,
  onClose,
}: {
  onImport: (candidates: SshImportCandidate[]) => void;
  onClose: () => void;
}) {
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [candidates, setCandidates] = useState<SshImportCandidate[]>([]);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    void scanSshImportCandidates(getSettingsState().settings.ssh.hosts)
      .then((result) => {
        if (cancelled) return;
        setCandidates(result.candidates);
        setPicked(new Set(result.candidates.filter((c) => !c.duplicate).map((c) => c.name)));
        setState("ready");
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : String(e));
        setState("error");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const toggle = (name: string) => {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  return (
    <div className="ssh-modal-backdrop" onClick={onClose}>
      <div className="ssh-modal" onClick={(e) => e.stopPropagation()}>
        <div className="ssh-modal-title">
          <Upload size={14} aria-hidden />
          <span>从 ~/.ssh/config 导入</span>
        </div>
        {state === "loading" ? <div className="ssh-settings-empty">扫描中…</div> : null}
        {state === "error" ? <div className="ssh-form-error">{error}</div> : null}
        {state === "ready" ? (
          candidates.length === 0 ? (
            <div className="ssh-settings-empty">~/.ssh/config 里没有可导入的主机段</div>
          ) : (
            <div className="ssh-import-list">
              {candidates.map((candidate) => (
                <label className="ssh-import-row" key={`${candidate.name}:${candidate.host}`}>
                  <input
                    type="checkbox"
                    disabled={candidate.duplicate}
                    checked={picked.has(candidate.name)}
                    onChange={() => toggle(candidate.name)}
                  />
                  <span className="ssh-import-name">{candidate.name}</span>
                  <span className="ssh-import-endpoint">
                    {candidate.host}:{candidate.port} · {candidate.username || "—"}
                  </span>
                  <span className="ssh-import-meta">
                    {candidate.duplicate ? "已存在" : candidate.authType === "privateKey" ? "私钥" : "密码"}
                  </span>
                </label>
              ))}
            </div>
          )
        ) : null}
        <div className="ssh-modal-actions">
          <button type="button" onClick={onClose}>
            取消
          </button>
          <button
            type="button"
            className="is-primary"
            disabled={state !== "ready"}
            onClick={() => onImport(candidates.filter((c) => picked.has(c.name) && !c.duplicate))}
          >
            导入选中
          </button>
        </div>
      </div>
    </div>
  );
}
