/**
 * 活动守望 + 完成未读状态机(呼吸灯三态结算)—— 证据分级模型。
 * 完整契约(不变量/闸门矩阵/事故账本)见 docs/architecture/08-session-lifecycle.md。
 *
 * PTY 字节无机器可读轮次边界,可靠因果只有用户写入(awaiting)与在途轮次(active)。
 * 输出分片按「字母骨架 + 数字串」三级分类(仅 CLI;ssh/shell 经 noiseGated 豁免):
 * - content 骨架首见 = 真实流式产出:推活动钟,可开轮;
 * - tick    骨架复现且数字变动 = 活家具:不开轮;轮次在途时观测到跳动即登记该骨架为 ticker(持轮家具),此后其一切复现帧刷新帧钟;
 * - static  骨架复现数字相同(或骨架空)= 死家具:不推钟,仅续已登记 ticker 的帧钟。
 *
 * 结算(1s tick):静默 = content 钟出 2s 窗且 ticker 帧钟出 TICKER_HOLD_MS 窗。
 * 持轮 = 帧流连续性而非数字变动(omp 页脚过 60s 从秒切分钟粒度,2s 窗必假结算;
 * 工作页脚自绘 ≈2.5-10Hz,完工换装帧流即断)。
 * busyMarks(插件声明的工作界面标记,hostWatches 馈入):CLI 自证在途,刷自证钟
 * (30s)持轮 —— 实采实证(2026-09-13 回放)流式期页脚与内容混片致骨架永远唯一、
 * ticker 永不登记,>2s 流式间隙即假结算且闸 4 拦死不自愈;深思期页脚重绘稀疏
 * (标记帧间隔 >5s)5s 窗也盖不住;工作间隙与空闲页脚字节同构,纯字节流无法两全。
 * ticker 登记限轮次在途,已结算轮永不自愈重燃(I2);busy 同构:awaiting 期 = 应答开始
 * (开轮 + answered,天花板让位)。新骨架接活 ticker 帧流 5s 内且字母近似
 * (skeletonNear)= 粒度换字(59s→1m)继承资格;完工换装不继承。
 * 守卫 = 未应答写入天花板(awaiting && !answered && 距写入 <120s)。其余闸门:首写闸、轮次开启闸、重绘抑制窗。未读归属锚定「最后 content 帧瞬间」查看态。
 */
import { skeletonNear } from "./skeletonNear";

/** 计时器句柄:webview 运行时是 number,Node 测试环境是 Timeout;仅内部持有。 */
type TimerHandle = ReturnType<typeof setInterval>;

/** 输出静默轮次阈值:距最后 content 证据超此值即结算(无存活 ticker 帧流时)。 */
const TURN_SILENCE_MS = 2_000;
/** 持轮家具帧流窗:ticker 帧断供超此值失去持轮(工作页脚自绘 ≈2.5-10Hz,完工换装即断;ponytail: 5s 含合包余量)。 */
const TICKER_HOLD_MS = 5_000;
/** CLI 自证持轮窗:busyMarks 标记帧断供超此值失去持轮。深思期页脚重绘稀疏(reasoning 慢流段标记帧间隔 >5s,实采 2026-09-13),5s 帧窗盖不住;自证可信度高取宽窗,完工换装后 30s 结算(分钟级轮次无感)。 */
const BUSY_HOLD_MS = 30_000;
/** 应答回显窗:写入后此窗内的内容分片视作输入回显/TUI 换帧,不算应答证据;模型生成类应答首帧恒晚于此窗;本地瞬时响应(/help、即时报错)可整体落在窗内 —— 由守卫天花板兜底结算。 */
const ANSWER_ECHO_MS = 400;
/** 家具骨架窗:每会话最近 N 个字母骨架 FIFO(实测 omp 空闲帧在 4 种骨架间循环,6 容得下页脚/标题/边框各变体)。 */
const IDLE_SKELETON_WINDOW = 6;
/** 重绘抑制窗:resize 后此窗口内的输出视为 SIGWINCH 整屏重绘,不进活动语义。 */
const REDRAW_SUPPRESS_MS = 1_000;
/** 未应答写入天花板:写入后此窗内不结算未应答轮次(思考期保护),到期必结算。ponytail: 120s 拍脑袋上限 —— 覆盖最慢模型 TTFB + 长思考;若出现真实 CLI 静默思考超 2 分钟的案例,改成按 profile 配置。 */
const WRITE_GRACE_MS = 120_000;

