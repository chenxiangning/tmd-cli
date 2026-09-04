/**
 * Ask 等待确认守望 —— 检测 PTY 输出中「CLI 阻塞等待用户确认」的界面标记,
 * 维护每会话等待状态(会话列表「等待确认」标签的数据源)。
 *
 * 从 askSound.ts 的第二观察者形态升级而来(见 openspec/changes/add-ask-badge/design.md):
 * 标签是首类 UI 状态而非锦上添花 —— 检测移入 host.appendOutput 主链路,
 * 一次检测两处消费(askDetected 事件 → 提示音;isWaiting → 列表标签)。
 *
 * 检测三件套(与 askSound 世代等价):240 字符原始尾巴跨分片拼接 → 剥 ANSI →
 * 页脚窗口(末 5 行)内跑保守标记正则。
 *
 * 候选确认制(v2):单次命中即置位被实测证伪 —— omp 等全屏重绘 TUI 在作答后
 * 仍会整帧重发面板文本(作答残影,session 日志实测:面板帧 3 次,最后一次在
 * 作答之后),切换会话的 resume 回放/SIGWINCH 重绘也会把历史面板文本再流一遍;
 * 单次命中就复燃/错绑,等待中跳过检测 + 只认写入清除让标签卡死整个响应流。
 * 现在:首次命中只立「候选」;升级走双路 —— ① 复现确认:标记在后续帧复现
 * (常驻重绘面板)且距首击 ≥ ASK_CONFIRM_MS;② 静默确认:候选期满且页脚字面量
 * 仍守在尾巴里(omp Ask 面板画完即静默,复现永不到达,纯复现确认必然漏报)。
 * 瞬态文本(残影/回放)随流滚出页脚窗口,候选即撤销;作答残影另由写入清尾 +
 * 写后抑制窗双保险 —— 确认后不复燃,切换会话不错绑。
 *
 * 守望计时器(v2.1,1Hz 懒计时器,无等待/候选会话不空转)双职责:
 * 候选漂移确认(期满且命中后新输出 ≤4KB —— 静态面板仅状态栏细水长流也覆盖);
 * 等待期自愈(输出静默 2s 且尾巴再无面板字面量)。
 * 屏幕态通道(v3):omp 等待期间 spinner 以光标寻址持续重绘,静态面板标记流出
 * 字节尾窗后永不复现(实测 3h 挂起面板后流 7.4MB),字节流对此原理性无解;
 * TerminalView 1Hz 采样幕布底部 8 行喂 onScreenSample —— 屏幕可见标记 ⟺ 等待,
 * 消失即自愈(覆盖 CLI 未等写入自行继续)。字节流与屏幕态并集判定、互认边沿。
 *
 * 状态迁移:
 * - 立候选:空闲时标记命中(不响不亮,仅观察);
 * - 升级:候选存在,且①标记复现距首击 ≥ 确认窗,或②静默期满页脚字面量仍在,
 *   均须不在写后抑制窗内 → 等待(askDetected + 标签);
 * - 撤销:候选存在,距上次命中流出超 16KB 仍无复现 → 回到空闲;
 * - 清除:用户写入(作答,尾巴/候选一并重置)/ 静默自愈 / 会话移除。
 * 一个未回答的提问期间无论重绘多少次只触发一次;作答后的下一个提问再触发
 * (抑制窗内只延迟,面板持续重绘、窗过后即升级)。
 */

/** 计时器句柄:webview 运行时是 number,Node 测试环境是 Timeout;仅内部持有。 */
type TimerHandle = ReturnType<typeof setInterval>;

/** 通用 Ask/确认标记:跨 CLI 的选择/确认句式(y-n 提问含大小写与方括号变体、
 * Do you want 句式)。CLI 私有卡片字面量(omp/pi-tui 的 "Ask N questions"/
 * "Other (type your own)" 等)由 CliProfile.askMarks 声明 —— 内核不理解
 * CLI 私有格式(R 系铁则),私有标记属插件。
 * 选词位置原则:标记必须出现在面板的「尾部」—— 长选项会把面板头部推出
 * 尾窗(实测:omp ask 面板的 "Ask 1 questions" 头部在选项渲染后距尾窗数行,
 * 永不命中),底部字面量才稳定落在页脚窗口。 */
export const ASK_MARKER_RE =
  /[([][yY]\/[nN][)\]]|Do you want/;

/** 页脚窗口:标记只认剥 ANSI 后的末 5 行 —— 面板标题+选项区的高度上限。 */
const FOOTER_WINDOW_LINES = 5;

