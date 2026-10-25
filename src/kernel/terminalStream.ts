/**
 * 幕布输出装配 · 流装配 —— attachTerminalStream(回放 + 实时订阅 + 就绪探测)
 * 2026-10-20 从 terminalReplay.ts 拆出(守 300 行铁则;零语义改动,函数体与
 * 编排注释原样搬迁)。分块回放原语 writeInChunks 与进度/控制类型留在
 * terminalReplay.ts,本文件经其 re-export 对外,消费方路径不变。
 *
 * 装配语义(原文):实时字节与回放保序(liveQueue 攒队)、内存回放分块进度、
 * 挤除冻结快照 fast 路径、磁盘先行回放 + 清屏序列(\x1b[2J)观测一次切换、
 * 隐藏幕布 250ms 合帧缓写、静默 0.5s 判就绪、12s/30s 双兜底、就绪锁幂等。
 */
import type { Terminal } from "@xterm/xterm";
import { host, ptyLiveTopic } from "@kernel/host";
import {
  createSigwinchGuard,
  registerSigwinchGuard,
  releaseSigwinchGuard,
  sigwinchGuardOf,
  stripDanceEnvelopes,
} from "@kernel/terminalSigwinchGuard";
import type { ReplayInputGate } from "@kernel/terminalInputGate";
import { consumeDiskTail } from "./diskReplay";
import { resolveFreezeReplay, sessionFreezeFingerprint, takeTerminalFreeze } from "./terminalFreeze";
import { writeInChunks, type HiddenDeferControl, type LoadProgress } from "./terminalReplay";

/** 输出静默判就绪窗口:流式阶段无新字节达此时长即撤罩。 */
const QUIET_READY_MS = 500;
/** 遮罩兜底:CLI 不重绘(忽略 SIGWINCH)时最长展示时长。 */
const PROGRESS_FAILSAFE_MS = 12_000;
/** 磁盘分支:观测到清屏序列后再攒这么久,让首屏重绘一次到位,不闪半屏。 */
const DISK_FLUSH_AFTER_CLR_MS = 300;
/** 磁盘分支兜底:纯文本/REPL 型 CLI 无全屏重绘,此时长后照常放行攒队。 */
const DISK_FLUSH_FAILSAFE_MS = 30_000;
/** 隐藏幕布合帧写入节拍:非激活幕布的实时字节攒 250ms 合并写一次(与幕布
 *  askProbe 采样同拍;激活即冲刷,切换无感)。 */
const HIDDEN_FLUSH_MS = 250;

/** 回放 + 实时订阅 + 就绪探测装配;返回 cleanup(停订阅、清计时器、忽略迟到的回调)。
 *  hiddenDefer 可选:隐藏幕布合帧写入(Fix B,见 HIDDEN_FLUSH_MS 注)。
 *  onLive 可选:实时字节到达即戳(不分直写/攒队分支;幕布数据链停滞探针的
 *  活性真源,见 canvasStall.ts)。 */
