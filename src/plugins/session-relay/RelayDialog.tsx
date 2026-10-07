/**
 * 接力对话框 ── 目标引擎单选 + 摘要预览(可编辑,超限截断明示)+ 确认开新会话。
 * 数据:RelaySource(活会话命令构造 / 退出卡快照构造)→ 用户消息经 profile
 * 声明的读取器读磁盘(会话已退出也读得到);
 * 动作:createSession(目标引擎,源落位工作区,缺省激活)→ writeSession(摘要)。
 * 弹层焦点圈闭(dialog 语义:打开入首控件、Tab 循环、关闭还原焦点)。
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { PaperPlaneRight } from "@phosphor-icons/react";
import { host } from "@kernel/host";
import { getActiveWorkspace, getWorkspaces } from "@kernel/workspace";
import { t } from "@kernel/i18n";
import { prepareSendPayload } from "@kernel/profileSend";
import { emitPromptSent, readPromptGate } from "@kernel/promptGate";
import { relayTargets, buildRelaySummary, appendCarriedMarks, type RelaySource } from "./relay";
/* 跨插件消费 marks 声明的 store 数据函数(mobile 树 import cli-* 适配器同款
 * 先例):一次性读 staged + 写入成功后翻 sent,不经注册面。 */
import { stagedMarks, setMarkState } from "../marks/store";
import type { Mark } from "../marks/anchor";
import { useFocusTrap } from "@kernel/useFocusTrap";
import { clearRelaySource, useRelaySource } from "./relayStore";

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

