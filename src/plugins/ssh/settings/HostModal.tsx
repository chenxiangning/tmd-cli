/**
 * SSH 主机编辑弹窗 —— 自 SshSettingsSection.tsx 拆出(文件规模铁则)。
 * 新增/编辑共用;主机地址与用户名必填,同 host:port@user 判重;
 * 编辑时空凭据字段 = 保留旧值(导入/改密只在填写时覆盖)。
 */

import { useState } from "react";
import { Eye, EyeClosed, HardDrive } from "@phosphor-icons/react";
import type { SshHostConfig } from "@kernel/ipc";
import { t } from "@kernel/i18n";

export function HostModal({
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
      window.alert(t("主机地址与用户名必填"));
      return;
    }
    if (existing.some((h) => h.id !== draft.id && h.host === hostTrim && (h.port || 22) === (draft.port || 22) && h.username === userTrim)) {
      window.alert(t("相同 host:port@user 的主机已存在"));
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
          <HardDrive size="0.875rem" aria-hidden />
          <span>{isNew ? t("添加 SSH 主机") : t("编辑 SSH 主机")}</span>
        </div>
        <div className="ssh-form">
          <label>
            {t("名称")}
            <input value={draft.name} placeholder={t("可选")} onChange={(e) => set({ name: e.target.value })} />
          </label>
          <label>
            {t("主机地址 *")}
            <input value={draft.host} placeholder="example.com" onChange={(e) => set({ host: e.target.value })} />
          </label>
          <div className="ssh-form-row">
            <label>
              {t("端口")}
              <input
                value={draft.port || ""}
                inputMode="numeric"
                placeholder="22"
                onChange={(e) => set({ port: Number(e.target.value) || 0 })}
              />
            </label>
            <label>
              {t("用户名 *")}
              <input value={draft.username} placeholder="root" onChange={(e) => set({ username: e.target.value })} />
            </label>
          </div>
          <label>
            {t("认证方式")}
            <select value={draft.authType} onChange={(e) => set({ authType: e.target.value })}>
              <option value="password">{t("密码")}</option>
              <option value="privateKey">{t("私钥")}</option>
              <option value="keyboardInteractive">{t("键盘交互(MFA)")}</option>
            </select>
          </label>
          {draft.authType === "password" ? (
            <SecretField
              label={`${t("密码")}${!isNew && draft.password ? t("(留空保留)") : ""}`}
              id="ssh-host-password"
              value={draft.password}
              onChange={(password) => set({ password })}
            />
          ) : null}
          {draft.authType === "privateKey" ? (
            <>
              <label>
                {t("私钥内容")}{!isNew && draft.privateKey ? t("(留空保留)") : ""}
                <textarea
                  rows={4}
                  placeholder="-----BEGIN OPENSSH PRIVATE KEY-----"
                  value={draft.privateKey}
                  onChange={(e) => set({ privateKey: e.target.value })}
                />
              </label>
              <div className="ssh-form-row">
                <label>
                  {t("私钥路径(内容为空时读取)")}
                  <input
                    value={draft.privateKeyPath}
                    placeholder="~/.ssh/id_ed25519"
                    onChange={(e) => set({ privateKeyPath: e.target.value })}
                  />
                </label>
                <SecretField
                  label={t("私钥口令")}
                  id="ssh-host-passphrase"
                  value={draft.privateKeyPassphrase}
                  onChange={(privateKeyPassphrase) => set({ privateKeyPassphrase })}
                />
              </div>
            </>
          ) : null}
          {/* 代理三控件并排,label 只配说明文本,控件各自 aria-label(视觉同 label 版式)。 */}
          <div className="flex flex-col gap-[3px] text-[0.6875rem] text-(--tmd-fg-faint)">
            <span>{t("代理(可选)")}</span>
            <div className="ssh-form-row">
              <select
                aria-label={t("代理类型")}
                value={draft.proxy?.type ?? ""}
                onChange={(e) => setProxyType(set, draft, e.target.value)}
              >
                <option value="">{t("不使用")}</option>
                <option value="http">HTTP</option>
                <option value="socks5">SOCKS5</option>
              </select>
              <input
                aria-label={t("代理地址")}
                value={draft.proxy?.url ?? ""}
                placeholder="127.0.0.1"
                onChange={(e) => setProxyField(set, draft, "url", e.target.value)}
              />
              <input
                aria-label={t("代理端口")}
                value={draft.proxy?.port ?? ""}
                inputMode="numeric"
                placeholder={t("端口")}
                onChange={(e) => setProxyField(set, draft, "port", Number(e.target.value) || 0)}
              />
            </div>
          </div>
        </div>
        <div className="ssh-modal-actions">
          <button type="button" onClick={onClose}>
            {t("取消")}
          </button>
          <button type="button" className="is-primary" onClick={submit}>
            {t("保存")}
          </button>
        </div>
      </div>
    </div>
  );
}

/** 密码/口令输入:默认掩码,眼睛切明文。label 经 htmlFor 只关联输入框一个
 *  原生控件,眼睛钮在 label 外(react-doctor html-label-has-single-control)。 */
function SecretField({
  label,
  id,
  value,
  onChange,
}: {
  label: string;
  id: string;
  value: string;
  onChange: (v: string) => void;
}) {
  const [show, setShow] = useState(false);
  return (
    <div className="ssh-field">
      <label htmlFor={id}>{label}</label>
      <div className="ssh-secret">
        <input
          id={id}
          type={show ? "text" : "password"}
          value={value}
          autoComplete="off"
          onChange={(e) => onChange(e.target.value)}
        />
        <button
          type="button"
          className="ssh-secret-eye"
          aria-label={show ? t("隐藏") : t("显示")}
          title={show ? t("隐藏") : t("显示")}
          onClick={() => setShow(!show)}
        >
          {show ? <Eye size={13} /> : <EyeClosed size={13} />}
        </button>
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
