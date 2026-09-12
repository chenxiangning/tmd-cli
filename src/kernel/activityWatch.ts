/**
 * 活动守望 + 完成未读状态机(呼吸灯三态结算)—— 证据分级模型。
 *
 * 完整契约(不变量/闸门矩阵/事故账本)见 docs/architecture/08-session-lifecycle.md;
 * 本文件是唯一实现,UI 一律经 host 门面读取,禁止各自实现状态机。
 *
 * ## 模型
 *
 * PTY 字节没有机器可读的轮次边界,唯一可靠因果是用户写入(awaitingTurn)与已凭写入
 * 开启的在途轮次(active)。输出分片按「字母骨架 + 数字串」三级分类(仅 CLI 会话,
 * ssh/shell「输出即活动」经 noiseGated 豁免):
 *
 * - content  字母骨架首见(新词新字母)= 真实流式产出:推活动钟,可开轮;
 * - tick     骨架复现且数字串变动 = 活着的家具(elapsed 计数/时钟/token 计数,
 *            实测 omp 回合期页脚每秒跳「9s→10s」):推证据钟,不开轮;
 * - static   骨架复现且数字串相同(或骨架为空)= 死的家具(spinner 原地转、状态栏
 *            重绘,实测 omp 空闲 ≈2.8KB/s 自绘 36 帧仅 4 种骨架):只记活性时戳。
 *
 * 骨架仅取字母(\p{L}):braille spinner glyph 属符号类,数字跳动类家具(墙钟、
 * 版本号、计数器)整体不伪装内容。轮次结算(1s tick):静默 = 距最后 content/tick
 * 证据 >2s,且不被守卫扣住。守卫只保护未应答的用户写入:
 *
 *     awaiting && !answered && (
 *       静态家具 2s 内出现过        // spinner 还在转:思考期不假结算(P0 语义)
 *       || 无家具 && 写后 <120s     // 无 spinner/footer 的 CLI 思考期宽限
 *     )
 *
 * 其余闸门:首写闸(锚定前输出零语义,resume 回放/横幅不亮灯)、轮次开启闸
 * (无未应答写入且轮次已了结的新输出 = 异步噪音,不开轮不推钟)、重绘抑制窗
 * (自发 resize 后 1s 内 = SIGWINCH 整屏重绘)。未读归属锚定「最后一字节到达
 * 瞬间」是否正被查看,不看结算瞬间。
 */

/** 计时器句柄:webview 运行时是 number,Node 测试环境是 Timeout;仅内部持有。 */
type TimerHandle = ReturnType<typeof setInterval>;

/** 输出静默轮次阈值:距最后 content/tick 证据超此值即结算一轮对话。 */
const TURN_SILENCE_MS = 2_000;
/** 应答回显窗:写入后此窗内的内容分片视作输入回显/TUI 换帧,不算应答证据;
 *  模型生成类应答首帧恒晚于此窗;本地瞬时响应(/help、即时报错)可整体落在
 *  窗内 —— 不视作应答,由守卫天花板兜底结算。 */
const ANSWER_ECHO_MS = 400;
/** 家具骨架窗:每会话最近 N 个字母骨架 FIFO(实测 omp 空闲帧在 4 种骨架间循环,
 *  6 容得下页脚/标题/边框各变体;真实内容帧几乎不可能在 6 帧窗内逐字符全等复现)。 */
const IDLE_SKELETON_WINDOW = 6;
/** 重绘抑制窗:resize 后此窗口内的输出视为 SIGWINCH 整屏重绘,不进活动语义。 */
const REDRAW_SUPPRESS_MS = 1_000;
/** 未应答写入天花板:写入后此窗内不结算未应答轮次(思考期保护),到期必结算。
 *  ponytail: 120s 拍脑袋上限 —— 覆盖最慢模型 TTFB + 长思考;若出现真实 CLI
 *  静默思考超 2 分钟的案例,改成按 profile 配置。 */
const WRITE_GRACE_MS = 120_000;

/** 可见骨架:剥 ANSI 后仅留字母(任意文字体系)。spinner braille glyph、标点、
 *  空白、数字全部剔除 —— 家具帧唯一常态变化的正是这些。 */
