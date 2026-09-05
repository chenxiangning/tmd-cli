/**
 * 会话自动沉淀(sessionExited 钩子,默认 opt-in)—— d 路闭环。
 *
 * omp 会话退出时读其用户消息尾段,交 omp 模型提炼(ctx_memory write);
 * 读取的是 CLI 自己落盘的会话文件,提炼与写入全部在 omp 官方管线内,
 * tmd-cli 零 AI 调用。默认关(settings.memoryAutoDistill),显式 opt-in。
 * 同 workspace 短窗防抖:退出即沉淀一次,失败静默丢弃(不阻塞会话清理)。
 */

import { host } from "@kernel/host";
import { getSettingsState } from "@kernel/settings";
import { distillSessionTail } from "./write";

/** 已沉淀过的会话(幂等:一次会话生命周期只触发一次)。 */
const distilled = new Set<string>();

function onSessionExited(sessionId: string): void {
  if (!getSettingsState().settings.memoryAutoDistill) return;
  if (distilled.has(sessionId)) return;
  distilled.add(sessionId);

  const meta = host.getSessions().find((s) => s.id === sessionId);
  if (!meta || meta.profileId !== "omp") return;
  const cliSessionId = host.getCliSessionId(sessionId) ?? "";
  const profile = host.getCliProfile("omp");
  const readMsgs = profile?.readSessionUserMessages;
  if (!readMsgs) return;

  void (async () => {
    try {
      const msgs = await readMsgs(meta.cwd, cliSessionId, true);
      const tail = (msgs ?? [])
        .slice(-10)
        .map((m) => m.text)
        .join("\n---\n")
        .slice(-6000);
      if (tail) {
        const cfg = getSettingsState().settings;
        await distillSessionTail(tail, meta.cwd, {
          model: cfg.memoryDistillModel || undefined,
          extraRules: cfg.memoryDistillRules || undefined,
          engine: cfg.memoryDistillEngine,
        });
      }
    } catch {
      // 会话已清理/文件不可读:静默丢弃本次(不影响主流程)
    }
  })();
}

/** 插件 activate 期挂载;返回退订函数。 */
export function attachAutoDistill(): () => void {
  return host.events.on("kernel.sessions.exited", (payload) => {
    const sessionId = (payload as { sessionId?: string } | undefined)?.sessionId;
    if (sessionId) onSessionExited(sessionId);
  });
}
