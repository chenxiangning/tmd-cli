/**
 * Composer 发送闭包 hook —— 自 Composer.tsx 拆出(文件规模铁则)。
 *
 * 发送管线:git 预填联动 → translate 变换 → 轮次闸写前现读 → writeSession →
 * promptSent 广播 → 输入历史记录(2026-09-10)→ 清空输入/附件/下拉。
 * 每次渲染产出新闭包,经 composerSendRef 活读(⌘K 等命令路径同源)。
 *
 * 平铺广播分支(broadcastModeRef 开 + 平铺态 + kept 目标 ≥2):同一题面逐路过
 * 各自 profile 的完整管线喂给全部幕布(含活跃),题面入史恰一次;任一条件不满足
 * 原样走单发(布尔短路,零额外开销)。
 */

import { host } from "@kernel/host";
import { composerSendTransforms } from "@kernel/composerExt";
import type { CliProfile } from "@kernel/cli";
import { getSessionTabs, getSessionTile } from "@kernel/sessionTabs";
import { emitPromptSent, readPromptGate } from "../promptGate";
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
}: {
  profile: CliProfile | null;
  value: string;
  setValue: (v: string) => void;
  clearMatches: () => void;
}): () => void {
  function sendCurrent() {
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
        for (const { id, profile: p } of targets) {
          const payload = prepareSendPayload(p, value,
            composerSendTransforms().map((fn) => (text: string) => fn(text, id)));
          const gate = readPromptGate(id);
          host.writeSession(id, payload);
          emitPromptSent(gate, id, trimmed);
        }
        recordPrompt(trimmed);
        setValue("");
        clearAttachments();
        clearMatches();
        return;
      }
    }
    const sid = host.getActiveSessionId()!;
    /* 发送变换(composerExt 契约):仅用户自然语言消息走;抽屉/工具栏命令发送不经此 */
    const payload = prepareSendPayload(profile, value,
      composerSendTransforms().map((fn) => (text: string) => fn(text, sid)));
    const gate = readPromptGate(sid); // 轮次闸写前现读:writeSession 作答即清 ask 等待态
    host.writeSession(sid, payload);
    /* 锚点快照信号(checkpoints 消费)过轮次闸:ask 作答/轮中斜杠命令不开轮不广播 */
    emitPromptSent(gate, sid, trimmed);
    /* 输入历史:仅自然语言发送入史(trim 非空即记);抽屉/工具栏命令不入(⌘K 可达) */
    recordPrompt(trimmed);
    setValue("");
    clearAttachments();
    clearMatches();
  }
  return sendCurrent;
}
