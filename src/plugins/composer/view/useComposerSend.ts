/**
 * Composer 发送闭包 hook —— 自 Composer.tsx 拆出(文件规模铁则)。
 *
 * 发送管线(spec 2026-09-27-composer-send-confirm 起 = 确认/执行两段):
 * 确认段:校验(空文本/无 profile/无会话)→ 构建计划(目标快照 + 内容)→
 *   开关开则交 requestConfirm 挂起(弹 SendConfirmDialog),取消即终止;
 * 执行段:git 预填联动 → translate 变换 → 轮次闸写前**现读**(确认期间 ask 态
 *   可能变化,故闸读/广播目标解析都在确认后的执行段重跑)→ writeSession(等
 *   送达)→ promptSent 广播 → 输入历史记录 → 清空输入/附件/下拉。
 * 写入失败(会话死/PTY 断)保草稿并报 onSendError;全目标失败回滚发送变换的
 * 乐观副作用(marks 翻 sent 退 staged)。每次渲染产出新闭包,经 composerSendRef
 * 活读(⌘K 等命令路径同源)。
 *
 * 平铺广播分支(broadcastModeRef 开 + 平铺态):同一题面逐路走各自 profile 的
 * 完整管线喂给全部幕布(含活跃),题面入史恰一次;任一失败保草稿汇总
 * 「N 路中 M 路失败」(不整批重发,防好目标重复);全败才回滚变换。
 * 目标 ≥2 才广播,缺员自动落回单发(计划期/执行期同判,执行期为准)。
 */

import { host } from "@kernel/host";
import { t } from "@kernel/i18n";
import { composerDraftRef, composerEmptySendPermitted, composerSendTransforms, undoComposerSend } from "@kernel/composerExt";
import type { CliProfile } from "@kernel/cli";
import { getSessionTabs, getSessionTile } from "@kernel/sessionTabs";
import { emitPromptSent, readPromptGate, shouldBroadcastPrompt } from "@kernel/promptGate";
import { prepareSendPayload } from "@kernel/profileSend";
import { clearAttachments } from "../state/attachments";
import { recordPrompt } from "@kernel/promptHistory";
import { broadcastModeRef } from "./broadcastMode";
import { resolveBroadcastTargets } from "./broadcastTargets";
import { buildBroadcastPlan, buildSinglePlan, isConfirmPending, setSendExecuting, type SendConfirmRequest, type SendPlan } from "./sendPlan";
/* 跨插件先例:session-relay 直读 marks store「不经注册面」同款(composer 侧
   消费随发名单,W2 存证链 ranges 载荷;app 树插件互引例外条款)。 */
import { carriedMarks } from "../../marks/sendTransform";