/** 可见骨架:剥 ANSI 后仅留字母(任意文字体系);spinner braille glyph、标点、空白、数字全部剔除 —— 家具帧唯一常态变化的正是这些。 */
const SKELETON_RE = /[^\p{L}]/gu;
/** 数字串:剥掉一切非数字,剩余拼接(elapsed「9s→10s」、时钟「09:59→10:00」、token「1.2k→1.3k」都在此变动;版本号等静态数字恒定)。 */
const DIGITS_RE = /\D+/gu;

/** 骨架窗条目:字母骨架 + 最近数字串(tick/static 判据)+ ticker 登记位。 */
interface SkeletonEntry {
  letters: string;
  digits: string;
  /** 轮次在途时被观测到数字跳动过(或粒度换字继承)= 活家具;复现帧刷新帧钟。 */
  ticker: boolean;
}

/** 每会话守望状态(单对象持有,随 PTY 消亡)。 */
interface SessionWatch {
  /** 已锚定对话(用户首写起,PTY 寿命级)。 */
  anchored: boolean;
  /** 在途轮次:输出进站起,结算止。 */
  active: boolean;
  /** 未应答的用户写入:首写置位,本轮结算清除。 */
  awaiting: boolean;
  /** 写后是否见过回显窗外内容分片(应答证据)。 */
  answered: boolean;
  /** 完成未读。 */
  unread: boolean;
  /** 最后 content 帧时戳(活动钟,呼吸灯)。 */
  lastContentAt: number;
  /** ticker 骨架最近帧时戳(帧钟:活家具断供 = 完工换装;新提问清零)。 */
  lastTickerAt: number;
  /** busyMarks 标记帧最近时戳(自证钟:CLI 声明的在途界面标记;新提问清零)。 */
  lastBusyAt: number;
  /** 最后用户写入时戳(回显窗与未应答天花板起点)。 */
  lastWriteAt: number;
  /** 最后 content 帧瞬间是否正被查看(未读归因)。 */
  lastOutputViewed: boolean;
  /** 呼吸灯 notify 节流(500ms 最多一次外壳重渲染)。 */
  lastNotifyAt: number;
  /** 最近一次自发 resize 时戳(重绘抑制窗起点)。 */
  lastResizeAt: number;
  /** 最近字母骨架 FIFO(家具判据)。 */
  skeletons: SkeletonEntry[];
}

/** Host 侧能力注入:守望只依赖这五个谓词/回调,不反向耦合 Host。 */
interface ActivityWatchHost {
  /** 会话是否正被查看(结算归因)。 */
  isViewing(sessionId: string): boolean;
  /** 会话是否仍存在(结算时防幽灵标未读)。 */
  exists(sessionId: string): boolean;
  /** 是否受轮次开启闸/家具分类约束(CLI 会话 true;ssh/shell「输出即活动」false)。 */
  noiseGated(sessionId: string): boolean;
  /** 状态变化通知(外壳重渲染)。 */
  onChange(): void;
  /** 一轮对话结算(结束提示音/checkpoints 封口/本地插件对话即变消费)。 */
  onTurnSettled(sessionId: string, unviewed: boolean, at: number): void;
}

export class ActivityWatch {
  /** 活动守望计时器:无进行中轮次时停表(0 轮次不空转)。 */
  private timer: TimerHandle | null = null;
  /** 每会话状态。 */
  private readonly sessions = new Map<string, SessionWatch>();

  constructor(private readonly host: ActivityWatchHost) {}
  /** 取会话状态,惰性建档(首写/resize 前不占内存;PTY 消亡整体清除)。 */
  private state(sessionId: string): SessionWatch {
    let s = this.sessions.get(sessionId);
    if (!s) {
      s = {
        anchored: false,
        active: false,
        awaiting: false,
        answered: false,
        unread: false,
        lastContentAt: 0,
        lastTickerAt: 0,
        lastBusyAt: 0,
        lastWriteAt: 0,
        lastOutputViewed: false,
        lastNotifyAt: 0,
        lastResizeAt: 0,
        skeletons: [],
      };
      this.sessions.set(sessionId, s);
    }
    return s;
  }

