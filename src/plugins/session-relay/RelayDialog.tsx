/**
 * 接力对话框 ── 目标引擎单选 + 摘要预览(可编辑)+ 确认开新会话。
 * 数据:RelaySource(活会话命令构造 / 退出卡快照构造)→ 用户消息经 profile
 * 声明的读取器读磁盘(会话已退出也读得到);
 * 动作:createSession(目标引擎,源落位工作区,缺省激活)→ writeSession(摘要)。
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { PaperPlaneRight } from "@phosphor-icons/react";
import { host } from "@kernel/host";
import { getActiveWorkspace, getWorkspaces } from "@kernel/workspace";
import { t } from "@kernel/i18n";
import { prepareSendPayload } from "@kernel/profileSend";
import { emitPromptSent, readPromptGate } from "@kernel/promptGate";
import { relayTargets, buildRelaySummary, type RelaySource } from "./relay";
import { clearRelaySource, useRelaySource } from "./relayStore";

/* 源经 store 订阅(开框面统一 = setRelaySource):命令(活会话)与
   退出卡(已故会话)共享同一对话框;无源即卸载。 */
export function RelayLayer() {
  const source = useRelaySource();
  if (!source) return null;
  return <RelayDialog source={source} onClose={clearRelaySource} />;
}

function RelayDialog({ source, onClose }: { source: RelaySource; onClose: () => void }) {
  const workspace = getActiveWorkspace();
  const targets = useMemo(
    () => relayTargets(host.getCliProfiles(), source.profileId),
    [source.profileId],
  );
  const [targetId, setTargetId] = useState<string | null>(targets[0]?.id ?? null);
  const [summary, setSummary] = useState("");
  const [summaryReady, setSummaryReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const createdRef = useRef<string | null>(null); /* 重试复用首轮会话 */
  /* 换目标引擎即失效复用(2026-09-28 评审 F4):createdRef 绑定创建时的 targetId,
     复用到新引擎会把摘要写进旧引擎会话(或对死会话永远失败)。同引擎重试不受影响。 */
  useEffect(() => {
    createdRef.current = null;
  }, [targetId]);
  const [error, setError] = useState("");

  /* 摘要一次性组装:读源会话用户消息(全量),取最近 N 条确定性拼接。 */
  useEffect(() => {
    let alive = true;
    const reader = source.cliSessionId
      ? host.getCliProfile(source.profileId)?.readSessionUserMessages
      : undefined;
    const load = reader && source.cliSessionId && source.cliSessionId !== "unknown"
      ? reader(source.cwd ?? workspace?.root ?? "", source.cliSessionId, true)
      : Promise.resolve(null);
    void load
      .then((messages) => {
        if (alive) {
          setSummary(buildRelaySummary(source, messages ?? []));
          setSummaryReady(true);
        }
      })
      .catch(() => {
        if (alive) {
          setSummary(buildRelaySummary(source, []));
          setSummaryReady(true);
        }
      });
    return () => {
      alive = false;
    };
    // source 由打开方构造后不变,workspace 根在浮层生命周期内亦不变
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const relay = async (): Promise<void> => {
    if (!targetId || !workspace || busy || !summaryReady) return;
    setBusy(true);
    setError("");
    try {
      /* 目标落位:退出卡来源带源会话归属(快照),命令来源缺省走激活工作区。 */
      const ws = source.workspaceId
        ? getWorkspaces().find((w) => w.id === source.workspaceId) ?? workspace
        : workspace;
      if (!ws) throw new Error(t("没有可用工作区"));
      /* 重试复用首轮建的会话:每次重试再 createSession 会堆空会话。 */
      const sessionId =
        createdRef.current ?? (await host.createSession(targetId, ws.root, ws.id)).id;
      createdRef.current = sessionId;
      if (summary.trim()) {
        /* 发送契约与 composer 同源:prepareSendPayload 做 trigger 翻译 +
         * bracketedPaste 包装 + CR 提交(裸 \n 不会被 TUI 当 Enter,整串突发
         * 还会触发粘贴启发式吞掉提交回车 —— 直写 = 接力首发不成立)。 */
        const profile = host.getCliProfile(targetId);
        const payload = profile
          ? prepareSendPayload(profile, summary.trim())
          : `${summary.trim()}\r`;
        /* 轮次闸写前现读:接力首发 = 新会话空闲态,应恒广播 —— 不发则 checkpoint
           无锚点(首轮变更并入下一轮/整轮不可见)、tab 首条标题保底缺失
           (2026-09-28 评审 F5,与 composer 三条写路径同契约)。 */
        const gate = readPromptGate(sessionId);
        const ok = await host.writeSession(sessionId, payload);
        if (!ok) {
          /* 目标会话秒退/写入失败:提示词凭空消失比失败更糟,留框让用户重试 */
          setError(t("接力提示词未能送达(目标会话可能已退出),请重试或取消"));
          setBusy(false);
          return;
        }
        emitPromptSent(gate, sessionId, summary.trim());
      }
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  return createPortal(
    <div
      role="presentation"
      className="fixed inset-0 z-[1201] flex items-start justify-center bg-black/45 pt-[12vh]"
      onClick={(e) => e.target === e.currentTarget && onClose()}
      onKeyDown={(e) => {
        if (e.key === "Escape" && !e.nativeEvent.isComposing) onClose();
      }}
    >
      <div className="flex w-[460px] flex-col gap-3 rounded-xl border border-(--tmd-border) bg-(--tmd-bg-panel) p-4 shadow-2xl">
        <div className="text-sm font-medium text-(--tmd-fg)">{t("转到其他引擎接力")}</div>

        <div>
          <div className="mb-1 text-xs text-(--tmd-fg-faint)">{t("目标引擎")}</div>
          <div className="flex flex-wrap gap-1.5">
            {targets.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => setTargetId(p.id)}
                aria-pressed={targetId === p.id}
                className={`rounded-md border px-2 py-1 text-xs ${
                  targetId === p.id
                    ? "border-(--tmd-accent) bg-(--tmd-accent)/10 text-(--tmd-fg)"
                    : "border-(--tmd-border) text-(--tmd-fg-faint) hover:text-(--tmd-fg)"
                }`}
              >
                {p.name}
              </button>
            ))}
          </div>
        </div>

        <div className="flex min-h-0 flex-col">
          <div className="mb-1 text-xs text-(--tmd-fg-faint)">
            {t("接力提示词(可编辑,将作为新会话首条消息发出)")}
          </div>
          <textarea
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
            rows={10}
            className="w-full resize-none rounded-md border border-(--tmd-border) bg-(--tmd-bg-input) p-2 text-xs leading-4 text-(--tmd-fg) outline-none focus:border-(--tmd-accent)"
            aria-label={t("接力提示词")}
          />
        </div>

        {error && <div className="text-xs text-(--tmd-danger, #e5484d)">{error}</div>}

        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-(--tmd-border) px-3 py-1.5 text-xs text-(--tmd-fg-faint) hover:text-(--tmd-fg)"
          >
            {t("取消")}
          </button>
          <button
            type="button"
            disabled={!targetId || busy || !summaryReady}
            onClick={() => void relay()}
            className="flex items-center gap-1.5 rounded-md bg-(--tmd-accent) px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
          >
            <PaperPlaneRight size="0.75rem" aria-hidden />
            {busy ? t("开新会话中…") : summaryReady ? t("开新会话并发送") : t("摘要生成中…")}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
