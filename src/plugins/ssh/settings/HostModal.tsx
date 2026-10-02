/**
 * SSH 主机编辑弹窗 —— 自 SshSettingsSection.tsx 拆出(文件规模铁则)。
 * 新增/编辑共用;主机地址与用户名必填,同 host:port@user 判重;
 * 编辑时空凭据字段 = 保留旧值(导入/改密只在填写时覆盖)。
 */

import { useState } from "react";
import { Eye, EyeClosed, HardDrive } from "@phosphor-icons/react";
import type { SshHostConfig } from "@kernel/ipc";
import { hostDraftDirty, submitHostDraft } from "./hostModalValidate";
import { t } from "@kernel/i18n";
import { useEscClose } from "@kernel/DialogShell";
import { StyledSelect } from "@kernel/StyledSelect";

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
  const [err, setErr] = useState<string | null>(null);
  const isNew = !existing.some((h) => h.id === host.id);
  const set = (patch: Partial<SshHostConfig>) => setDraft((prev) => ({ ...prev, ...patch }));
  useEscClose(onClose);
  /* 草稿脏检查:点背景不关(防误触丢稿,最小实现=忽略点击),取消钮仍可关。 */
  const dirty = hostDraftDirty(draft, host);

  const submit = () => {
    const out = submitHostDraft(draft, existing);
    if (out.error !== undefined) {
      setErr(out.error);
      return;
    }
    setErr(null);
    onSave(out.config);
  };

  return (
    <div className="ssh-modal-backdrop" role="presentation" onClick={dirty ? undefined : onClose}>
      <dialog
        open
        className="ssh-modal"
        aria-label={isNew ? t("添加 SSH 主机") : t("编辑 SSH 主机")}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="ssh-modal-title">
          <HardDrive size="0.875rem" aria-hidden />
          <span>{isNew ? t("添加 SSH 主机") : t("编辑 SSH 主机")}</span>
        </div>
        {/* form 包裹:Enter 即保存(与 WSL 面同形制);取消钮 type=button 不触发。 */}
        <form
          id="ssh-host-form"
          className="ssh-form"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
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
                onChange={(e) => {
                  /* 输入即清错(字段级反馈的另一半:报错不黏手);只收数字串, */
                  if (err) setErr(null);
                  const v = e.target.value;
                  /* 严格校验收口在 submit,这里挡 "22abc" 类即时污染 */
                  set({ port: v === "" ? 0 : /^\d+$/.test(v) ? Number(v) : draft.port });
                }}
              />
            </label>
            <label>
              {t("用户名 *")}
              <input value={draft.username} placeholder="root" onChange={(e) => set({ username: e.target.value })} />
            </label>
          </div>
          {/* StyledSelect 替原生 select(与 WSL 面同款,OS 弹层与主题脱节);
              label 只配说明文本(span),控件自带 aria-label(视觉同 label 版式)。 */}
          <label>
            <span>{t("认证方式")}</span>
            <StyledSelect
              value={draft.authType}
              ariaLabel={t("认证方式")}
              options={[
                { value: "password", label: t("密码") },
                { value: "privateKey", label: t("私钥") },
                { value: "keyboardInteractive", label: t("键盘交互(MFA)") },
              ]}
              onChange={(authType) => set({ authType })}
            />
          </label>
          <AuthCredentials draft={draft} isNew={isNew} set={set} />
          {/* 代理三控件并排,label 只配说明文本,控件各自 aria-label(视觉同 label 版式)。 */}
          <div className="flex flex-col gap-1 text-xs text-(--tmd-fg-faint)">
            <span>{t("代理(可选)")}</span>
            <div className="ssh-form-row">
              <StyledSelect
                className="w-28 shrink-0"
                ariaLabel={t("代理类型")}
                value={draft.proxy?.type ?? ""}
                options={[
                  { value: "", label: t("不使用") },
                  { value: "http", label: "HTTP" },
                  { value: "socks5", label: "SOCKS5" },
                ]}
                onChange={(type) => setProxyType(set, draft, type)}
              />
              <input
                aria-label={t("代理地址")}
                value={draft.proxy?.url ?? ""}
                placeholder="127.0.0.1"
                onChange={(e) => setProxyField(set, draft, "url", e.target.value)}
              />
              <input
                aria-label={t("代理端口")}
                value={draft.proxy?.port || ""}
                inputMode="numeric"
                placeholder={t("端口")}
                onChange={(e) => {
                  if (err) setErr(null);
                  const v = e.target.value;
                  /* 与主端口同制:只收数字串,"22abc" 类即时污染挡在输入侧,
                     越界值(如 70000)收数字、submit 严格校验红字拦截。 */
                  setProxyField(
                    set,
                    draft,
                    "port",
                    v === "" ? 0 : /^\d+$/.test(v) ? Number(v) : (draft.proxy?.port ?? 0),
                  );
                }}
              />
            </div>
          </div>
        </form>
        {err && <div className="ssh-modal-err" role="alert">{err}</div>}
        <div className="ssh-modal-actions">
          <button type="button" onClick={onClose}>
            {t("取消")}
          </button>
          {/* form= 关联:钮在 form 外(布局位),click 仍触发 ssh-host-form 提交。 */}
          <button type="submit" form="ssh-host-form" className="is-primary">
            {t("保存")}
          </button>
        </div>
      </dialog>
    </div>
  );
}

/** 认证凭据段:按认证方式渲染密码 / 私钥三元组(自主体抽离降复杂度)。 */
function AuthCredentials({
  draft,
  isNew,
  set,
}: {
  draft: SshHostConfig;
  isNew: boolean;
  set: (patch: Partial<SshHostConfig>) => void;
}) {
  if (draft.authType === "password") {
    return (
      <SecretField
        label={`${t("密码")}${!isNew && draft.password ? t("(留空保留)") : ""}`}
        id="ssh-host-password"
        value={draft.password}
        onChange={(password) => set({ password })}
      />
    );
  }
  if (draft.authType === "privateKey") {
    return (
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
    );
  }
  return null;
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
          {show ? <Eye size="0.875rem" aria-hidden /> : <EyeClosed size="0.875rem" aria-hidden />}
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
