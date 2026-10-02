/**
 * HostModal 纯函数侧车:草稿脏判定 + 提交校验归一(自 HostModal 抽出,
 * 降组件控制流复杂度并守 300 行铁则;错误文案走 t(),宿主组件级安全)。
 */
import { t } from "@kernel/i18n";
import { sshHostIdentityKey } from "@kernel/sshTypes";
import type { SshHostConfig } from "@kernel/ipc";

/** 草稿脏判定:主字段与代理段逐一比对(不依赖键序敏感的 JSON 串)。 */
export function hostDraftDirty(draft: SshHostConfig, host: SshHostConfig): boolean {
  const fields = ["name", "host", "port", "username", "authType", "password", "privateKey", "privateKeyPath", "privateKeyPassphrase"] as const;
  const proxyFields = ["type", "url", "port", "username", "password"] as const;
  return (
    fields.some((f) => draft[f] !== host[f]) ||
    proxyFields.some((f) => (draft.proxy?.[f] ?? null) !== (host.proxy?.[f] ?? null))
  );
}

/** 提交校验与归一:返回 { config } 或 { error }(纯函数,错误文案走 t())。 */
export function submitHostDraft(
  draft: SshHostConfig,
  existing: SshHostConfig[],
): { config: SshHostConfig; error?: undefined } | { config?: undefined; error: string } {
  const hostTrim = draft.host.trim();
  const userTrim = draft.username.trim();
  /* 端口严格校验(与 WSL 面同簿一制):纯数字串 + 1-65535;
   * 此前 Number()||0,非法输入落 0 再回落 22 静默入库。 */
  const portRaw = String(draft.port ?? "");
  let port = draft.port || 22;
  if (portRaw !== "" && !/^\d+$/.test(portRaw.trim())) return { error: t("端口须为 1-65535 的数字") };
  if (portRaw !== "") {
    const n = Number(portRaw.trim());
    if (!Number.isInteger(n) || n < 1 || n > 65535) return { error: t("端口须为 1-65535 的数字") };
    port = n;
  }
  if (!hostTrim || !userTrim) return { error: t("主机地址与用户名必填") };
  /* 代理端口与主端口同簿一制:空值(0)= 不用代理;填了就必须 1-65535,
   * 此前 Number(v)||0 非法输入静默回落 0 入库。 */
  const proxyPort = draft.proxy?.port ?? 0;
  if (proxyPort !== 0 && (!Number.isInteger(proxyPort) || proxyPort < 1 || proxyPort > 65535)) {
    return { error: t("端口须为 1-65535 的数字") };
  }
  if (
    existing.some(
      (h) =>
        h.id !== draft.id &&
        sshHostIdentityKey(h) === sshHostIdentityKey({ host: hostTrim, port, username: userTrim }),
    )
  ) {
    return { error: t("相同 host:port@user 的主机已存在") };
  }
  return {
    config: { ...draft, host: hostTrim, username: userTrim, name: draft.name.trim(), port },
  };
}
