/**
 * 启动失败摘要与守望(自 sessionSpawn.ts 拆出,文件规模铁则)。
 *
 * 语义不变:进程在启动窗口内退出 = 启动失败,摘幕布尾部广播
 * sessionStartFailed(Toast 呈现)—— pty://exit 会秒删 tab、removeSession
 * 即清输出缓冲,报错在任何界面都来不及呈现(静默闪退)。
 */

import { KernelTopics, type EventBus } from "./events";

/** spawn 后多久内退出视为「启动失败」。node 系 CLI 冷启动数秒,窗口取宽些。 */
export const START_FAIL_WINDOW_MS = 20_000;
/** 摘报错的幕布尾部字符数(取宽留给压缩,展示侧再截)。 */
export const TAIL_SOURCE_CHARS = 2_000;

/**
 * 幕布尾部 → 可读报错摘要:剥 ANSI(TUI 把报错裹进样式序列)、\r 重绘折叠、
 * 丢 JS 栈帧行(噪音),留最后几行非空文本。空输出给固定文案。
 */
export function crashTail(raw: string): string {
  const text = raw
    .slice(-TAIL_SOURCE_CHARS)
    .replace(
      /\x1b\[[0-9;:?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[PX^_].*?\x1b\\|\x1b[@-_]/g,
      "",
    )
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .filter((line) => !/^\s*at\s/.test(line))
    .join("\n")
    .replace(/\n{2,}/g, "\n")
    .trim();
  return text.length > 0 ? text.slice(-600) : "进程退出且无任何输出";
}

/** emitSessionStartFailed 的最小依赖面。 */
interface StartFailHost {
  getSessions(): Array<{ id: string }>;
  outputTail(sessionId: string, maxChars: number): string;
}

/** 窗口外退出的崩溃特征(误放行 OK:正常退出静默;漏报优于每个 /quit 弹通知)。 */
const CRASH_HINT_RE = /(error|fatal|panic|traceback|exception|failed|denied|abort|崩溃|失败)/i;

/** 启动窗口内退出 = 启动失败;窗口外(慢启动 CLI 冷启 10-25s)带崩溃特征退出 =
 *  降级同样广播(late 置位,Toast 标题换「会话异常退出」)—— 正常退出静默不打扰。 */
export function emitSessionStartFailed(
  h: StartFailHost,
  events: EventBus,
  sessionId: string,
  profileId: string,
  adoptedAt: number,
): void {
  const late = Date.now() - adoptedAt > START_FAIL_WINDOW_MS;
  if (!h.getSessions().some((s) => s.id === sessionId)) return;
  const tail = h.outputTail(sessionId, TAIL_SOURCE_CHARS);
  if (late && !CRASH_HINT_RE.test(tail)) return;
  events.emit(KernelTopics.sessionStartFailed, {
    sessionId,
    profileId,
    reason: crashTail(tail),
    late,
  });
}
