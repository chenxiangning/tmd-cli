/**
 * 自建服务器中继部署卡:填 SSH 信息一键部署(连接 → 铸证书 → 上传 →
 * 装 systemd → 健康自检),进度事件(web-relay-deploy)驱动步骤 checklist;
 * 未知主机指纹时给「信任并重试」(TOFU)。成功后 URL/key/证书/部署历史由
 * Rust 落 settings 并经 settings:changed 回填 —— 本卡对 settings 零写入。
 * SSH 凭据(密码/私钥)仅存组件 state、只进本次调用,不落盘;落盘的只有
 * 连接信息(host/port/user/authType/私钥路径),供历史列表点选回填免重填。
 * 历史列表与手动兜底折叠区拆件(RelayDeployHistoryList/ManualDeployDetails)。
 * 状态机纯函数在 selfhostDeployModel.ts(300 行铁则一并拆文件)。
 */

import { useState } from "react";
import { CheckCircle, CircleNotch, CloudArrowUpIcon as CloudArrowUp, Minus, TerminalWindow, XCircle } from "@phosphor-icons/react";
import { onRelayDeployProgress, relayDeploySelfhost, type RelayDeployProgress, type SelfhostDeployReq, type SelfhostDeployResult } from "@kernel/ipc";
import { t } from "@kernel/i18n";
import { isWeb } from "@kernel/transport";
import type { RelayDeployHistoryEntry } from "@kernel/settings";
import { deriveStepStates, SELFHOST_STEPS, type SelfhostStepId, type SelfhostStepState } from "./selfhostDeployModel";
import { RelayDeployHistoryList } from "./RelayDeployHistoryList";
import { ManualDeployDetails } from "./ManualDeployDetails";

const STEP_LABELS: Record<SelfhostStepId, string> = {
  connect: "SSH 连接",
  cert: "签发证书",
  upload: "上传部署",
  systemd: "安装服务",
  health: "健康自检",
};



function StepIcon({ state }: { state: SelfhostStepState }) {
  const cls = "h-[0.875rem] w-[0.875rem] shrink-0";
  if (state === "ok") return <CheckCircle className={`${cls} text-[var(--tmd-success)]`} aria-hidden />;
  if (state === "failed") return <XCircle className={`${cls} text-[var(--tmd-error)]`} aria-hidden />;
  if (state === "running") return <CircleNotch className={`${cls} animate-spin text-[var(--tmd-accent)]`} aria-hidden />;
  return <Minus className={`${cls} text-[var(--tmd-fg-faint)]`} aria-hidden />;
}

