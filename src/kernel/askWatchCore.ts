/**
 * AskWatch 检测核心 —— 自 askWatch.ts 拆出(文件规模铁则收紧至 300 行)。
 * 承担:每会话等待状态机(候选确认制 v2 + 守望计时器 v2.1 + 屏幕态通道 v3)。
 * 检测原语/阈值在 askDetect.ts;host 接线(AskWatchFeed)在 askWatchFeed.ts;
 * 机制总述文档留在入口 askWatch.ts。
 *
 * 状态迁移:
 * - 立候选:空闲时标记命中(不响不亮,仅观察);
 * - 升级:候选存在,且①标记复现距首击 ≥ 确认窗,或②静默期满页脚字面量仍在,
 *   均须不在写后抑制窗内 → 等待(askDetected + 标签);
 * - 撤销:候选存在,距上次命中流出超 16KB 仍无复现 → 回到空闲;
 * - 清除:用户写入(作答,尾巴/候选一并重置)/ 静默自愈 / 会话移除。
 * 一个未回答的提问期间无论重绘多少次只触发一次;作答后的下一个提问再触发
 * (抑制窗内只延迟;omp 静态面板字节候选会被漂移先行撤销,由屏幕通道窗后兜底)。
 */

import {
  ASK_CANDIDATE_MAX_GAP_BYTES,
  ASK_CONFIRM_MAX_DRIFT_BYTES,
  ASK_CONFIRM_MS,
  ASK_HEAL_SILENCE_MS,
  ASK_MARKER_RE,
  ASK_REARM_SUPPRESS_MS,
  RAW_TAIL_CHARS,
  footerWindow,
  stripAnsi,
} from "./askDetect";

/** 计时器句柄:webview 运行时是 number,Node 测试环境是 Timeout;仅内部持有。 */
type TimerHandle = ReturnType<typeof setInterval>;

/** 每会话检测状态:原始尾巴(跨分片拼接)。 */
interface AskTail {
  rawTail: string;
}

/** 候选:首次命中时刻 + 最近命中时的累计输出字节(缺口撤销用)。 */
interface AskCandidate {
  firstHitAt: number;
  lastHitBytes: number;
}

export class AskWatch {
  private readonly tails = new Map<string, AskTail>();
  /** 正等待用户确认的会话集合:纯内存态,随 PTY 消亡。 */
  private readonly waiting = new Set<string>();
  /** 候选观察期:已命中一次、待标记复现确认的会话。 */
  private readonly candidates = new Map<string, AskCandidate>();
  /** 每会话最近输出时刻:等待期静默判定(自愈)用。 */
  private readonly lastOutputAt = new Map<string, number>();
  /** 每会话累计输出字节:候选缺口撤销的度量。 */
  private readonly bytesIn = new Map<string, number>();
  /** 每会话最近写入时刻:写后复燃抑制窗用。 */
  private readonly lastWriteAt = new Map<string, number>();
  /** 守望计时器:候选静默确认 + 等待自愈;无等待且无候选时停表(不空转)。 */
  private timer: TimerHandle | null = null;
  /** 屏幕态通道:幕布采样到面板标记的连续在场起始时刻(v3,见 onScreenSample)。 */
  private readonly screenSince = new Map<string, number>();
  /** 屏幕态置位的等待集合:与字节流 waiting 并集判定,自愈互认。 */
  private readonly waitingByScreen = new Set<string>();
  /** 每会话的 CLI 声明标记(CliProfile.askMarks,feed 随首帧输出注入);
      计时器/自愈路径无处取 profile,按会话留存。 */
  private readonly marksBySession = new Map<string, RegExp[]>();

  /** onHealed:自愈摘除残签后的状态变化回调(host 注入 notify,重渲染摘标签)。
   *  onAsked:守望计时器静默确认升级回调(host 注入 askDetected 广播 + notify);
   *  onOutput 复现路径的升级由其返回值同步上报,不经此回调。 */
  constructor(
    private readonly onHealed?: (sessionId: string) => void,
    private readonly onAsked?: (sessionId: string) => void,
  ) {}

