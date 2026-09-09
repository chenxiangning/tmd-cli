/**
 * AskWatch host 接线组合件 —— 自 askWatch.ts 拆出(文件规模铁则收紧至 300 行)。
 * 承担:实时输出/回放尾巴/屏幕采样三入口馈送、SSH 跳过、升级时事件广播。
 * notify 决策收归 host(onOutput 返回升级边沿,与 activity 回绿共享单次 notify);
 * 仅计时器路径(回调里无法借道 appendOutput)在内部 notify。
 */

import { ASK_MARKER_RE } from "./askDetect";
import { AskWatch } from "./askWatchCore";

export interface AskWatchFeedCtx {
  /** 会话类型;会话不存在返回 undefined(按非 SSH 处理,与 appendOutput 原语义一致)。 */
  sessionKind(sessionId: string): string | undefined;
  /** 该会话所属 CLI 声明的 ask 卡片标记(CliProfile.askMarks);未声明返回 undefined。 */
  askMarks(sessionId: string): RegExp[] | undefined;
  /** 升级等待时广播 askDetected(提示音消费)。 */
  emitAsked(sessionId: string): void;
  /** 状态边沿重渲染(等待/候选/自愈)。 */
  notify(): void;
  /** 输出缓冲尾巴(回放补观察数据源);无缓冲返回空串。 */
  bufferTail(sessionId: string, maxChars: number): string;
}

export class AskWatchFeed {
  private readonly watch: AskWatch;

  constructor(private readonly ctx: AskWatchFeedCtx) {
    this.watch = new AskWatch(
      () => ctx.notify(),
      (sessionId) => {
        ctx.emitAsked(sessionId);
        ctx.notify();
      },
    );
  }

  /** 实时输出馈送(host.appendOutput);返回 true = 升级边沿,notify 由 host 统一。
      非 CLI 会话跳过(标记词是 CLI 面板专用;ssh/shell 等无 profile 会话不参与)。 */
  onOutput(sessionId: string, text: string, byteLength?: number): boolean {
    const kind = this.ctx.sessionKind(sessionId);
    if (kind !== undefined && kind !== "cli") return false;
    if (!this.watch.onOutput(sessionId, text, byteLength, this.ctx.askMarks(sessionId))) {
      return false;
    }
    this.ctx.emitAsked(sessionId);
    return true;
  }

  /**
   * 屏幕采样进站(TerminalView 1Hz 轮询幕布底部行,v3)。非 CLI 会话跳过。
   * 字节流检测的原理性盲区:omp 等待期间 spinner 以光标寻址持续重绘
   * (实测 3h 挂起面板后流 7.4MB、标记远在 512KB 缓冲之外),静态面板的
   * 标记一旦流出尾窗永不复现 —— 但屏幕(xterm buffer)上标记始终在。
   */
  onScreenSample(sessionId: string, screenText: string): void {
    const kind = this.ctx.sessionKind(sessionId);
    if (kind !== undefined && kind !== "cli") return;
    const present =
      ASK_MARKER_RE.test(screenText) ||
      (this.ctx.askMarks(sessionId)?.some((re) => re.test(screenText)) ?? false);
    const edge = this.watch.onScreenSample(sessionId, present);
    if (edge === "asked") this.ctx.emitAsked(sessionId);
    if (edge !== null) this.ctx.notify();
  }

  /**
   * 回放补观察(TerminalView 重挂载调用):webview 重载后 AskWatch 内存态清零,
   * 而 PTY 在 Rust 侧存活、静态 Ask 面板不再产生新输出 —— 把输出缓冲尾巴
   * 喂回检测器:面板标记仍在尾巴(视觉上还在等)→ 立候选,后续流量低迷
   * 漂移确认 1.2s 后升级(标签 + 提示音恢复);早已作答的会话尾巴无标记,零副作用。
   */
  observeReplayTail(sessionId: string): void {
    /* 已有状态(等待/候选)的会话不重复喂:重挂载频繁,复喂同一尾巴会把
       bytesIn 无谓推高并把候选漂移基线反复清零,4KB 漂移约束被架空(评审实测) */
    this.restoreTail(sessionId, this.ctx.bufferTail(sessionId, 2048));
  }

  /**
   * 尾巴恢复喂入(回放补观察 / boot 磁盘日志恢复共用)。webview 全量重载后
   * 内存态清零,而 Rust 侧 PTY 与静态 Ask 面板照常存活:面板不再产生带标记的
   * 新字节,关 tab 的会话既无屏幕采样(要挂载)也无可回放缓冲(已清空)——
   * 磁盘日志尾巴是唯一幸存证据。标记仍在尾 → 立候选,漂移确认后升级;
   * 早已作答的尾巴无标记,零副作用。extraMarks:恢复路径会话可能尚未入
   * host.sessions 表,askMarks 查不到,由调用方按 profileId 显式携带。
   */
  restoreTail(sessionId: string, tail: string, extraMarks?: RegExp[]): void {
    if (this.watch.hasState(sessionId)) return;
    /* 2048 > RAW_TAIL_CHARS(1024):喂入量大于内部尾窗,页脚语义不受影响 */
    if (tail) this.watch.onOutput(sessionId, tail, undefined, extraMarks ?? this.ctx.askMarks(sessionId));
  }

  /** 用户写入 = 作答(host.writeSession);返回 true = 状态翻转,host 据此重渲染。 */
  onUserWrite(sessionId: string): boolean {
    return this.watch.onUserWrite(sessionId);
  }

  /** 等待确认判定(会话列表「等待确认」标签)。 */
  isWaiting(sessionId: string): boolean {
    return this.watch.isWaiting(sessionId);
  }

  /** 会话移除:等待/候选/尾巴残留一并清除。 */
  onSessionRemoved(sessionId: string): void {
    this.watch.onSessionRemoved(sessionId);
  }

  /** 测试专用:假时钟换届时重置(与 resetStatusTimerForTest 同因)。 */
  resetForTest(): void {
    this.watch.resetForTest();
  }
}
