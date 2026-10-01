/**
 * 手动添加主机表单(远程段内联展开)—— 提交即存入 ssh.hosts(复用 SSH 簿,
 * 同 host|port|user 查重,先例 sshHostIdentityKey)并自动选中。
 * 自 RemoteSection 拆出(文件规模铁则)。
 * 0.2.7 打磨:端口严格校验(/^\d+$/ 堵 "22abc"/"0x16";前后空白 trim 放行);
 * 字段级标错(红框 + aria-invalid,输入即清);<form> 回车提交 + 取消钮;
 * 密码眼睛明文切换(眼睛方向与 SecretInput/HostModal 先例一致;内联实现,
 * 因 SecretInput 的 cli-cfg-* 样式与 wsl 表单不配)。
 */

import { useState } from "react";
import { Eye, EyeClosed } from "@phosphor-icons/react";
import type { SshHostConfig } from "@kernel/ipc";
import { sshHostIdentityKey } from "@kernel/sshTypes";
import { t } from "@kernel/i18n";
import { updateSettings, useSettingsState } from "@kernel/settings";
import { parsePort } from "./portInput";

export function HostForm({ onSaved, onCancel }: { onSaved: (id: string) => void; onCancel?: () => void }) {
  const { settings } = useSettingsState();
  const [host_, setHost_] = useState("");
  const [port, setPort] = useState("22");
  const [user, setUser] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [fieldErr, setFieldErr] = useState<{ host?: string; port?: string; user?: string }>({});
  const [err, setErr] = useState<string | null>(null);

  const submit = () => {
    const h = host_.trim();
    const u = user.trim();
    const fe: { host?: string; port?: string; user?: string } = {};
    if (!h) fe.host = t("必填");
    if (!u) fe.user = t("必填");
    const portNum = parsePort(port);
    if (portNum === null) fe.port = t("1-65535");
    setFieldErr(fe);
    if (!h || !u || portNum === null) {
      /* banner 归因如实:仅端口非法不冒充「主机地址与用户名必填」 */
      setErr(!h || !u ? t("主机地址与用户名必填") : t("端口须为 1-65535 的数字"));
      return;
    }
    if (settings.ssh.hosts.some((x) => sshHostIdentityKey(x) === sshHostIdentityKey({ host: h, port: portNum, username: u }))) {
      setErr(t("该主机已存在(同地址/端口/用户名),请在下拉中选择"));
      return;
    }
    setErr(null);
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

  /* 字段级标错辅助:aria-invalid + 红框(class 走 wsl-remote.css);输入即清该字段错。 */
  const cls = (bad?: string) => (bad ? " has-err" : "");
  const clearOnType = (k: keyof typeof fieldErr) => () =>
    setFieldErr((f) => (f[k] ? { ...f, [k]: undefined } : f));

  return (
    <form
      className="wsl-host-form"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <div className="wsl-host-grid">
        <label>
          <span>{t("地址")}</span>
          <input
            value={host_}
            onChange={(e) => {
              setHost_(e.target.value);
              clearOnType("host")();
            }}
            aria-invalid={!!fieldErr.host}
            title={fieldErr.host}
            placeholder="192.168.1.7"
            spellCheck={false}
          />
        </label>
        <label>
          <span>{t("端口")}</span>
          <input
            className={cls(fieldErr.port)}
            value={port}
            onChange={(e) => {
              setPort(e.target.value);
              clearOnType("port")();
            }}
            aria-invalid={!!fieldErr.port}
            title={fieldErr.port}
            inputMode="numeric"
          />
        </label>
        <label>
          <span>{t("用户")}</span>
          <input
            value={user}
            onChange={(e) => {
              setUser(e.target.value);
              clearOnType("user")();
            }}
            aria-invalid={!!fieldErr.user}
            title={fieldErr.user}
            spellCheck={false}
          />
        </label>
        {/* 密码字段 = input + 眼睛钮双控件,label 不包裹(html-label-has-single-control),
            文案 span 与控件平级,输入框以 aria-label 关联 */}
        <div className="wsl-host-field">
          <span>{t("密码")}</span>
          <span className="wsl-pw-wrap">
            <input
              type={showPw ? "text" : "password"}
              value={password}
              aria-label={t("密码")}
              autoComplete="new-password"
              onChange={(e) => setPassword(e.target.value)}
            />
            <button
              type="button"
              className="wsl-pw-eye"
              aria-label={showPw ? t("隐藏密码") : t("显示密码")}
              title={showPw ? t("隐藏密码") : t("显示密码")}
              onClick={() => setShowPw((v) => !v)}
            >
              {showPw ? <Eye size={12} aria-hidden /> : <EyeClosed size={12} aria-hidden />}
            </button>
          </span>
        </div>
      </div>
      {err && <div className="wsl-remote-err">{err}</div>}
      <div className="wsl-host-form-foot">
        {onCancel && (
          <button type="button" className="wsl-btn" onClick={onCancel}>
            {t("取消")}
          </button>
        )}
        <button type="submit" className="wsl-btn primary">
          {t("保存并选择")}
        </button>
      </div>
    </form>
  );
}
