/**
 * 接力对话框 ── 目标引擎单选 + 摘要预览(可编辑,超限截断明示)→ 挂芯片。
 * 数据:RelaySource(活会话命令构造 / 退出卡快照构造 / 芯片点击编辑态)→
 * 用户消息经 profile 声明的读取器读磁盘(会话已退出也读得到);
 * 动作:createSession(目标引擎,源落位工作区)→ setPendingRelay 挂 composer
 * 芯片(不直写 PTY;用户检查后随回车一起发出,见 relayCarry 变换)。
 * 编辑态(editSessionId):预填已挂芯片的摘要,「更新摘要/丢弃」,不建新会话。
 * 弹层焦点圈闭(dialog 语义:打开入首控件、Tab 循环、关闭还原焦点)。
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { PaperPlaneRight } from "@phosphor-icons/react";
import { host } from "@kernel/host";
import { getActiveWorkspace, getWorkspaces } from "@kernel/workspace";
import { t } from "@kernel/i18n";
import { relayTargets, buildRelaySummary, type RelaySource } from "./relay";
import { useFocusTrap } from "@kernel/useFocusTrap";
import {
  clearRelaySource,
  dropPendingRelay,
  getPendingRelay,
  setPendingRelay,
  useRelaySource,
} from "./relayStore";

/* 弹层焦点圈闭(同款见 SendConfirmDialog/SearchOverlay/WorktreeManageDialog/
   academy wizard;候选统一收口进 kernel/DialogShell):打开焦点入首控件、
   Tab 循环、关闭还原焦点。 */

/* 源经 store 订阅(开框面统一 = setRelaySource):命令(活会话)与
   退出卡(已故会话)共享同一对话框;无源即卸载。 */
export function RelayLayer() {
  const source = useRelaySource();
  if (!source) return null;
  return <RelayDialog source={source} onClose={clearRelaySource} />;
}

/* 常态动作(模块级,降组件复杂度):目标落位 → createSession → 摘要挂芯片。
 * createSession 失败抛错,由调用方留框重试(createdRef 复用首轮会话)。 */
async function attachPendingRelay(args: {
  source: RelaySource;
  targetId: string;
  text: string;
  truncated: boolean;
  createdRef: { current: string | null };
}): Promise<void> {
  /* 目标落位:退出卡来源带源会话归属(快照),命令来源缺省走激活工作区。 */
  const ws = args.source.workspaceId
    ? getWorkspaces().find((w) => w.id === args.source.workspaceId) ?? getActiveWorkspace()
    : getActiveWorkspace();
  if (!ws) throw new Error(t("没有可用工作区"));
  const sessionId =
    args.createdRef.current ?? (await host.createSession(args.targetId, ws.root, ws.id)).id;
  args.createdRef.current = sessionId;
  setPendingRelay(sessionId, { text: args.text, truncated: args.truncated, source: args.source });
}

/* 摘要组装 hook:编辑态(芯片点击重开)预填已挂摘要即时就绪;常态读源会话
 * 角化转录(readSessionTranscript,9 家族全声明)压缩组装 —— 磁盘行定位同
 * viewerTab 先例:经 profile.listSessions(cwd) 扫描找同 id 会话(一次性,无轮询)。 */