export function WebSelfHostCard() {
  const [host, setHost] = useState("");
  const [port, setPort] = useState("22");
  const [user, setUser] = useState("");
  const [auth, setAuth] = useState<SelfhostDeployReq["authType"]>("password");
  const [password, setPassword] = useState("");
  const [privateKey, setPrivateKey] = useState("");
  const [privateKeyPath, setPrivateKeyPath] = useState("");
  const [passphrase, setPassphrase] = useState("");

  const [busy, setBusy] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [events, setEvents] = useState<RelayDeployProgress[]>([]);
  const [result, setResult] = useState<SelfhostDeployResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const runDeploy = async (trustHostKey: boolean) => {
    setBusy(true);
    setError(null);
    setDone(null);
    setResult(null);
    setEvents([]);
    setSubmitted(true);
    let unlisten = () => {};
    try {
      /* 先挂进度监听再 invoke;结束统一退订,避免串台到下次部署。 */
      unlisten = await onRelayDeployProgress((e) =>
        setEvents((prev) => [...prev, e]),
      );
      const req: SelfhostDeployReq = {
        host: host.trim(),
        port: Number(port) || 22,
        username: user.trim(),
        authType: auth,
        ...(auth === "password"
          ? { password }
          : {
              privateKey: privateKey.trim() || undefined,
              privateKeyPath: privateKeyPath.trim() || undefined,
              privateKeyPassphrase: passphrase || undefined,
            }),
        ...(trustHostKey ? { trustHostKey: true } : {}),
      };
      const r = await relayDeploySelfhost(req);
      setResult(r);
      if (r.ok) setDone(t("部署完成:") + r.url + t("(URL/密钥已回填右卡)"));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      unlisten();
      setBusy(false);
    }
  };

  /** 历史点选回填:只回连接信息;密码/私钥内容恒不留存,需重输。 */
  const fillFromHistory = (e: RelayDeployHistoryEntry) => {
    setHost(e.host);
    setPort(String(e.port));
    setUser(e.username);
    setAuth(e.authType);
    setPrivateKeyPath(e.privateKeyPath ?? "");
    setPassword("");
    setPrivateKey("");
    setPassphrase("");
  };

  const stepStates = deriveStepStates(submitted, events, result);
  /* 失败步的可读错误:优先最终 result.steps(Rust 落定含 stderr 尾),回落事件流。 */
  const stepError = (id: SelfhostStepId): string | undefined => {
    if (result) return result.steps.find((s) => s.id === id && !s.ok)?.error;
    for (let i = events.length - 1; i >= 0; i--)
      if (events[i].step === id && !events[i].ok) return events[i].error;
    return undefined;
  };
  const canDeploy = !busy && !isWeb && host.trim() !== "" && user.trim() !== "";
  const inputCls =
    "rounded border border-[var(--tmd-border)] bg-transparent px-2 py-1 text-xs";

  return (
    <div className="flex flex-col gap-2 rounded border border-[var(--tmd-border)] p-3">
      <div className="flex items-center gap-2 text-sm font-medium">
        <TerminalWindow size="1rem" aria-hidden />
        {t("一键部署到自建服务器")}
      </div>
      <div className="text-xs text-[var(--tmd-fg-muted)]">
        {t("桌面经 SSH 自动完成:上传服务、现场签发 TLS 证书、安装 systemd、健康自检。密码和私钥不保存,下次部署从历史点一下回填,重输密码即可。")}
      </div>
      <RelayDeployHistoryList onPick={fillFromHistory} />
      <div className="grid grid-cols-[1fr_5rem] gap-2">
        <input
          type="text"
          className={`${inputCls} min-w-0`}
          placeholder={t("服务器 IP 或域名 *")}
          value={host}
          onChange={(e) => setHost(e.target.value)}
          autoComplete="off"
        />
        <input
          type="text"
          inputMode="numeric"
          className={inputCls}
          placeholder={t("端口")}
          value={port}
          onChange={(e) => setPort(e.target.value.replace(/\D/g, ""))}
          autoComplete="off"
        />
      </div>
      <input
        type="text"
        className={inputCls}
        placeholder={t("用户名 *")}
        value={user}
        onChange={(e) => setUser(e.target.value)}
        autoComplete="off"
      />
      <div className="segmented w-fit" role="radiogroup" aria-label={t("认证方式")}>
        {(["password", "privateKey"] as const).map((id) => (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={auth === id}
            className={`segment${auth === id ? " is-active" : ""}`}
            onClick={() => setAuth(id)}
          >
            {id === "password" ? t("密码") : t("私钥")}
          </button>
        ))}
      </div>
      {auth === "password" ? (
        <input
          type="password"
          className={inputCls}
          placeholder={t("SSH 密码")}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="off"
        />
      ) : (
        <>
          <textarea
            rows={3}
            className={`${inputCls} resize-y font-mono`}
            placeholder={t("私钥内容(粘贴;留空则按下方路径读取)")}
            value={privateKey}
            onChange={(e) => setPrivateKey(e.target.value)}
            spellCheck={false}
          />
          <input
            type="text"
            className={inputCls}
            placeholder={t("私钥路径(内容为空时读取)")}
            value={privateKeyPath}
            onChange={(e) => setPrivateKeyPath(e.target.value)}
            autoComplete="off"
          />
          <input
            type="password"
            className={inputCls}
            placeholder={t("私钥口令")}
            value={passphrase}
            onChange={(e) => setPassphrase(e.target.value)}
            autoComplete="off"
          />
        </>
      )}
      {error && (
        <div className="rounded border border-[var(--tmd-error)]/40 bg-[var(--tmd-error)]/10 px-2.5 py-1.5 text-xs text-[var(--tmd-error)]">
          {error}
        </div>
      )}
      {done && (
        <div className="rounded border border-[var(--tmd-success)]/40 bg-[var(--tmd-success)]/10 px-2.5 py-1.5 text-xs text-[var(--tmd-success)]">
          {done}
        </div>
      )}
      {submitted && (
        <ol className="flex flex-col gap-1 rounded border border-[var(--tmd-border)] bg-[var(--tmd-surface-1)] px-2.5 py-2">
          {SELFHOST_STEPS.map((id) => (
            <li key={id} className="flex flex-col gap-0.5">
              <span className="flex items-center gap-1.5 text-xs">
                <StepIcon state={stepStates[id]} />
                {t(STEP_LABELS[id])}
              </span>
              {stepStates[id] === "failed" && stepError(id) && (
                <span className="ml-5 whitespace-pre-wrap break-all text-xs text-[var(--tmd-error)]">
                  {stepError(id)}
                </span>
              )}
            </li>
          ))}
        </ol>
      )}
      {result?.hostKeyFingerprint && (
        <div className="rounded border border-[var(--tmd-border)] bg-[var(--tmd-bg-sunken)] px-2.5 py-1.5 text-xs">
          <div className="font-mono text-[var(--tmd-fg-muted)]">
            {result.hostKeyFingerprint}
          </div>
          <button
            type="button"
            className="mt-1 rounded border border-[var(--tmd-border)] px-2 py-1 text-xs hover:bg-[var(--tmd-bg-hover)] disabled:opacity-50"
            onClick={() => void runDeploy(true)}
            disabled={busy || isWeb}
          >
            {t("信任并重试")}
          </button>
        </div>
      )}
      <div className="flex gap-2">
        <button
          type="button"
          className="flex items-center gap-1 rounded border border-[var(--tmd-border)] px-2 py-1 text-xs hover:bg-[var(--tmd-bg-hover)] disabled:opacity-50"
          onClick={() => void runDeploy(false)}
          disabled={!canDeploy}
        >
          <CloudArrowUp size="0.75rem" aria-hidden />
          {busy ? t("部署中…") : t("一键部署")}
        </button>
      </div>
      <ManualDeployDetails
        host={host}
        busy={busy}
        onDone={setDone}
        onError={setError}
      />
    </div>
  );
}