/** ANSI 转义序列(CSI/OSC/单字符)——ansi-regex 同款成熟模式,只剥转义不伤可读文本。 */
const ANSI_RE =
  /[\u001B\u009B][[\]()#;?]*(?:(?:(?:[a-zA-Z\d]*(?:;[-a-zA-Z\d/#&.:=?%@~_]*)?)?\u0007)|(?:(?:\d{1,4}(?:;\d{0,4})*)?[\dA-PR-TZcf-ntqry=><~]))/g;

/** 尾巴长度:覆盖标记短字面量的跨分片拼接。240 被实测证伪 —— omp 等宽面板
 *  TUI 单行可达 110-180 列(含边框/衬垫),240 字符装不下两行,面板底部字面量
 *  永远进不了页脚窗口(漏报根因之一)。1024 ≈ 宽行 TUI 的 5 行页脚窗口。 */
const RAW_TAIL_CHARS = 1024;

/** 候选确认窗:升级等待要求标记在后续帧复现且距首击不小于此值。
 *  真面板从出现到被人作答远长于此;残影/回放的瞬态文本撑不过一次输出续流。 */
const ASK_CONFIRM_MS = 1_200;

/** 候选撤销缺口:距上次标记命中流出超过此字节数仍无复现,候选撤销。
 *  按"单次脱窗即撤销"被仿真证伪 —— 整帧重绘 TUI 一帧 ~8KB,帧内流式推进时
 *  标记只在帧尾进窗,命中/脱窗逐 chunk 交替。omp 整帧 ≈8KB,16KB 容忍两次
 *  帧距;残留/回放文本一旦随流远去,16KB 内必然无复现。 */
const ASK_CANDIDATE_MAX_GAP_BYTES = 16_384;

/** 候选确认漂移上限:命中后允许累计的新输出 UTF-8 字节数(守望计时器判据)。
 *  omp 交互面板光标停住后不再重绘,标记会被 spinner/状态栏细水长流挤出尾巴
 *  —— 确认只能看流量。实测(3h 挂起面板的真实会话日志):等待期 spinner
 *  ≈10Hz×313B ≈ 3.1KB/s,首个合格 tick(≈2s)漂移 ≈6.2KB;omp 整帧 ≈8KB,
 *  16KB = 两帧余量;真实响应流 2s 内远超此值。慢速响应夹带标记的误升级面
 *  与阈值无关(由等待自愈兜底:响应结束静默 2s 且尾巴无标记即摘)。 */
const ASK_CONFIRM_MAX_DRIFT_BYTES = 16_384;

/** 写后复燃抑制:作答后此窗口内的复现不升级 —— 已答面板块会随整帧重绘在
 *  屏幕上逗留数秒(transcript 里同样含标记字面量),响应流将其推出屏幕后
 *  复现自然停止。活面板持续重绘,抑制期一过即升级(连续多问只是延迟亮标)。 */
const ASK_REARM_SUPPRESS_MS = 8_000;

/** 自愈静默阈值:等待会话输出静默超此值且尾巴无面板字面量才摘残签
 *  (与 activityWatch 的轮次静默同语义,常量各自持有以解耦)。 */
const ASK_HEAL_SILENCE_MS = 2_000;

/** 剥离 ANSI 转义,只留可读文本用于标记匹配。 */
export function stripAnsi(text: string): string {
  return text.replace(ANSI_RE, "");
}

/** 取剥 ANSI 后文本的页脚窗口(末 5 行)。 */
function footerWindow(text: string): string {
  const lines = text.split(/\r?\n/);
  return lines.slice(-FOOTER_WINDOW_LINES).join("\n");
}

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
   * 用户写入(host.writeSession 唯一调用方)= 作答,等待解除。
   * 尾巴与候选一并重置:旧提问字面量不得借写入回显的短 chunk 复燃。
   * 返回 true = 状态实际翻转,host 据此重渲染摘标签。
   */
  onUserWrite(sessionId: string): boolean {
    this.tails.delete(sessionId);
    this.candidates.delete(sessionId);
    this.lastOutputAt.delete(sessionId);
    this.screenSince.delete(sessionId); /* 作答后屏幕残影靠抑制窗挡,起算点一并清 */
    this.lastWriteAt.set(sessionId, Date.now());
    const flipped =
      this.waiting.delete(sessionId) || this.waitingByScreen.delete(sessionId);
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
      const asked: string[] = [];
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
        asked.push(id);
      }
      const healed: string[] = [];
      for (const id of [...this.waiting]) {
        if (asked.includes(id)) continue;
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

  /** 测试专用:全态归零,防跨用例残留。 */
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

/**
 * 宿主组合件(host.ts 组合,文件规模铁则拆分):AskWatch 的 host 接线 —
 * 实时输出/回放尾巴/屏幕采样三入口馈送、SSH 跳过、升级时事件广播。
 * notify 决策收归 host(onOutput 返回升级边沿,与 activity 回绿共享单次 notify);
 * 仅计时器路径(回调里无法借道 appendOutput)在内部 notify。
 */
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
      SSH 会话跳过(标记词是 CLI 面板专用)。 */
  onOutput(sessionId: string, text: string, byteLength?: number): boolean {
    if (this.ctx.sessionKind(sessionId) === "ssh") return false;
    if (!this.watch.onOutput(sessionId, text, byteLength, this.ctx.askMarks(sessionId))) {
      return false;
    }
    this.ctx.emitAsked(sessionId);
    return true;
  }

  /** 屏幕采样馈送(TerminalView 1Hz,传幕布底部行文本;命中判定含 CLI 声明标记)。
      SSH 跳过。 */
  onScreenSample(sessionId: string, screenText: string): void {
    if (this.ctx.sessionKind(sessionId) === "ssh") return;
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
    if (this.watch.hasState(sessionId)) return;
    /* 2048 > RAW_TAIL_CHARS(1024):喂入量大于内部尾窗,页脚语义不受影响 */
    const tail = this.ctx.bufferTail(sessionId, 2048);
    if (tail) this.onOutput(sessionId, tail);
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
