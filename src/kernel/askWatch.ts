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
 * 现在:首次命中只立「候选」;标记在后续帧复现(真面板常驻重绘必复现)且距
 * 首击 ≥ ASK_CONFIRM_MS 才升级等待。瞬态文本(残影/回放)随流滚出页脚窗口,
 * 候选即撤销 —— 确认后不复燃,切换会话不错绑。
 *
 * 结算自愈(v2.1):等待期自持静默守望(懒计时器,无等待会话不空转)——
 * 输出静默 2s 且尾巴再无面板字面量 = CLI 已自行继续,残留等待就地摘除。
 * 真面板常驻重绘持续刷新静默钟、且整帧重绘的末行必含面板字面量,不会被误清。
 * 不依赖轮次结算:未锚定会话(回放误报的高发面)同样覆盖。
 *
 * 状态迁移:
 * - 立候选:空闲时标记命中(不响不亮,仅观察);
 * - 升级:候选存在,标记复现、距首击 ≥ 确认窗、且不在写后抑制窗内
 *   → 等待(askDetected + 标签);
 * - 撤销:候选存在,距上次命中流出超 16KB 仍无复现 → 回到空闲;
 * - 清除:用户写入(作答,尾巴/候选一并重置)/ 静默自愈 / 会话移除。
 * 一个未回答的提问期间无论重绘多少次只触发一次;作答后的下一个提问再触发
 * (抑制窗内只延迟,面板持续重绘、窗过后即升级)。
 */

/** 计时器句柄:webview 运行时是 number,Node 测试环境是 Timeout;仅内部持有。 */
type TimerHandle = ReturnType<typeof setInterval>;

/** Ask/确认界面标记:保守选词(面板标题/页脚提示字面量),助手正文误报概率极低。
 * omp Ask 面板 / omp ask 工具选项尾行 / 通用选择与取消页脚 / y-n 提问(含大小写
 * 与方括号变体)/ claude 权限确认标题句式。扩展新 CLI 只需在此追加。
 * 选词位置原则:标记必须出现在面板的「尾部」—— 长选项会把面板头部推出
 * 240 字符尾窗(实测:omp ask 面板的 "Ask 1 questions" 头部在选项渲染后
 * 距尾窗数行,永不命中),底部字面量才稳定落在页脚窗口。 */
const ASK_MARKER_RE =
  /Ask \d+ questions?|Enter select\b|Esc(?: to)? cancel\b|[([][yY]\/[nN][)\]]|Do you want|Other \(type your own\)/;

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
  /** 自愈守望计时器:无等待会话时停表(不空转)。 */
  private timer: TimerHandle | null = null;

  /** onHealed:自愈摘除残签后的状态变化回调(host 注入 notify,重渲染摘标签)。 */
  constructor(private readonly onHealed?: (sessionId: string) => void) {}

  /**
   * 会话输出进站(host.appendOutput 唯一调用方)。
   * 返回 true = 候选确认升级为等待(false → true),host 据此发 askDetected 并重渲染;
   * 其余情况(立候选/撤销/等待中重绘)恒 false。等待中尾巴照常推进 —— 结算自愈
   * 要读现势尾巴判断面板字面量是否仍在。
   */
  onOutput(sessionId: string, text: string): boolean {
    const tail = this.tails.get(sessionId) ?? { rawTail: "" };
    const combined = tail.rawTail + text;
    /* 命中评估必须用截断后的尾巴:整帧 TUI 的大 chunk(可达数 KB)若照
       combined 全量评估,页脚窗口语义形同虚设(帧头部的已答面板块也会命中) */
    const updatedTail =
      combined.length > RAW_TAIL_CHARS ? combined.slice(-RAW_TAIL_CHARS) : combined;
    this.tails.set(sessionId, { rawTail: updatedTail });
    const now = Date.now();
    const bytesIn = (this.bytesIn.get(sessionId) ?? 0) + text.length;
    this.bytesIn.set(sessionId, bytesIn);
    this.lastOutputAt.set(sessionId, now);
    if (this.waiting.has(sessionId)) return false;
    const hit = ASK_MARKER_RE.test(footerWindow(stripAnsi(updatedTail)));
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
      if (now - candidate.firstHitAt < ASK_CONFIRM_MS) return false;
      const lastWrite = this.lastWriteAt.get(sessionId);
      if (lastWrite !== undefined && now - lastWrite < ASK_REARM_SUPPRESS_MS) {
        return false; /* 写后抑制窗:已答面板的残影重绘,不升级 */
      }
      this.candidates.delete(sessionId);
      this.waiting.add(sessionId);
      this.ensureHealWatch();
      return true;
    }
    this.candidates.set(sessionId, { firstHitAt: now, lastHitBytes: bytesIn });
    return false;
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
    this.lastWriteAt.set(sessionId, Date.now());
    this.stopHealWatchIfIdle();
    if (!this.waiting.delete(sessionId)) return false;
    return true;
  }

  /**
   * 自愈守望(1Hz,仅等待非空时运转):输出静默超阈值且尾巴再无面板字面量
   * = CLI 已自行继续,残留等待就地摘除。真面板常驻重绘持续刷新静默钟不会被
   * 误清;整帧重绘的末行必含面板字面量,静默挂起的真面板尾巴里仍有字面量,
   * 同样保守保留。不依赖轮次结算,未锚定会话同样覆盖。
   */
  private ensureHealWatch(): void {
    if (this.timer !== null) return;
    this.timer = setInterval(() => {
      const now = Date.now();
      const healed: string[] = [];
      for (const id of [...this.waiting]) {
        if (now - (this.lastOutputAt.get(id) ?? 0) < ASK_HEAL_SILENCE_MS) continue;
        const tail = this.tails.get(id);
        if (tail && ASK_MARKER_RE.test(footerWindow(stripAnsi(tail.rawTail)))) continue;
        this.waiting.delete(id);
        this.tails.delete(id);
        this.lastOutputAt.delete(id);
        healed.push(id);
      }
      this.stopHealWatchIfIdle();
      healed.forEach((id) => this.onHealed?.(id));
    }, 1000);
  }

  private stopHealWatchIfIdle(): void {
    if (this.waiting.size === 0 && this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** 会话移除:等待/候选/尾巴残留一并清除。 */
  onSessionRemoved(sessionId: string): void {
    this.tails.delete(sessionId);
    this.candidates.delete(sessionId);
    this.waiting.delete(sessionId);
    this.lastOutputAt.delete(sessionId);
    this.bytesIn.delete(sessionId);
    this.lastWriteAt.delete(sessionId);
    this.stopHealWatchIfIdle();
  }

  /** 等待确认判定(会话列表「等待确认」标签)。 */
  isWaiting(sessionId: string): boolean {
    return this.waiting.has(sessionId);
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
    this.lastWriteAt.clear();
  }
}
