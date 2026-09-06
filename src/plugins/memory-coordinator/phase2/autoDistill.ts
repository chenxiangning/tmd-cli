/**
 * 会话自动沉淀(sessionExited 钩子,默认 opt-in)—— d 路闭环(v2)。
 *
 * omp 会话退出时读其用户消息尾段,交 omp 模型提炼(ctx_memory write);
 * 读取的是 CLI 自己落盘的会话文件,提炼与写入全部在 omp 官方管线内,
 * tmd-cli 零 AI 调用。默认关(settings.memoryAutoDistill),显式 opt-in。
 *
 * d 路 v2(PoC-7 实证,2026-09-06):subagent-entry.js + dreamer-actions flag 组合;
 * subagent-entry 缺失等失败由 viaOmp 返回 detail 携带(missing-subagent-entry)。
 */

import { host } from "@kernel/host";
import { getSettingsState } from "@kernel/settings";
import { distillSessionTail } from "./write";

/** 已沉淀过的会话(幂等:一次会话生命周期只触发一次)。 */
const distilled = new Set<string>();

function onSessionExited(sessionId: string): void {
  if (!getSettingsState().settings.memoryAutoDistill) {
    console.info("[mem-auto] skip:自动沉淀开关未开", sessionId.slice(0, 8));
    return;
  }
  if (distilled.has(sessionId)) return;
  distilled.add(sessionId);

  const meta = host.getSessions().find((s) => s.id === sessionId);
  if (!meta || meta.profileId !== "omp") {
    console.info("[mem-auto] skip:非 omp 会话或身份已不在列表", sessionId.slice(0, 8), meta?.profileId);
    return;
  }
  const cliSessionId = host.getCliSessionId(sessionId) ?? "";
  const profile = host.getCliProfile("omp");
  const readMsgs = profile?.readSessionUserMessages;
  if (!readMsgs) {
    console.warn("[mem-auto] skip:omp profile 缺 readSessionUserMessages", sessionId.slice(0, 8));
    return;
  }

  void (async () => {
    try {
      const msgs = await readMsgs(meta.cwd, cliSessionId, true);
      const tail = (msgs ?? [])
        .slice(-10)
        .map((m) => m.text)
        .join("\n---\n")
        .slice(-6000);
      console.info("[mem-auto] tail 就绪", sessionId.slice(0, 8), "len=", tail.length);
      if (tail) {
        const cfg = getSettingsState().settings;
        const out = await distillSessionTail(tail, meta.cwd, {
          model: cfg.memoryDistillModel || undefined,
          extraRules: cfg.memoryDistillRules || undefined,
          engine: cfg.memoryDistillEngine,
        });
        console.info("[mem-auto] distill 完成 ok=", out.ok, "detail=", out.detail.slice(0, 120));
      } else {
        console.info("[mem-auto] tail 为空,无可沉淀", sessionId.slice(0, 8));
      }
    } catch (err) {
      console.warn("[mem-auto] 异常(会话清理/文件不可读等)", sessionId.slice(0, 8), err);
    }
  })();
}

/** 插件 activate 期挂载;返回退订函数。 */
export function attachAutoDistill(): () => void {
  /* payload 是裸 sessionId 字符串(见 sessionAdopt.ts emit 点;与 checkpoints /
   * messageAnchors 消费者同构)。曾误按 {sessionId} 对象解构 → 恒 undefined,
   * 自动沉淀从未触发(2026-09-06 修复)。 */
  return host.events.on<string>("kernel.sessions.exited", (sessionId) => {
    if (sessionId) onSessionExited(sessionId);
  });
}