  /** 用户首写 = 锚定对话,后续输出(回显/应答)按对话语义结算。终端协议回传(焦点/鼠标/查询应答)不经过此入口,见 host.writeSession。 */
  onUserWrite(sessionId: string): void {
    const s = this.state(sessionId);
    s.anchored = true;
    s.lastWriteAt = Date.now();
    s.awaiting = true;
    s.answered = false;
    /* 新提问 = 新基线:清骨架窗与帧钟,防跨轮次逐字符全等的真实输出被误判家具,
       也防上一轮活家具的 ticker 登记残留吊住本轮结算。 */
    s.skeletons.length = 0;
    s.lastTickerAt = 0;
    s.lastBusyAt = 0;
  }

  /** 新输出入站。返回 true = 节流窗已开或轮次开启,Host 应 notify() 一次;未锚定会话与家具分片恒 false(幕布渲染走 ptyLiveTopic)。`visibleText` = 分片剥 ANSI 后可见文本(供家具分类);`busy` = 插件声明的工作界面标记行级命中(CLI 自证在途)。 */
  onOutput(sessionId: string, visibleText?: string, busy = false): boolean {
    const s = this.sessions.get(sessionId);
    if (!s || !s.anchored) return false; // 首写闸:锚定前零语义(I1)
    const now = Date.now();
    /* 重绘抑制窗:自发 resize 后窗内 = SIGWINCH 整屏重绘,连分类副作用都免
       (骨架 FIFO 不被重绘尾行占据,I4 幂等)。 */
    if (now - s.lastResizeAt < REDRAW_SUPPRESS_MS) return false;
    if (busy && (s.active || s.awaiting)) {
      /* busy 帧 = CLI 自证在途:刷自证钟持轮(深思期页脚稀疏,窗宽 30s);awaiting 期即
         应答开始(开轮,天花板让位;工作页脚是响应界面非输入回显,answered 无条件置位);
         已结算轮不重燃(闸 4 同构)。 */
      s.answered = true;
      s.lastBusyAt = now;
      this.ensureWatch();
      if (s.awaiting) {
        s.active = true;
        s.unread = false;
        s.lastOutputViewed = this.host.isViewing(sessionId);
        /* 纯 busy 轮次(零文本输出只画页脚)活动钟为 0 会被派生层判 none,开轮即推一次(有过 content 的轮次不动,归因不污染)。 */
        if (s.lastContentAt === 0) s.lastContentAt = now;
        s.lastNotifyAt = now;
        return true; // 开轮即通知:纯 busy 分片后续分类判 static 会提前 return 丢通知
      }
    }
    if (visibleText !== undefined && this.host.noiseGated(sessionId)) {
      const kind = this.classify(s, visibleText, now);
      /* 家具:不推活动钟、不开轮、不通知;帧钟由 classify 就地维护(tick 登记/续命,static 仅续已登记 ticker 的命)。 */
      if (kind !== "content") return false;
    }
    /* 轮次开启闸:无未应答写入且轮次已了结的新输出 = 异步噪音(I2);在途轮次与 awaiting 放行。 */
    if (!s.active && !s.awaiting && this.host.noiseGated(sessionId)) return false;
    /* 回显窗外的内容分片 = 应答证据。 */
    if (now - s.lastWriteAt > ANSWER_ECHO_MS) s.answered = true;
    s.lastContentAt = now;
    s.lastOutputViewed = this.host.isViewing(sessionId);
    s.active = true;
    s.unread = false;
    this.ensureWatch();
    if (now - s.lastNotifyAt > 500) {
      s.lastNotifyAt = now;
      return true;
    }
    return false;
  }

  /** 自发 resize 入站(host.resizeSession 唯一调用方):开重绘抑制窗。 */
  onResized(sessionId: string): void {
    this.state(sessionId).lastResizeAt = Date.now();
  }

  /** 完成未读判定(会话列表蓝呼吸灯)。 */
  isUnread(sessionId: string): boolean {
    return this.sessions.get(sessionId)?.unread ?? false;
  }
  /** 对话轮次进行中判定(输出进站起,静默超阈结算止)。 */
  isTurnActive(sessionId: string): boolean {
    return this.sessions.get(sessionId)?.active ?? false;
  }