  /**
   * 会话输出进站(host.appendOutput 唯一调用方)。
   * 返回 true = 候选确认升级为等待(false → true),host 据此发 askDetected 并重渲染;
   * 其余情况(立候选/撤销/等待中重绘)恒 false。等待中尾巴照常推进 —— 结算自愈
   * 要读现势尾巴判断面板字面量是否仍在。
   * byteLength:chunk 的 UTF-8 字节数(host 侧 OutputBufferStore 编码顺手产出);
   * 漂移阈值是字节语义,CJK 状态栏按 chars 计量会偏松 3 倍(评审实测)。
   */
  onOutput(
    sessionId: string,
    text: string,
    byteLength = text.length,
    extraMarks?: RegExp[],
  ): boolean {
    const tail = this.tails.get(sessionId) ?? { rawTail: "" };
    const combined = tail.rawTail + text;
    /* 命中评估必须用截断后的尾巴:整帧 TUI 的大 chunk(可达数 KB)若照
       combined 全量评估,页脚窗口语义形同虚设(帧头部的已答面板块也会命中) */
    const updatedTail =
      combined.length > RAW_TAIL_CHARS ? combined.slice(-RAW_TAIL_CHARS) : combined;
    this.tails.set(sessionId, { rawTail: updatedTail });
    const now = Date.now();
    const bytesIn = (this.bytesIn.get(sessionId) ?? 0) + byteLength;
    this.bytesIn.set(sessionId, bytesIn);
    this.lastOutputAt.set(sessionId, now);
    if (this.waiting.has(sessionId)) return false;
    if (extraMarks) this.marksBySession.set(sessionId, extraMarks);
    const hit = this.markerHit(sessionId, footerWindow(stripAnsi(updatedTail)));
    const candidate = this.candidates.get(sessionId);
    if (!hit) {
      /* 标记滚出页脚窗口:按字节缺口撤销(整帧重绘 TUI 帧内交替命中/脱窗属常态),
         缺口超限 = 标记确已随流远去(残留/回放/响应体),候选撤销 */
      if (candidate && bytesIn - candidate.lastHitBytes > ASK_CANDIDATE_MAX_GAP_BYTES) {
        this.candidates.delete(sessionId);
      }
      return false;
    }
    if (candidate) {
      this.candidates.set(sessionId, { ...candidate, lastHitBytes: bytesIn });
      this.ensureWatch();
      if (now - candidate.firstHitAt < ASK_CONFIRM_MS) return false;
      const lastWrite = this.lastWriteAt.get(sessionId);
      if (lastWrite !== undefined && now - lastWrite < ASK_REARM_SUPPRESS_MS) {
        return false; /* 写后抑制窗:已答面板的残影重绘,不升级 */
      }
      this.candidates.delete(sessionId);
      this.waiting.add(sessionId);
      this.ensureWatch();
      return true;
    }
    this.candidates.set(sessionId, { firstHitAt: now, lastHitBytes: bytesIn });
    this.ensureWatch();
    return false;
  }

  /**
   * 屏幕采样进站(TerminalView 1Hz 轮询幕布底部行,v3)。
   * 字节流检测的原理性盲区:omp 等待期间 spinner 以光标寻址持续重绘
   * (实测 3h 挂起面板后流 7.4MB、标记远在 512KB 缓冲之外),静态面板的
   * 标记一旦流出尾窗永不复现 —— 但屏幕(xterm buffer)上标记始终在。
   * 语义:屏幕上可见面板标记 ⟺ 等待用户确认。防抖:连续在场 ≥ASK_CONFIRM_MS
   * 才置位;消失即摘(自愈,覆盖 CLI 未等写入自行继续的场景)。
   * 返回 "asked"(false→true 升级)/ "healed"(摘除)/ null(无迁移)。
   */
  onScreenSample(sessionId: string, present: boolean): "asked" | "healed" | null {
    const now = Date.now();
    if (!present) {
      this.screenSince.delete(sessionId);
      const healed =
        this.waitingByScreen.delete(sessionId) || this.waiting.delete(sessionId);
      this.stopWatchIfIdle();
      return healed ? "healed" : null;
    }
    if (this.waiting.has(sessionId) || this.waitingByScreen.has(sessionId)) {
      return null; /* 已置位:字节流与屏幕态互认,不重复发边沿 */
    }
    /* 写后抑制窗:作答残影仍在屏幕上逗留数秒,不置位不记起算 */
    const lastWrite = this.lastWriteAt.get(sessionId);
    if (lastWrite !== undefined && now - lastWrite < ASK_REARM_SUPPRESS_MS) {
      return null;
    }
    const since = this.screenSince.get(sessionId);
    if (since === undefined) {
      this.screenSince.set(sessionId, now);
      return null;
    }
    if (now - since < ASK_CONFIRM_MS) return null;
    this.waitingByScreen.add(sessionId);
    this.ensureWatch(); /* 等待非空:保持计时器运转以支撑自愈互认 */
    return "asked";
  }

  /**
   * 用户写入(仅非 synthetic 真实击键)= 作答:尾巴/候选/屏幕起算一并重置。
   * 仅真作答(写入时确有等待态)才上 8s 写后闸;普通发消息后是新提问非残影(实测根因)。
   */
  onUserWrite(sessionId: string): boolean {
    const answered =
      this.waiting.has(sessionId) ||
      this.waitingByScreen.has(sessionId) ||
      this.candidates.has(sessionId) ||
      this.screenSince.has(sessionId);
    this.tails.delete(sessionId);
    this.candidates.delete(sessionId);
    this.lastOutputAt.delete(sessionId);
    this.screenSince.delete(sessionId);
    if (answered) this.lastWriteAt.set(sessionId, Date.now());
    const flipped = this.waiting.delete(sessionId) || this.waitingByScreen.delete(sessionId);
    this.stopWatchIfIdle();
    return flipped;
  }

