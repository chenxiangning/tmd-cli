/**
 * Composer 发送闭包 hook —— 自 Composer.tsx 拆出(文件规模铁则)。
 *
 * 发送管线:git 预填联动 → translate 变换 → 轮次闸写前现读 → writeSession(等
 * 送达)→ promptSent 广播 → 输入历史记录(2026-09-10)→ 清空输入/附件/下拉。
 * 写入失败(会话死/PTY 断)保草稿并报 onSendError;全目标失败回滚发送变换的
 * 乐观副作用(marks 翻 sent 退 staged)。每次渲染产出新闭包,经 composerSendRef
 * 活读(⌘K 等命令路径同源)。
 *
 * 平铺广播分支(broadcastModeRef 开 + 平铺态 + kept 目标 ≥2):同一题面逐路过
 * 各自 profile 的完整管线喂给全部幕布(含活跃),题面入史恰一次;任一失败保草稿
 * 汇总「N 路中 M 路失败」(不整批重发,防好目标重复);全败才回滚变换。
 */

import { host } from "@kernel/host";
import { t } from "@kernel/i18n";
import { composerSendTransforms, undoComposerSend } from "@kernel/composerExt";
import type { CliProfile } from "@kernel/cli";
import { getSessionTabs, getSessionTile } from "@kernel/sessionTabs";
import { emitPromptSent, readPromptGate, shouldBroadcastPrompt } from "../promptGate";
import { prepareSendPayload } from "../serialize/serialize";
import { clearAttachments } from "../state/attachments";
import { recordPrompt } from "@kernel/promptHistory";
import { broadcastModeRef } from "./broadcastMode";
import { resolveBroadcastTargets } from "./broadcastTargets";

export function useComposerSend({
  profile,
  value,
  setValue,
  clearMatches,
  onSendError,
}: {
  profile: CliProfile | null;
  value: string;
  setValue: (v: string) => void;
  clearMatches: () => void;
  onSendError: (msg: string) => void;
}): () => void {
  async function sendCurrent() {
    if (!value.trim()) return;
    if (!profile || !host.getActiveSessionId()) return;
    /* git 联动:`/commit <msg>` → 预填 git 面板提交框。
     * 契约源头:src/plugins/git/gitEvents.ts(GIT_PREFILL_TOPIC);
     * 插件间不互相 import,topic 字符串即契约(事件总线惯例)。
     * 仅预填 —— 文本照常发给 CLI,commit 执行权永在 git 面板按钮。 */
    const trimmed = value.trim();
    if (trimmed.startsWith("/commit ")) {
      host.events.emit("git://composer-prefill", { message: trimmed.slice(8).trim() });
    }
    /* 平铺广播:开关开 + 平铺态 + 目标 ≥2 才走;逐路完整管线(translate/bracketed
       差异、发送变换、轮次闸 promptSent 全继承);收尾与单发同款。不满足落回单发。 */
    if (broadcastModeRef.current && getSessionTile()) {
      const targets = resolveBroadcastTargets(
        getSessionTabs(), host.getActiveSessionId(), host.getSessions(),
        (pid) => host.getCliProfile(pid),
      );
      if (targets.length >= 2) {
        /* 发送变换单次化:变换可能带副作用(marks 翻 sent),逐路重跑会让
           引用块只进第一路、状态在第二路前已被翻掉。共享同一份变换文本,
           各路差异(bracketed paste 等)仍由 prepareSendPayload 按目标处理。
           变换过闸(单路同款):ask 确认期作答不开新轮,引用块不注入。 */
        const activeGate = readPromptGate(host.getActiveSessionId()!);
        const shared = shouldBroadcastPrompt(activeGate, trimmed)
          ? composerSendTransforms().reduce(
              (acc, fn) => fn(acc, host.getActiveSessionId()!),
              value,
            )
          : value;
        const failed: string[] = (
          await Promise.all(
            targets.map(async ({ id, profile: p }): Promise<string | null> => {
              const payload = prepareSendPayload(p, shared, []);
              const gate = readPromptGate(id);
              if (await host.writeSession(id, payload)) {
                emitPromptSent(gate, id, trimmed);
                return null;
              }
              return id;
            }),
          )
        ).filter((r): r is string => r !== null);
        if (failed.length > 0) {
          if (failed.length === targets.length) undoComposerSend();
          onSendError(
            failed.length === targets.length
              ? t("发送失败:会话已断开,内容已保留")
              : t("{n} 路中 {m} 路发送失败,内容已保留", { n: targets.length, m: failed.length }),
          );
          return;
        }
        recordPrompt(trimmed);
        setValue("");
        clearAttachments();
        clearMatches();
        return;
      }
    }
    const sid = host.getActiveSessionId()!;
    /* 闸读前置 + 变换过闸:ask 确认期作答/轮中斜杠命令不开新轮,发送变换
       (marks 注入+翻 sent)与之同语义跳过 —— 与 promptSent 锚点闸口径一致。 */
    const gate = readPromptGate(sid);
    const anchored = shouldBroadcastPrompt(gate, trimmed);
    const transforms = anchored
      ? composerSendTransforms().map((fn) => (text: string) => fn(text, sid))
      : [];
    const payload = prepareSendPayload(profile, value, transforms);
    if (!(await host.writeSession(sid, payload))) {
      undoComposerSend();
      onSendError(t("发送失败:会话已断开,内容已保留"));
      return;
    }
    emitPromptSent(gate, sid, trimmed);
    recordPrompt(trimmed);
    setValue("");
    clearAttachments();
    clearMatches();
  }
  return sendCurrent;
}