function RelayDialog({ source, onClose }: { source: RelaySource; onClose: () => void }) {
  const workspace = getActiveWorkspace();
  const targets = useMemo(
    () => relayTargets(host.getCliProfiles(), source.profileId),
    [source.profileId],
  );
  /* 弹窗随 source 挂载即开(RelayLayer 无源不渲染),active 恒 true。 */
  const dialogRef = useFocusTrap(true);
  const [targetId, setTargetId] = useState<string | null>(targets[0]?.id ?? null);
  const [summary, setSummary] = useState("");
  /* 截断标记:摘要预算(RELAY_DIGEST_CAPS)或源转录 32MB 读取截断任一触发即明示(不让用户误以为全文都在)。 */
  const [summaryTruncated, setSummaryTruncated] = useState(false);
  const [summaryReady, setSummaryReady] = useState(false);
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

  /* 携带未发标注:源工作区 staged(已挂 composer 芯片)一次性快照,默认全带;
   * pending 不带(未入对话)。开框期间名单冻结(与摘要同生命周期)。 */
  const carryCwd = source.cwd ?? workspace?.root ?? "";
  const [staged] = useState<readonly Mark[]>(() => (carryCwd ? stagedMarks(carryCwd) : []));
  const [carryIds, setCarryIds] = useState<readonly string[]>(() => staged.map((m) => m.id));
  /* 勾选集合(渲染与发送两处循环查找走 Set;名单动态增删)。 */
  const carrySet = new Set(carryIds);
  const toggleCarry = (id: string): void =>
    setCarryIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));

  /* 摘要一次性组装:读源会话角色化转录(readSessionTranscript,9 家族全声明),
   * 压缩成用户/助手/工具三角色摘录;磁盘行定位同 viewerTab 先例 —— 无 path,
   * 经 profile.listSessions(cwd) 一次性扫描找同 id 会话(查看动作触发,无轮询)。 */
  useEffect(() => {
    let alive = true;
    const profile =
      source.cliSessionId && source.cliSessionId !== "unknown"
        ? host.getCliProfile(source.profileId)
        : undefined;
    const locate =
      profile?.readSessionTranscript && profile.listSessions && source.cliSessionId && source.cliSessionId !== "unknown"
        ? (async () => {
            const sessions = await profile!.listSessions!(source.cwd ?? workspace?.root ?? "").catch(() => null);
            const hit = sessions?.find((s) => s.id === source.cliSessionId) ?? null;
            return hit ? profile!.readSessionTranscript!(hit) : null;
          })()
        : Promise.resolve(null);
    void locate
      .then((transcript) => {
        if (alive) {
          const built = buildRelaySummary(source, transcript?.blocks ?? null, transcript?.truncated);
          setSummary(built.text);
          setSummaryTruncated(built.truncated);
          setSummaryReady(true);
        }
      })
      .catch(() => {
        if (alive) {
          const built = buildRelaySummary(source, null);
          setSummary(built.text);
          setSummaryTruncated(built.truncated);
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
    /* 不拦 !workspace:无工作区要落到底部 throw 给错误文案,静默 return = 点了没反应 */
    if (!targetId || busy || !summaryReady) return;
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
        /* 携带标注:勾选名单 ∩ staged 快照,引用块与 composer 变换同模板附尾;
         * 失败不翻 sent(留框重试语义与 composer undo 对齐)。 */
        const carried = staged.filter((m) => carrySet.has(m.id));
        const fullText = appendCarriedMarks(summary.trim(), carried);
        /* 发送契约与 composer 同源:prepareSendPayload 做 bracketedPaste 包装 +
         * CR 提交(裸 \n 不会被 TUI 当 Enter,整串突发还会触发粘贴启发式吞掉
         * 提交回车 —— 直写 = 接力首发不成立)。triggers 清空 = 不做 $token
         * 翻译:摘要是机器搬运的历史 prompt 原文,token 是正文不是用户当下
         * 意图,盲译成 /skill: 会把首发变成技能调用且预览不可见(2026-09-28 三轮)。 */
        const profile = host.getCliProfile(targetId);
        const payload = profile
          ? prepareSendPayload({ ...profile, triggers: [] }, fullText)
          : `${fullText}\r`;
        /* 轮次闸写前现读:接力首发 = 新会话空闲态,应恒广播 —— 不发则 checkpoint
           无锚点(首轮变更并入下一轮/整轮不可见)、tab 首条标题保底缺失
           (2026-09-28 评审 F5,与 composer 三条写路径同契约)。emit 文本用摘要
           原文(锚点/标题不混入引用块,与 composer emit 用户原文同语义)。 */
        const gate = readPromptGate(sessionId);
        const ok = await host.writeSession(sessionId, payload);
        if (!ok) {
          /* 目标会话秒退/写入失败:提示词凭空消失比失败更糟,留框让用户重试。
             会话已不在会话表 = 已死,清复用引用,否则同引擎重试恒复用死会话,
             错误文案建议的「重试」永不可达(2026-09-28 三轮评审)。 */
          if (!host.getSessions().some((s) => s.id === sessionId)) {
            createdRef.current = null;
          }
          setError(t("接力提示词未能送达(目标会话可能已退出),请重试或取消"));
          setBusy(false);
          return;
        }
        emitPromptSent(gate, sessionId, summary.trim());
        for (const mark of carried) setMarkState(carryCwd, mark.id, "sent");
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
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={t("转到其他引擎接力")}
        className="flex w-[460px] flex-col gap-3 rounded-xl border border-(--tmd-border) bg-(--tmd-bg-panel) p-4 shadow-(--tmd-shadow-modal)"
      >
        <div className="text-sm font-medium text-(--tmd-fg)">{t("转到其他引擎接力")}</div>

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

        <div className="flex min-h-0 flex-col">
          <div className="mb-1 flex items-center gap-2 text-xs text-(--tmd-fg-faint)">
            <span>{t("接力提示词(可编辑,将作为新会话首条消息发出)")}</span>
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

        {staged.length > 0 && (
          <div className="flex flex-col gap-1">
            <div className="text-xs text-(--tmd-fg-faint)">
              {t("携带未发标注({n}/{total} 条,随首条消息一并发出)", {
                n: carryIds.length,
                total: staged.length,
              })}
            </div>
            {staged.map((m) => {
              const key = `${m.path}:${m.startLine}`;
              return (
                <label
                  key={m.id}
                  className="flex cursor-pointer items-center gap-2 rounded-md border border-(--tmd-border) px-2 py-1 text-xs text-(--tmd-fg-faint) hover:text-(--tmd-fg)"
                >
                  <input
                    type="checkbox"
                    checked={carrySet.has(m.id)}
                    onChange={() => toggleCarry(m.id)}
                    disabled={busy}
                    className="accent-(--tmd-accent)"
                  />
                  <span className="truncate font-mono" data-testid="carry-mark" data-key={key}>
                    {m.path.split("/").at(-1)}:L{m.startLine}
                    {m.startLine !== m.endLine ? `-L${m.endLine}` : ""}
                  </span>
                  {m.note && <span className="truncate text-meta">{m.note}</span>}
                </label>
              );
            })}
          </div>
        )}

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
            disabled={!targetId || busy || !summaryReady || !summary.trim()}
            onClick={() => void relay()}
            className="flex items-center gap-1.5 rounded-md bg-(--tmd-accent) px-3 py-1.5 text-xs font-medium text-(--tmd-accent-fg) disabled:opacity-50"
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