  /**
   * 守望计时器(1Hz,等待或候选非空时运转)双职责:
   * ① 候选漂移确认:期满(≥ASK_CONFIRM_MS)且命中后累计新输出 ≤
   *   ASK_CONFIRM_MAX_DRIFT_BYTES = 面板静态驻留、仅状态栏/spinner 细水长流
   *   (omp Ask 面板光标停住后不再重绘,标记早被后台输出挤出 1024 尾巴,
   *   「标记仍在尾巴」判定在此场景必然漏报 —— 实测根因);真实响应流 1.2s 内
   *   远超半帧 TUI,漂移超阈即就地撤销候选(标记确已随流远去)。
   *   写后抑制窗内的残影不升级(作答后的复燃双保险之一,另一是写入清尾)。
   * ② 等待自愈:输出静默超阈值且尾巴再无面板字面量 = CLI 已自行继续,残留等待
   *   就地摘除。真面板常驻重绘持续刷新静默钟不会被误清;整帧重绘的末行必含面板
   *   字面量,静默挂起的真面板尾巴里仍有字面量,同样保守保留。
   * 不依赖轮次结算,未锚定会话同样覆盖。
   */
  private ensureWatch(): void {
    if (this.timer !== null) return;
    this.timer = setInterval(() => {
      const now = Date.now();
      const asked = new Set<string>();
      for (const [id, candidate] of [...this.candidates]) {
        /* 漂移超阈 = 标记已被实质输出推走(回放/响应体),候选就地撤销;
           撤销后 onOutput 的字节缺口路径不再持有引用,无需二次清理 */
        const drift = (this.bytesIn.get(id) ?? 0) - candidate.lastHitBytes;
        if (drift > ASK_CONFIRM_MAX_DRIFT_BYTES) {
          this.candidates.delete(id);
          continue;
        }
        if (now - candidate.firstHitAt < ASK_CONFIRM_MS) continue;
        const lastWrite = this.lastWriteAt.get(id);
        if (lastWrite !== undefined && now - lastWrite < ASK_REARM_SUPPRESS_MS) {
          continue;
        }
        this.candidates.delete(id);
        this.waiting.add(id);
        asked.add(id);
      }
      const healed: string[] = [];
      for (const id of [...this.waiting]) {
        if (asked.has(id)) continue;
        if (now - (this.lastOutputAt.get(id) ?? 0) < ASK_HEAL_SILENCE_MS) continue;
        const tail = this.tails.get(id);
        if (tail && this.markerHit(id, footerWindow(stripAnsi(tail.rawTail)))) continue;
        this.waiting.delete(id);
        this.tails.delete(id);
        this.lastOutputAt.delete(id);
        healed.push(id);
      }
      this.stopWatchIfIdle();
      asked.forEach((id) => this.onAsked?.(id));
      healed.forEach((id) => this.onHealed?.(id));
    }, 1000);
  }

  private stopWatchIfIdle(): void {
    if (
      this.waiting.size === 0 &&
      this.waitingByScreen.size === 0 &&
      this.candidates.size === 0 &&
      this.timer !== null
    ) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** 标记命中判定:内核通用标记 ∪ 该会话的 CLI 声明标记(askMarks)。 */
  private markerHit(sessionId: string, text: string): boolean {
    if (ASK_MARKER_RE.test(text)) return true;
    return this.marksBySession.get(sessionId)?.some((re) => re.test(text)) ?? false;
  }

  /** 会话移除:等待/候选/尾巴残留一并清除。 */
  onSessionRemoved(sessionId: string): void {
    this.tails.delete(sessionId);
    this.candidates.delete(sessionId);
    this.waiting.delete(sessionId);
    this.waitingByScreen.delete(sessionId);
    this.screenSince.delete(sessionId);
    this.lastOutputAt.delete(sessionId);
    this.bytesIn.delete(sessionId);
    this.lastWriteAt.delete(sessionId);
    this.marksBySession.delete(sessionId);
    this.stopWatchIfIdle();
  }

  /** 等待确认判定(会话列表「等待确认」标签;字节流与屏幕态并集)。 */
  isWaiting(sessionId: string): boolean {
    return this.waiting.has(sessionId) || this.waitingByScreen.has(sessionId);
  }

  /** 测试专用:全态归零,防跨用例残留(含写后闸时刻:用例 id 复用 + 假时钟回拨会让上用例抑制窗变永久闸)。 */
  resetForTest(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.tails.clear();
    this.candidates.clear();
    this.waiting.clear();
    this.lastOutputAt.clear();
    this.bytesIn.clear();
    this.lastWriteAt.clear();
    this.waitingByScreen.clear();
    this.screenSince.clear();
    this.marksBySession.clear();
  }

  /** 是否已有任何检测态(等待/屏幕等待/候选):回放补观察的短路判据。 */
  hasState(sessionId: string): boolean {
    return (
      this.waiting.has(sessionId) ||
      this.waitingByScreen.has(sessionId) ||
      this.candidates.has(sessionId)
    );
  }
}