export function useComposerSend({
  profile,
  value,
  setValue,
  clearMatches,
  onSendError,
  confirmEnabled,
  requestConfirm,
}: {
  profile: CliProfile | null;
  value: string;
  setValue: (v: string) => void;
  clearMatches: () => void;
  onSendError: (msg: string) => void;
  /** 发送二次确认开关(settings.sendConfirmEnabled),send 时现读。 */
  confirmEnabled: boolean;
  /** 确认挂起回调(Composer 注入,弹 SendConfirmDialog)。 */
  requestConfirm: (req: SendConfirmRequest) => void;
}): () => void {
  /* 执行段:plan.content 为准(预览即所得);闸读/目标解析在此现读。 */
  async function executeSend(plan: SendPlan) {
    setSendExecuting(true);
    try {
      const trimmed = plan.content;
      /* git 联动:`/commit <msg>` → 预填 git 面板提交框(契约源头
       * src/plugins/git/gitEvents.ts GIT_PREFILL_TOPIC;插件间不互 import)。
       * 仅预填 —— 文本照常发给 CLI,commit 执行权永在 git 面板按钮。
       * 在执行段触发:取消确认不留预填副作用。 */
      if (trimmed.startsWith("/commit ")) {
        host.events.emit("git://composer-prefill", { message: trimmed.slice(8).trim() });
      }
      /* 平铺广播:开关开 + 平铺态 + 目标 ≥2 才走;逐路完整管线(translate/bracketed
         差异、发送变换、轮次闸 promptSent 全继承);收尾与单发同款。缺员落回单发。 */
      if (plan.kind === "broadcast" && broadcastModeRef.current && getSessionTile()) {
        const sid = host.getActiveSessionId();
        if (!sid) return;
        const targets = resolveBroadcastTargets(
          getSessionTabs(), sid, host.getSessions(),
          (pid) => host.getCliProfile(pid),
        );
        if (targets.length >= 2) {
          /* 发送变换单次化:变换可能带副作用(marks 翻 sent),逐路重跑会让
             引用块只进第一路、状态在第二路前已被翻掉。共享同一份变换文本,
             各路差异(bracketed paste 等)仍由 prepareSendPayload 按目标处理。
             变换过闸(单路同款):ask 确认期作答不开新轮,引用块不注入。 */
          const activeGate = readPromptGate(sid);
          const gateOpen = shouldBroadcastPrompt(activeGate, trimmed);
          const shared = gateOpen
            ? composerSendTransforms().reduce(
                (acc, fn) => fn(acc, sid),
                trimmed,
              )
            : trimmed;
          /* 闸关时 transforms 未跑、lastFlip 未清:carriedMarks 会带回上一轮
             成功发送的残留名单,别轮标注错记本轮存证(评审 P1);口径与单发
             transforms.length>0 对齐 —— 闸开但注册面空(marks 运行期卸载)同不读。 */
          const carried =
            gateOpen && composerSendTransforms().length > 0 ? carriedMarks() : undefined;
          const failed: string[] = (
            await Promise.all(
              targets.map(async ({ id, profile: p }): Promise<string | null> => {
                const payload = prepareSendPayload(p, shared, []);
                const gate = readPromptGate(id);
                if (await host.writeSession(id, payload)) {
                  emitPromptSent(gate, id, trimmed, carried);
                  return null;
                }
                return id;
              }),
            )
          ).filter((r): r is string => r !== null);
          if (failed.length > 0) {
            if (failed.length === targets.length && gateOpen) undoComposerSend();
            onSendError(
              failed.length === targets.length
                ? t("发送失败:会话已断开,内容已保留")
                : t("{n} 路中 {m} 路发送失败,内容已保留", { n: targets.length, m: failed.length }),
            );
            return;
          }
          if (trimmed) recordPrompt(trimmed); /* 空输入首发(接力芯片)不入 ↑ 召回史 */
          clearInputIfUnchanged(plan);
          clearAttachments();
          clearMatches();
          return;
        }
      }
      /* 单发:绑定计划期目标 id(确认弹层承诺即所写,不跟随活跃指针漂移 ——
         确认窗内 Ctrl+Tab 切幕布/计划会话退出都会改活跃指针,2026-09-28 评审 F1);
         广播退化单发(缺员/开关关)同语义:优先落计划快照内首个仍存活目标,
         快照全灭 = 会话已断开语义,报错保草稿(2026-09-28 三轮评审)。
         profile 按目标现取,消旧闭包 profile 错配。目标消失 = 会话已断开语义。 */
      const sid =
        plan.kind === "single"
          ? plan.targets[0]?.id
          : plan.targets.find((t) => host.getSessions().some((s) => s.id === t.id))?.id;
      if (!sid) {
        if (plan.kind === "broadcast") {
          onSendError(t("发送失败:会话已断开,内容已保留"));
        }
        return;
      }
      const meta = host.getSessions().find((s) => s.id === sid);
      if (!meta) {
        onSendError(t("发送失败:会话已断开,内容已保留"));
        return;
      }
      const targetProfile = host.getCliProfile(meta.profileId) ?? profile;
      if (!targetProfile) return;
      /* 单发路径。闸读前置 + 变换过闸:ask 确认期作答/轮中斜杠命令不开新轮,
         发送变换(marks 注入+翻 sent)与之同语义跳过 —— 与 promptSent 锚点闸口径一致。 */
      const gate = readPromptGate(sid);
      const anchored = shouldBroadcastPrompt(gate, trimmed);
      const transforms = anchored
        ? composerSendTransforms().map((fn) => (text: string) => fn(text, sid))
        : [];
      const payload = prepareSendPayload(targetProfile, trimmed, transforms);
      if (!(await host.writeSession(sid, payload))) {
        /* 只回滚本轮真正运行过的变换:闸关/无变换时不动注册面 undo,
           防 marks 的历史翻转名单被无关失败错误回滚(2026-09-20 复查)。 */
        if (transforms.length > 0) undoComposerSend();
        onSendError(t("发送失败:会话已断开,内容已保留"));
        return;
      }
      emitPromptSent(gate, sid, trimmed, transforms.length > 0 ? carriedMarks() : undefined);
      if (trimmed) recordPrompt(trimmed); /* 空输入首发(接力芯片)不入 ↑ 召回史 */
      clearInputIfUnchanged(plan);
      clearAttachments();
      clearMatches();
    } finally {
      setSendExecuting(false);
    }
  }

  /* 确认期间输入框被续写则保留新草稿:弹层模态但输入框仍可聚焦,无条件清空会
     吃掉确认期间的新输入(2026-09-27 桩目检实证)。composerDraftRef 活读当前
     全文(executeSend 闭包捕获的是挂起期渲染的 value,已过期)。 */
  function clearInputIfUnchanged(plan: SendPlan): void {
    if (((composerDraftRef.current?.() ?? "").trim()) === plan.content) setValue("");
  }

  async function sendCurrent() {
    if (isConfirmPending()) return; // 模态闸:确认框在屏时发送键静默(防旧计划被顶替)
    if (!profile) return;
    const activeSid = host.getActiveSessionId();
    if (!activeSid) return;
    const trimmed = value.trim();
    /* 空输入默认拦;接力芯片等挂起内容经 kernel 空 provider 放行(marks 不注册,语义不动)。 */
    if (!trimmed && !composerEmptySendPermitted(activeSid)) return;
    const sid = activeSid;
    /* 确认段:计划期目标快照仅供展示;执行段重解析(≥2 才广播,缺员落单发)。 */
    const plan =
      broadcastModeRef.current && getSessionTile()
        ? buildBroadcastPlan(
            resolveBroadcastTargets(
              getSessionTabs(), sid, host.getSessions(),
              (pid) => host.getCliProfile(pid),
            ).map((t) => t.id),
            trimmed,
          )
        : buildSinglePlan(sid, trimmed);
    if (!plan) return; // 会话在计划期已消失,同无会话守卫静默
    if (confirmEnabled) {
      await new Promise<void>((resolve) => {
        requestConfirm({
          plan,
          onConfirm: () => {
            void executeSend(plan).finally(resolve);
          },
          onCancel: resolve,
        });
      });
      return;
    }
    await executeSend(plan);
  }
  return sendCurrent;
}
