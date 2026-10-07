/**
 * Composer 接力芯片条 —— session-relay 贡献给 composer.attachments 挂点的组件
 * (marks 芯片同款先例)。pending 接力载荷渲染为芯片:引擎 + 字数,点击重开
 * RelayDialog 编辑态(更新摘要/丢弃),✕ 直接丢弃;发送变换消费后自动消失。
 */
import { Lightning, X } from "@phosphor-icons/react";
import { host } from "@kernel/host";
import { t } from "@kernel/i18n";
import { dropPendingRelay, setRelaySource, usePendingRelay } from "./relayStore";

export function RelayComposerChip() {
  const sessionId = host.getActiveSessionId();
  const payload = usePendingRelay(sessionId);
  if (!sessionId || !payload) return null;
  const title = payload.source.title
    ? `${payload.source.engineName} · ${payload.source.title}`
    : payload.source.engineName;
  return (
    <div className="flex flex-wrap items-center gap-1.5 border-b border-(--tmd-border) px-2.5 py-1.5">
      <span className="text-meta text-(--tmd-fg-faint)">{t("接力摘要")}</span>
      <div
        className="inline-flex items-center gap-1 rounded-full border border-(--tmd-accent) py-px pl-1.5 pr-1 text-meta text-(--tmd-fg)"
        title={payload.truncated ? `${title} · ${t("已截断(超摘要预算)")}` : title}
      >
        <button
          type="button"
          className="inline-flex cursor-pointer items-center gap-1"
          onClick={() => setRelaySource({ ...payload.source, editSessionId: sessionId })}
        >
          <Lightning size="0.75rem" className="text-(--tmd-accent)" aria-hidden />
          {t("{engine} · {n} 字", { engine: payload.source.engineName, n: payload.text.length })}
        </button>
        <button
          type="button"
          aria-label={t("丢弃接力摘要")}
          className="inline-flex cursor-pointer items-center text-(--tmd-fg-subtle) hover:text-(--tmd-fg)"
          onClick={() => dropPendingRelay(sessionId)}
        >
          <X size="0.75rem" aria-hidden />
        </button>
      </div>
    </div>
  );
}