  /** 点开查看 = 已读(蓝 → 灰)。 */
  markViewed(sessionId: string): void {
    const s = this.sessions.get(sessionId);
    if (s) s.unread = false;
  }

  /** 会话最近输出时间戳(无输出为 0;未锚定会话不推进,灯恒灰)。 */
  lastActivityAt(sessionId: string): number {
    return this.sessions.get(sessionId)?.lastContentAt ?? 0;
  }

  /** 会话移除:状态对象整体清除;无可守望即停表。 */
  onSessionRemoved(sessionId: string): void {
    this.sessions.delete(sessionId);
    this.stopIfIdle();
  }

  /** 测试专用:假时钟换届时重置守望(清柄 + 全态归零,防跨用例残留)。 */
  resetForTest(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.sessions.clear();
  }

  /** 分片三级分类(副作用:首见骨架入窗;复现骨架更新数字串;活家具帧钟维护)。仅字母骨架为空 = 纯控制序列/braille,归 static;ticker 登记限轮次在途;新骨架接活 ticker 帧流 TICKER_HOLD_MS 内且字母近似 = 粒度换字,继承资格。 */
  private classify(s: SessionWatch, visibleText: string, now: number): "content" | "tick" | "static" {
    const letters = visibleText.replace(SKELETON_RE, "");
    if (letters === "") return "static";
    const digits = visibleText.replace(DIGITS_RE, "");
    const hit = s.skeletons.find((e) => e.letters === letters);
    if (!hit) {
      const chain =
        s.active &&
        now - s.lastTickerAt <= TICKER_HOLD_MS &&
        s.skeletons.some((e) => e.ticker && skeletonNear(e.letters, letters));
      s.skeletons.push({ letters, digits, ticker: chain });
      if (s.skeletons.length > IDLE_SKELETON_WINDOW) s.skeletons.shift();
      return "content";
    }
    const changed = hit.digits !== digits;
    if (changed) {
      hit.digits = digits;
      if (s.active) hit.ticker = true;
    }
    if (hit.ticker) s.lastTickerAt = now;
    return changed ? "tick" : "static";
  }

  private ensureWatch(): void {
    if (this.timer !== null) return;
    this.timer = setInterval(() => {
      const now = Date.now();
      let changed = false;
      for (const [id, s] of this.sessions) {
        if (!s.active) continue;
        /* 静默 = content 钟出 2s 窗且 ticker 帧钟出持轮窗且 busy 自证钟出 30s 窗(未登记骨架与死家具不参与;omp 页脚过 60s 切分钟粒度,靠帧流持轮,数字不跳不得假结算)。 */
        if (
          now - s.lastContentAt <= TURN_SILENCE_MS ||
          (s.lastTickerAt !== 0 && now - s.lastTickerAt <= TICKER_HOLD_MS) ||
          (s.lastBusyAt !== 0 && now - s.lastBusyAt <= BUSY_HOLD_MS)
        )
          continue;
        /* 未应答写入天花板(仅 CLI;ssh/shell 不守,快命令 2s 照常结算):写入后 WRITE_GRACE_MS 内「没等到应答」与「还在思考」字节不可分,统一保住 awaiting 不被假结算吞掉(真应答从此被轮次开启闸拦死);天花板保证 spinner 永续自绘(omp /help)与写入丢失必结算,不永挂。 */
        if (
          this.host.noiseGated(id) &&
          s.awaiting &&
          !s.answered &&
          now - s.lastWriteAt < WRITE_GRACE_MS
        )
          continue;
        s.active = false;
        s.awaiting = false; // 本轮结算 = 应答了此前写入
        const unviewed =
          !this.host.isViewing(id) && !s.lastOutputViewed && this.host.exists(id);
        if (unviewed) s.unread = true;
        this.host.onTurnSettled(id, unviewed, s.lastContentAt);
        changed = true;
      }
      this.stopIfIdle();
      if (changed) this.host.onChange();
    }, 1000);
  }

  private stopIfIdle(): void {
    if (this.timer === null) return;
    for (const s of this.sessions.values()) {
      if (s.active) return;
    }
    clearInterval(this.timer);
    this.timer = null;
  }
}