export function attachTerminalStream(
  term: Pick<Terminal, "write"> & { rows?: number },
  sessionId: string,
  inputGate: ReplayInputGate,
  onProgress: (p: LoadProgress) => void,
  onReady?: () => void,
  hiddenDefer?: HiddenDeferControl,
  onLive?: () => void,
): () => void {
  let cancelled = false;
  let quietTimer: ReturnType<typeof setTimeout> | undefined;
  /* 实时字节与回放保序:回放未完成先攒队列,尽后按序补写(否则新字节插进旧内容中间)。
     攒队期间的字节同样计入流式进度。 */
  let liveQueue: string[] | null = [];
  let received = 0;
  /* 就绪锁:true 后实时字节照常写幕布,但不再触碰进度态(见 terminalReplay.ts 头注)。 */
  let ready = false;
  /* 磁盘分支:CLR 观测回调与 flush 计时(cleanup 需跨作用域清理,故提到这里);
     diskStreamPhase = 首开无尾时的流式进度阶段(攒队不放行,遮罩显示启动进度)。 */
  let diskChunkSink: ((text: string) => void) | null = null;
  let diskFlushTimer: ReturnType<typeof setTimeout> | undefined;
  let clrSeen = false;
  let diskStreamPhase = false;
  let failsafe: ReturnType<typeof setTimeout> | undefined;
  /* 启动闸:挂载即 arm,从挂载到 streamReady 期间只弃用户形态输入、放行整段
     终端协议回传 —— 回放/翻页窗同一策略(见 terminalInputGate.ts):活查询的
     应答远端正在等,启动窗与回放窗都可能接到活查询(局域网下连接先于幕布
     挂载完成时,CPR 落缓冲走回放分支,2026-09-12 白屏二轮实证)。 */
  inputGate.arm();
  /* 隐藏幕布合帧:pending 攒字节,250ms 一冲;激活冲刷入口登记给 TerminalView。 */
  let pendingHidden: string[] | null = null;
  let hiddenTimer: ReturnType<typeof setInterval> | undefined;
  const flushDeferred = (): void => {
    const queued = pendingHidden;
    if (!queued) return;
    pendingHidden = null;
    term.write(queued.join(""));
  };
  hiddenDefer?.bindFlush(flushDeferred);
  /* live 写路由:回放未完攒队保序 > 隐藏幕布合帧 > 直写。 */
  const routeLive = (out: string): void => {
    if (liveQueue) {
      liveQueue.push(out);
    } else if (hiddenDefer?.shouldDefer()) {
      pendingHidden = (pendingHidden ?? []).concat(out);
      if (!hiddenTimer) hiddenTimer = setInterval(flushDeferred, HIDDEN_FLUSH_MS);
    } else {
      term.write(out);
    }
  };
  /* SIGWINCH 舞步降级守卫:仅滤 live 路径(回放/翻页是历史字节,原样)。
     跨 keep-alive 重挂载:已注册实例优先(舞步状态不丢),否则按本幕布 rows 新建。 */
  const guard = sigwinchGuardOf(sessionId) ?? createSigwinchGuard(() => term.rows ?? 0);
  /* 舞步扣留超时奉还出口(真 alt UI 如 /model picker,见守卫头注):与实时字节
     同路保序(routeLive 三分支),keep-alive 重挂刷新绑定,cancelled 防卸载后
     fire 写已卸载幕布。 */
  guard.emit = (text: string): void => {
    if (!cancelled && text) routeLive(text);
  };
  registerSigwinchGuard(sessionId, guard);
  const offLive = host.events.on<string>(ptyLiveTopic(sessionId), (text) => {
    onLive?.();
    routeLive(guard.feed(text));
    if (liveQueue) diskChunkSink?.(text);
    received += text.length;
    if (!cancelled && !ready && (!liveQueue || diskStreamPhase)) {
      onProgress({ kind: "stream", chars: received });
      /* 磁盘首开攒队期不起静默表 —— 遮罩只随 finishDisk 撤 */
      if (!liveQueue) armQuiet();
    }
  });

  /* 就绪收口(幂等):置 ready、放输入闸、回调、撤罩。静默表与 12s 兜底都延迟到
     这里执行;冻结快照命中路径屏幕即时成立,补写完直接调用,不等静默窗。 */
  const setReady = (): void => {
    if (cancelled || ready) return;
    ready = true;
    inputGate.release();
    onReady?.();
    onProgress(null);
  };

  /* 静默判就绪:回放完后(或本无回放)输出安静 QUIET_READY_MS → 撤罩;
     每次新字节重置。无字节也起表——空缓冲空会话 0.5s 后即视为就绪。 */
  const armQuiet = (): void => {
    clearTimeout(quietTimer);
    quietTimer = setTimeout(setReady, QUIET_READY_MS);
  };

  const memoryReplay = host.getOutputBuffer(sessionId);
  const diskTail = memoryReplay ? null : consumeDiskTail(host.getCliSessionId(sessionId));
  if (memoryReplay) {
    /* 挤除冻结快照(候选2):tab 挤除卸载存过终态屏幕投影,重开且缓冲前缀完好
       → 投影同步上屏 + 卸载水位起增量补写,免遮罩免全量重写。就绪即时收口:
       幕布首帧即终态,无需静默窗;补写完成前活流照常攒队,尽后按序补写(幂等保序)。 */
    const freeze = resolveFreezeReplay(
      memoryReplay,
      host.getOutputBufferBytes(sessionId),
      takeTerminalFreeze(sessionId),
      sessionFreezeFingerprint(host.getSessions().find((s) => s.id === sessionId)),
    );
    if (freeze.mode === "fast") {
      term.write(freeze.snap.screenText);
      term.write(`\x1b[${freeze.snap.cursorY + 1};${freeze.snap.cursorX + 1}H\x1b[0m`); /* CSI H 归位快照光标(SGR 无法还原,显式复位);防活跃 TUI 相对寻址错位,详见 terminalFreeze.ts 快照字段注 */
      /* 回放字节过舞步包络剥除:buffer 存原始字节,历史舞步的 3J 会清掉刚投影出的屏(见 stripDanceEnvelopes) */
      void writeInChunks(term, stripDanceEnvelopes(freeze.incremental, term.rows ?? 0), () => undefined).then(() => {
        inputGate.release();
        if (cancelled) return;
        const pending = liveQueue ?? [];
        liveQueue = null;
        for (const text of pending) term.write(text);
        setReady();
      });
    } else {
      inputGate.arm();
      onProgress({ kind: "replay", pct: 0 });
      /* 回放字节过舞步包络剥除:buffer 存原始字节,历史舞步的 3J 会清掉刚回放出的滚动缓冲(见 stripDanceEnvelopes) */
      void writeInChunks(term, stripDanceEnvelopes(memoryReplay, term.rows ?? 0), (done, total) => {
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
    }
    host.observeReplayTail(sessionId);
  } else if (diskTail) {
    /* 磁盘先行:首开/指针缺失共用这个分支(prefetch 错配/无 cliSessionId 回落直流)。
       就绪编排与内存分支不同:回放完成只撤罩,活流继续攒队,等攒队里出现清屏序列
       (\x1b[2J——TUI 全屏重绘的通用前奏)再延 300ms 让首帧画完,一次切换——墓碑帧
       全程可见,CLI 启动期的清屏擦不出白屏。无尾时同理保持「正在连接…」遮罩。 */
    onProgress({ kind: "replay", pct: 0 });
    const flushQueuedNow = (): void => {
      const queued = liveQueue ?? [];
      liveQueue = null;
      for (const text of queued) term.write(text);
    };
    const finishDisk = (): void => {
      clearTimeout(diskFlushTimer);
      diskChunkSink = null;
      if (cancelled || ready) return; /* ready 幂等:CLR 兜底已就绪后,迟到的 30s 表不得二次 release */
      flushQueuedNow();
      ready = true;
      inputGate.release();
      onReady?.();
      onProgress(null);
    };
    void diskTail.then((page) => {
      /* ready 守卫(评审 P1-3):CLR 在未决期到达则 finishDisk 已落活帧,
         迟到的磁盘尾不得再盖回墓碑帧 */
      if (cancelled || ready) return;
      const tail = page?.text ?? "";
      if (!tail) {
        /* 首开/指针缺失:无字节可回放。保持流式进度遮罩(「正在连接…」),
           活流继续攒队,等 CLR 首帧画完一次切换;30s 兜底放行 */
        diskStreamPhase = true;
        onProgress({ kind: "stream", chars: received });
        diskFlushTimer = setTimeout(() => finishDisk(), DISK_FLUSH_FAILSAFE_MS);
        return;
      }
      inputGate.arm();
      void writeInChunks(term, stripDanceEnvelopes(tail, term.rows ?? 0), (done, total) => {
        if (!cancelled && !ready) onProgress({ kind: "replay", pct: Math.round((done / total) * 100) });
      }).then(() => {
        /* 回放尽即放闸——含 cancel 路径(闸随组件常驻,泄漏 = 该 tab 键盘永久失灵);
           放闸后活流起落期的击键照常进 PTY 管道,与既有回放窗语义一致 */
        inputGate.release();
        if (cancelled) return;
        onProgress(null); /* 撤罩:墓碑帧可见;ready/flush 留给 CLR 观测或兜底 */
        host.restoreDiskTail(sessionId, tail);
        diskFlushTimer = setTimeout(() => finishDisk(), DISK_FLUSH_FAILSAFE_MS);
      });
    });
    /* CLR 观测:滚动 8B 窗接住被 PTY 切进两个事件的清屏序列(\x1b[H\x1b[2J 组合 7B) */
    let clrWindow = "";
    diskChunkSink = (text) => {
      if (ready || clrSeen) return;
      const scan = clrWindow + text;
      if (scan.includes("\x1b[2J")) {
        clrSeen = true;
        clearTimeout(diskFlushTimer);
        diskFlushTimer = setTimeout(() => finishDisk(), DISK_FLUSH_AFTER_CLR_MS);
      } else {
        clrWindow = scan.slice(-8);
      }
    };
  } else {
    liveQueue = null;
    onProgress({ kind: "stream", chars: 0 });
    armQuiet();
  }

  /* 12s 兜底:防 CLI 不重绘导致遮罩永挂(内存回放/直流通路;磁盘编排自带 30s 兜底) */
  if (!diskTail) {
    failsafe = setTimeout(setReady, PROGRESS_FAILSAFE_MS);
  }

  return () => {
    cancelled = true;
    liveQueue = null;
    diskChunkSink = null;
    releaseSigwinchGuard(sessionId);
    hiddenDefer?.bindFlush(null);
    clearInterval(hiddenTimer);
    /* 隐藏期残留的攒帧随卸载丢弃:字节真源在 outputBuffers,重挂走回放 */
    pendingHidden = null;
    clearTimeout(quietTimer);
    clearTimeout(diskFlushTimer);
    clearTimeout(failsafe);
    /* 启动 live 闸兜底释放,严守 arm/release 配对 */
    inputGate.release();
    offLive();
  };
}
