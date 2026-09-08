/**
 * 幕布输出装配 —— 回放内核输出缓冲(分块 + 进度回调)与实时流订阅的保序接线。
 *
 * 整段 write 数百 KB(预激活/长会话切回)会把 xterm 解析线程堵出数秒全空,
 * 分块顺序写让块间可绘制进度条;回放未竟时实时字节先攒队列,回放尽后按序补写,
 * 新字节不插进旧内容中间(与 appendOutput/live topic 的既有字节序一致)。
 */
import type { Terminal } from "@xterm/xterm";
import { host, ptyLiveTopic } from "@kernel/host";
import type { ReplayInputGate } from "@kernel/terminalInputGate";


/** 单块字符数:足够小使进度平滑,又不至于回调过频。 */
const REPLAY_CHUNK_CHARS = 128 * 1024;
/** 低于此不显进度条(小缓冲回放瞬时完成,闪条反而是噪音)。 */
export const REPLAY_PROGRESS_MIN_CHARS = 256 * 1024;

/** 分块回放:每块解析完回调进度(1-based 块计数)。xterm 流式解析器容忍块边界切在转义序列中间。 */
export function writeInChunks(
  term: Pick<Terminal, "write">,
  text: string,
  onChunk: (written: number, total: number) => void,
): Promise<void> {
  const chunks: string[] = [];
  for (let i = 0; i < text.length; i += REPLAY_CHUNK_CHARS) {
    chunks.push(text.slice(i, i + REPLAY_CHUNK_CHARS));
  }
  onChunk(0, chunks.length);
  return chunks.reduce<Promise<void>>(
    (prev, chunk, i) =>
      prev.then(
        () =>
          new Promise<void>((resolve) =>
            term.write(chunk, () => {
              onChunk(i + 1, chunks.length);
              resolve();
            }),
          ),
      ),
    Promise.resolve(),
  );
}

/** 回放 + 实时订阅装配;返回 cleanup(退订、停攒队列、忽略迟到的回放完成回调)。 */
export function attachTerminalStream(
  term: Pick<Terminal, "write">,
  sessionId: string,
  inputGate: ReplayInputGate,
  onProgress: (pct: number | null) => void,
): () => void {
  let cancelled = false;
  let liveQueue: string[] | null = [];
  const offLive = host.events.on<string>(ptyLiveTopic(sessionId), (text) => {
    if (liveQueue) liveQueue.push(text);
    else term.write(text);
  });
  const replay = host.getOutputBuffer(sessionId);
  if (replay) {
    inputGate.arm();
    const track = replay.length >= REPLAY_PROGRESS_MIN_CHARS;
    if (track) onProgress(0);
    void writeInChunks(term, replay, (done, total) => {
      if (!cancelled && track) onProgress(Math.round((done / total) * 100));
    }).then(() => {
      /* 闸必须先放(幂等钳位):cleanup 走 cancelled 早退也不能把输入闸留在 armed 态 */
      inputGate.release();
      if (cancelled) return;
      const pending = liveQueue ?? [];
      liveQueue = null;
      for (const text of pending) term.write(text);
      if (track) onProgress(null);
    });
    /* 重挂载补观察:静态 Ask 面板不再产生新输出,喂尾巴恢复等待检测(见 askWatchFeed)。 */
    host.observeReplayTail(sessionId);
  } else {
    liveQueue = null;
  }
  return () => {
    cancelled = true;
    liveQueue = null;
    offLive();
  };
}
