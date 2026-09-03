/**
 * ssh 插件 overlay —— 主机选择器 + 认证提示卡。
 *
 * 两个互不排斥的面:
 * - HostPicker(全屏遮罩):从 settings.ssh.hosts 选主机建会话;
 * - PromptCard(右下堆叠):host key 信任 / KBI / 密码回落应答,
 *   Rust 侧 120s 超时 = 拒绝,这里只做投递通道。
 */

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { KeyRound, LockKeyhole, Server, ShieldAlert, X } from "lucide-react";
import { ipc, type SshHostConfig, type SshPromptEvent } from "@kernel/ipc";
import { getSettingsState } from "@kernel/settings";
import { host } from "@kernel/host";
import { closeHostPicker, useSshState } from "./state";

export function SshOverlay() {
  const { pickerOpen, sessions } = useSshState();
  const prompts = [...sessions.values()].filter((view) => view.prompt !== null);
  return (
    <>
      {pickerOpen ? <HostPicker /> : null}
      {prompts.length > 0 ? (
        <div className="ssh-prompt-stack">
          {prompts.map((view) =>
            view.prompt ? <PromptCard key={view.prompt.promptId} prompt={view.prompt} /> : null,
          )}
        </div>
      ) : null}
    </>
  );
}

function HostPicker() {
  const hosts = getSettingsState().settings.ssh.hosts;
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const connect = async (config: SshHostConfig) => {
    if (busy) return;
    setBusy(config.id);
    setError(null);
    try {
      const workspaceId =
        host.getSessions().find((s) => s.id === host.getActiveSessionId())?.workspaceId ??
        undefined;
      await host.createSshSession(config, workspaceId);
      closeHostPicker();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(null);
    }
  };

  return createPortal(
    <div className="ssh-picker-backdrop" onClick={busy ? undefined : closeHostPicker}>
      <div className="ssh-picker" onClick={(e) => e.stopPropagation()}>
        <div className="ssh-picker-head">
          <Server size={14} aria-hidden />
          <span>SSH 连接</span>
          <button type="button" className="ssh-picker-close" onClick={closeHostPicker}>
            <X size={13} />
          </button>
        </div>
        {hosts.length === 0 ? (
          <div className="ssh-picker-empty">
            还没有配置 SSH 主机。到「设置 → SSH」添加,或从 ~/.ssh/config 一键导入。
          </div>
        ) : (
          <div className="ssh-picker-list">
            {hosts.map((config) => (
              <button
                type="button"
                key={config.id}
                className="ssh-picker-item"
                disabled={busy !== null}
                onClick={() => void connect(config)}
              >
                <span className="ssh-picker-item-name">{config.name || config.host}</span>
                <span className="ssh-picker-item-endpoint">
                  {config.username ? `${config.username}@` : ""}
                  {config.host}
                  {config.port && config.port !== 22 ? `:${config.port}` : ""}
                </span>
                <span className="ssh-picker-item-auth">{authLabel(config)}</span>
              </button>
            ))}
          </div>
        )}
        {error ? <div className="ssh-picker-error">{error}</div> : null}
      </div>
    </div>,
    document.body,
  );
}

function authLabel(config: SshHostConfig) {
  if (config.authType === "privateKey") return "私钥";
  if (config.authType === "keyboardInteractive") return "键盘认证";
  return "密码";
}

function PromptCard({ prompt }: { prompt: SshPromptEvent }) {
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const promptId = prompt.promptId;

  useEffect(() => {
    inputRef.current?.focus();
  }, [promptId]);

  const submit = async (answer?: string) => {
    try {
      await ipc.sshPromptAnswer(promptId, answer, prompt.kind === "hostKey" ? true : undefined);
    } catch {
      /* 提示已过期(超时/会话终止):卡片随状态事件消失。 */
    }
  };

  const dismiss = async () => {
    try {
      await ipc.sshPromptCancel(promptId);
    } catch {
      /* 同上。 */
    }
  };

  if (prompt.kind === "hostKey") {
    return (
      <div className="ssh-prompt-card">
        <div className="ssh-prompt-title">
          <ShieldAlert size={14} aria-hidden />
          <span>{prompt.storedFingerprint ? "主机密钥已变更" : "未知主机"}</span>
        </div>
        <div className="ssh-prompt-body">
          <div className="ssh-prompt-line">
            {prompt.keyType} · {prompt.fingerprint}
          </div>
          {prompt.storedFingerprint ? (
            <div className="ssh-prompt-warn">
              已存指纹 {prompt.storedFingerprint} 与本次不符,可能存在中间人攻击。
              仅在你确知服务器密钥确实更换时信任。
            </div>
          ) : (
            <div className="ssh-prompt-hint">首次连接此主机,核对指纹后信任。</div>
          )}
        </div>
        <div className="ssh-prompt-actions">
          <button type="button" onClick={() => void dismiss()}>
            拒绝
          </button>
          <button type="button" className="is-primary" onClick={() => void submit()}>
            信任并连接
          </button>
        </div>
      </div>
    );
  }

  const isPassword = prompt.kind === "password" || !prompt.echo;
  return (
    <div className="ssh-prompt-card">
      <div className="ssh-prompt-title">
        {isPassword ? <KeyRound size={14} aria-hidden /> : <LockKeyhole size={14} aria-hidden />}
        <span>{isPassword ? "输入密码" : "服务器要求输入"}</span>
      </div>
      <div className="ssh-prompt-body">
        {prompt.instructions ? <div className="ssh-prompt-line">{prompt.instructions}</div> : null}
        <input
          ref={inputRef}
          className="ssh-prompt-input"
          type={isPassword ? "password" : "text"}
          value={value}
          placeholder={prompt.prompt ?? ""}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              void submit(value);
              setValue("");
            }
            if (e.key === "Escape") void dismiss();
          }}
        />
      </div>
      <div className="ssh-prompt-actions">
        <button type="button" onClick={() => void dismiss()}>
          取消
        </button>
        <button
          type="button"
          className="is-primary"
          onClick={() => {
            void submit(value);
            setValue("");
          }}
        >
          确定
        </button>
      </div>
    </div>
  );
}