function useRelaySummary(source: RelaySource, workspaceRoot: string | undefined) {
  const editPayload = source.editSessionId ? getPendingRelay(source.editSessionId) : null;
  const [summary, setSummary] = useState(editPayload?.text ?? "");
  const [summaryTruncated, setSummaryTruncated] = useState(editPayload?.truncated ?? false);
  const [summaryReady, setSummaryReady] = useState(!!source.editSessionId);
  useEffect(() => {
    /* 编辑态不走磁盘:摘要已预填自芯片载荷。 */
    if (source.editSessionId) return;
    let alive = true;
    const profile =
      source.cliSessionId && source.cliSessionId !== "unknown"
        ? host.getCliProfile(source.profileId)
        : undefined;
    const locate =
      profile?.readSessionTranscript && profile.listSessions && source.cliSessionId && source.cliSessionId !== "unknown"
        ? (async () => {
            const sessions = await profile!.listSessions!(source.cwd ?? workspaceRoot ?? "").catch(() => null);
            const hit = sessions?.find((s) => s.id === source.cliSessionId) ?? null;
            return hit ? profile!.readSessionTranscript!(hit) : null;
          })()
        : Promise.resolve(null);
    void locate
      .then((transcript) => {
        if (!alive) return;
        const built = buildRelaySummary(source, transcript?.blocks ?? null, transcript?.truncated);
        setSummary(built.text);
        setSummaryTruncated(built.truncated);
        setSummaryReady(true);
      })
      .catch(() => {
        if (!alive) return;
        const built = buildRelaySummary(source, null);
        setSummary(built.text);
        setSummaryTruncated(built.truncated);
        setSummaryReady(true);
      });
    return () => {
      alive = false;
    };
    // source 由打开方构造后不变,workspace 根在浮层生命周期内亦不变
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return { summary, setSummary, summaryTruncated, summaryReady };
}

/* 编辑态更新:载荷已被发送消费 = 无可更新,静默过(调用方收框)。 */
function updatePendingRelayText(sessionId: string, text: string): void {
  const payload = getPendingRelay(sessionId);
  if (payload) setPendingRelay(sessionId, { ...payload, text });
}

function RelayDialog({ source, onClose }: { source: RelaySource; onClose: () => void }) {
  const workspace = getActiveWorkspace();
  const targets = useMemo(
    () => relayTargets(host.getCliProfiles(), source.profileId),
    [source.profileId],
  );
  /* 弹窗随 source 挂载即开(RelayLayer 无源不渲染),active 恒 true。 */
  const dialogRef = useFocusTrap(true);
  const [targetId, setTargetId] = useState<string | null>(targets[0]?.id ?? null);
  const { summary, setSummary, summaryTruncated, summaryReady } = useRelaySummary(source, workspace?.root);
  const [busy, setBusy] = useState(false);
  const createdRef = useRef<string | null>(null); /* 重试复用首轮会话 */
  /* 换目标引擎即失效复用(2026-09-28 评审 F4):createdRef 绑定创建时的 targetId,
     复用到新引擎会把摘要写进旧引擎会话(或对死会话永远失败)。同引擎重试不受影响。 */
  useEffect(() => {
    createdRef.current = null;
  }, [targetId]);
  const [error, setError] = useState("");
  /* 开框编程聚焦:焦点从退出卡按钮卸载处落 body,遮罩 onKeyDown 收不到 Esc
     (SendConfirmDialog 同款 effect 聚焦,非 autoFocus 属性,react-doctor 合规)。 */
  const textRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    textRef.current?.focus();
  }, []);

  const relay = async (): Promise<void> => {
    if (busy || !summaryReady || !summary.trim()) return;
    /* 编辑态:更新已挂芯片后收框。 */
    if (source.editSessionId) {
      updatePendingRelayText(source.editSessionId, summary.trim());
      onClose();
      return;
    }
    if (!targetId) return;
    setBusy(true);
    setError("");
    try {
      await attachPendingRelay({ source, targetId, text: summary.trim(), truncated: summaryTruncated, createdRef });
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
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={t("转到其他引擎接力")}
        className="flex w-[460px] flex-col gap-3 rounded-xl border border-(--tmd-border) bg-(--tmd-bg-panel) p-4 shadow-(--tmd-shadow-modal)"
      >
        <div className="text-sm font-medium text-(--tmd-fg)">{t("转到其他引擎接力")}</div>

        {!source.editSessionId && (
          <div>
            <div className="mb-1 text-xs text-(--tmd-fg-faint)">{t("目标引擎")}</div>
            <div className="flex flex-wrap gap-1.5">
              {targets.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  disabled={busy}
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
        )}

        <div className="flex min-h-0 flex-col">
          <div className="mb-1 flex items-center gap-2 text-xs text-(--tmd-fg-faint)">
            <span>{t("接力提示词(可编辑,将挂到新会话输入框)")}</span>
            {summaryTruncated && (
              <span className="rounded bg-(--tmd-bg-hover) px-1 text-meta text-(--tmd-git-modified)">
                {t("已截断(超摘要预算)")}
              </span>
            )}
          </div>
          <textarea
            ref={textRef}
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
            rows={10}
            className="w-full resize-none rounded-md border border-(--tmd-border) bg-(--tmd-bg-input) p-2 text-xs leading-4 text-(--tmd-fg) outline-none focus:border-(--tmd-accent)"
            aria-label={t("接力提示词")}
          />
        </div>


        {error && <div className="text-xs text-(--tmd-danger, #e5484d)">{error}</div>}

        <div className="flex items-center justify-end gap-2">
          {source.editSessionId ? (
            <button
              type="button"
              onClick={() => {
                if (source.editSessionId) dropPendingRelay(source.editSessionId);
                onClose();
              }}
              className="rounded-md border border-(--tmd-border) px-3 py-1.5 text-xs text-(--tmd-fg-faint) hover:text-(--tmd-fg)"
            >
              {t("丢弃")}
            </button>
          ) : null}
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-(--tmd-border) px-3 py-1.5 text-xs text-(--tmd-fg-faint) hover:text-(--tmd-fg)"
          >
            {t("取消")}
          </button>
          <button
            type="button"
            disabled={busy || !summaryReady || !summary.trim() || (!source.editSessionId && !targetId)}
            onClick={() => void relay()}
            className="flex items-center gap-1.5 rounded-md bg-(--tmd-accent) px-3 py-1.5 text-xs font-medium text-(--tmd-accent-fg) disabled:opacity-50"
          >
            <PaperPlaneRight size="0.75rem" aria-hidden />
            {source.editSessionId
              ? t("更新摘要")
              : busy
                ? t("开新会话中…")
                : summaryReady
                  ? t("开新会话并挂摘要")
                  : t("摘要生成中…")}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