const SKELETON_RE = /[^\p{L}]/gu;
/** 数字串:剥掉一切非数字,剩余拼接(elapsed「9s→10s」、时钟「09:59→10:00」、
 *  token「1.2k→1.3k」都在此变动;版本号等静态数字恒定)。 */
const DIGITS_RE = /\D+/gu;

/** 骨架窗条目:字母骨架 + 最近一次同骨架分片的数字串(tick/static 判据)。 */
interface SkeletonEntry {
  letters: string;
  digits: string;
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
  /** 最后 tick 帧时戳(证据钟,参与静默判定)。 */
  lastTickAt: number;
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
        lastTickAt: 0,
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

  /**
   * 用户首写 = 锚定对话,后续输出(回显/应答)按对话语义结算。
   * 终端协议回传(焦点/鼠标/查询应答)不经过此入口,见 host.writeSession。
   */
  onUserWrite(sessionId: string): void {
    const s = this.state(sessionId);
    s.anchored = true;
    s.lastWriteAt = Date.now();
    s.awaiting = true;
    s.answered = false;
    /* 新提问 = 新基线:清骨架窗,防跨轮次逐字符全等的真实输出被误判家具 */
    s.skeletons.length = 0;
  }

  /**
   * 新输出入站。返回 true = 节流窗口已开,Host 应 notify() 一次外壳刷新;
   * 未锚定会话与家具分片恒 false(灯不变;幕布渲染走 ptyLiveTopic)。
   * `visibleText` = 该分片剥 ANSI 后的可见文本(hostWatches 经 stripAnsi 馈入),
   * 供家具分类;省略 = 不参与分类(既有直调方语义不变)。
   */
  onOutput(sessionId: string, visibleText?: string): boolean {
    const s = this.sessions.get(sessionId);
    if (!s || !s.anchored) return false; // 首写闸:锚定前零语义(I1)
    const now = Date.now();
    /* 重绘抑制窗:自发 resize 后窗内 = SIGWINCH 整屏重绘,连分类副作用都免
       (骨架 FIFO 不被重绘尾行占据,I4 幂等)。 */
    if (now - s.lastResizeAt < REDRAW_SUPPRESS_MS) return false;
    if (visibleText !== undefined && this.host.noiseGated(sessionId)) {
      const kind = this.classify(s, visibleText);
      if (kind !== "content") {
        /* 家具:不推活动钟、不开轮、不通知;tick 推证据钟(static 只是被扣下)。 */
        if (kind === "tick") s.lastTickAt = now;
        return false;
      }
    }
    /* 轮次开启闸:无未应答写入且轮次已了结的新输出 = 异步噪音(I2)。tab 开关与
       闸无关;在途轮次与 awaiting 放行。 */
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

  /** 分片三级分类(副作用:首见骨架入窗;复现骨架更新数字串)。
   *  仅字母骨架为空 = 纯控制序列/braille,归 static。 */
  private classify(s: SessionWatch, visibleText: string): "content" | "tick" | "static" {
    const letters = visibleText.replace(SKELETON_RE, "");
    if (letters === "") return "static";
    const digits = visibleText.replace(DIGITS_RE, "");
    const hit = s.skeletons.find((e) => e.letters === letters);
    if (!hit) {
      s.skeletons.push({ letters, digits });
      if (s.skeletons.length > IDLE_SKELETON_WINDOW) s.skeletons.shift();
      return "content";
    }
    if (hit.digits !== digits) {
      hit.digits = digits;
      return "tick";
    }
    return "static";
  }

  private ensureWatch(): void {
    if (this.timer !== null) return;
    this.timer = setInterval(() => {
      const now = Date.now();
      let changed = false;
      for (const [id, s] of this.sessions) {
        if (!s.active) continue;
        /* 静默 = content 与 tick 证据都停 >2s;静态家具不参与(空闲页脚永续自绘)。 */
        if (now - Math.max(s.lastContentAt, s.lastTickAt) <= TURN_SILENCE_MS) continue;
        /* 未应答写入天花板(仅 CLI;ssh/shell 不守,快命令 2s 照常结算):
           写入后 WRITE_GRACE_MS 内「没等到应答」与「还在思考」字节不可分,
           统一保住 awaiting 不被假结算吞掉(真应答从此被轮次开启闸拦死);
           天花板保证 spinner 永续自绘(omp /help)与写入丢失必结算,不永挂。 */
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
