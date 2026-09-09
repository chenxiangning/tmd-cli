/**
 * 幕布输出装配 —— 挂载回放(分块带进度)+ 实时流保序 + 「加载至就绪」进度态。
 *
 * 为什么存在:整段 write 数百 KB 会堵 xterm 解析数秒(幕布全空);冷开会话
 * 要等 CLI 启动 + resume 重放流入,同样数秒空白。两者统一遮罩进度:
 * - 有内存缓冲可回放 → 分块写入,进度 = 已解析块数/总块数(真实解析进度);
 * - 无缓冲但有磁盘尾预取(冷开磁盘会话,diskReplay)→ 回放上一代日志尾,
 *   回放尽即就绪撤罩 —— 墓碑帧本身就是内容,不等静默(CLI 首字节 1-3s 后才到);
 * - 无缓冲/回放尽 → 流式阶段,进度 = 已接收字符计数,输出静默 0.5s 判就绪撤罩;
 *   12s 兜底防 CLI 不重绘卡死遮罩。
 * 就绪锁:遮罩一旦撤下(回放尽/静默/兜底)即永久就绪,后续实时字节不再重提遮罩 ——
 * 否则生成期 spinner 持续重绘、切模型回显、resize 重绘都会把幕布反复盖住。
 * 保序(异步接缝,评审 F3):liveQueue 从挂载起攒队 —— 磁盘尾是异步源,promise
 * 未决期间实时字节严禁直写幕布(否则先写新内容、回放后到即交错);回放尽后按序补写。
 */

import type { Terminal } from "@xterm/xterm";
import { host, ptyLiveTopic } from "@kernel/host";
import type { ReplayInputGate } from "@kernel/terminalInputGate";
import { consumeDiskTail } from "./diskReplay";

/** 单块字符数:足够小使进度平滑,又不至于回调过频。 */
const REPLAY_CHUNK_CHARS = 128 * 1024;
/** 输出静默判就绪窗口:流式阶段无新字节达此时长即撤罩。 */
const QUIET_READY_MS = 500;
/** 遮罩兜底:CLI 不重绘(忽略 SIGWINCH)时最长展示时长。 */
const PROGRESS_FAILSAFE_MS = 12_000;

/**
 * 加载进度态(null = 撤罩):
 * - replay:分块回放中,pct 0–100;
 * - stream:等待/接收实时输出中,chars = 已流入字符数(相对输出缓冲上限占比绘条)。
 */
export type LoadProgress =
  | { kind: "replay"; pct: number }
  | { kind: "stream"; chars: number }
  | null;

/** 分块回放,每块解析完回调进度(1-based 块计数);xterm 流式解析器天然容忍块边界切在转义序列中间。 */
export function writeInChunks(
  term: Pick<Terminal, "write">,
  text: string,
  onChunk: (done: number, total: number) => void,
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

/** 回放 + 实时订阅 + 就绪探测装配;返回 cleanup(停订阅、清计时器、忽略迟到的回调)。 */
export function attachTerminalStream(
  term: Pick<Terminal, "write">,
  sessionId: string,
  inputGate: ReplayInputGate,
  onProgress: (p: LoadProgress) => void,
): () => void {
  let cancelled = false;
  let quietTimer: ReturnType<typeof setTimeout> | undefined;
  /* 实时字节与回放保序:回放未完成先攒队列,尽后按序补写(否则新字节插进旧内容中间)。
     攒队期间的字节同样计入流式进度。 */
  let liveQueue: string[] | null = [];
  let received = 0;
  /* 就绪锁:true 后实时字节照常写幕布,但不再触碰进度态(见文件头注释)。 */
  let ready = false;


  const offLive = host.events.on<string>(ptyLiveTopic(sessionId), (text) => {
    if (liveQueue) liveQueue.push(text);
    else term.write(text);
    received += text.length;
    /* 攒队期间进度归回放分支驱动;直写期才走流式进度 */
    if (!cancelled && !ready && !liveQueue) {
      onProgress({ kind: "stream", chars: received });
      armQuiet();
    }
  });

  /* 静默判就绪:回放完后(或本无回放)输出安静 QUIET_READY_MS → 撤罩;
     每次新字节重置。无字节也起表——空缓冲空会话 0.5s 后即视为就绪。 */
  const armQuiet = (): void => {
    clearTimeout(quietTimer);
    quietTimer = setTimeout(() => {
      if (cancelled) return;
      ready = true;
      onProgress(null);
    }, QUIET_READY_MS);
  };

  const memoryReplay = host.getOutputBuffer(sessionId);
  const diskTail = memoryReplay ? null : consumeDiskTail(host.getCliSessionId(sessionId));
  if (memoryReplay) {
    inputGate.arm();
    onProgress({ kind: "replay", pct: 0 });
    void writeInChunks(term, memoryReplay, (done, total) => {
      if (!cancelled && !ready) onProgress({ kind: "replay", pct: Math.round((done / total) * 100) });
    }).then(() => {
      /* 卸载竞态不冻结输入闸(随组件重挂载重生,闸门泄漏才致命);其余全部忽略。 */
      inputGate.release();
      if (cancelled) return;
      const pending = liveQueue ?? [];
      liveQueue = null;
      for (const text of pending) term.write(text);
      if (!ready) {
        onProgress({ kind: "stream", chars: received });
        armQuiet();
      }
    });
    host.observeReplayTail(sessionId);
  } else if (diskTail) {
    /* 磁盘先行回放(冷开磁盘会话):尾巴到手前 liveQueue 持续攒队(F3);
       回放尽即就绪撤罩 —— 墓碑帧即内容,不等静默(F1p);随后 restoreTail 恢复 Ask 徽章 */
    onProgress({ kind: "replay", pct: 0 });
    void diskTail.then((page) => {
      if (cancelled) return;
      const tail = page?.text ?? "";
      const flushQueued = (): void => {
        const queued = liveQueue ?? [];
        liveQueue = null;
        for (const text of queued) term.write(text);
      };
      if (!tail) {
        /* 无指针/日志/IPC 失败:攒下的字节按序放行,回落现状直流式 */
        flushQueued();
        if (!ready) {
          onProgress({ kind: "stream", chars: received });
          armQuiet();
        }
        return;
      }
      inputGate.arm();
      void writeInChunks(term, tail, (done, total) => {
        if (!cancelled && !ready) onProgress({ kind: "replay", pct: Math.round((done / total) * 100) });
      }).then(() => {
        inputGate.release();
        if (cancelled) return;
        flushQueued();
        ready = true;
        onProgress(null);
        host.restoreDiskTail(sessionId, tail);
      });
    });
  } else {
    liveQueue = null;
    onProgress({ kind: "stream", chars: 0 });
    armQuiet();
  }

  const failsafe = setTimeout(() => {
    if (cancelled || ready) return;
    ready = true;
    onProgress(null);
  }, PROGRESS_FAILSAFE_MS);

  return () => {
    cancelled = true;
    liveQueue = null;
    clearTimeout(quietTimer);
    clearTimeout(failsafe);
    offLive();
  };
}
