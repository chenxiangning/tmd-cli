/**
 * 活动守望 + 完成未读状态机(呼吸灯三态结算)。
 *
 * 从 host.ts 拆出(单文件 ≤300 行铁则)。Host 组合持有;UI 只读 host.isUnread,
 * 不各自实现状态机。
 *
 * 对话锚定(首写闸):呼吸灯只认用户发起的对话。会话在用户首写前不进任何
 * 灯语义 —— 期间一切输出(spawn 横幅、历史 resume 回放、TUI 重绘、迟到的
 * 异步消息)不刷新活动钟、不进轮次、不标未读、不发 turnSettled;
 * host.writeSession 的真实用户输入(终端协议回传除外,见 terminalReports.ts)
 * 是唯一出口,锚定后会话终生有效。
 *
 * 旧版"宽限期"(spawn 入宽限,静默 2s 也出宽)被证明不准:resume 后的迟到
 * 消息 / SIGWINCH 重绘都发生在静默退出之后,无对话的历史会话照样误走绿→蓝
 * + 结束音。静默不是"用户在场"的证据,首写才是。
 *
 * 结算规则(1Hz):输出静默 >2s = 一轮对话结束;结束时未被查看(≠ activeSessionId)
 * 才标未读(蓝),正在看的会话完成不打扰;新输出回绿;点开即清(灰)。
 * 未读归属锚定「最后一字节到达瞬间」而非「结算瞬间」(2026-09-05 归因修正):
 * 亲眼看完回答、2s 检测窗内切走的会话不再误标未读;只看开头就切走的长轮次,
 * 最后一字节到达时没在看,仍正确标未读。
 * 轮次开启闸(2026-09-08 立,2026-09-11 收紧):已锚定 ≠ 任意字节都可开轮。
 * 无未应答用户写入(awaitingTurn)且轮次已了结的 CLI 会话,一切新输出不开轮 ——
 * 实证缺陷:已查看历史会话被 hook/dreamer/横幅/状态栏相对时间戳类异步字节重跑
 * 绿→蓝生命周期误标未读。初版以「tab 已关」为闸条件,但会话 tab 常驻开启
 * (老会话不清就是几天),异步字节照常绕闸 —— tab 开着 ≠ 正在查看,不构成
 * 开轮理由;开轮只认用户发起的对话(awaitingTurn)与在途轮次。在途轮次不受
 * 闸影响:关 tab 时真实未完成的任务照常推进、结算照标未读;写完即关 tab
 * (首字节迟到)经 awaitingTurn 放行。闸仅适用 CLI 会话:ssh/shell「输出即
 * 活动」是既定语义,远端长任务(如 make 静默数分钟后输出完工)必须照常开轮
 * 标未读,豁免闸门。
 *
 * 重绘抑制窗:全屏 TUI 收到 SIGWINCH 的整屏重绘(实测 omp = 560KB 突发)与
 * 「CLI 正在回答」在字节流上不可区分,但重绘必由本应用自发的 resize 触发 ——
 * host.resizeSession 记时戳,锚定会话在 resize 后 1s 窗内的输出不进活动语义。
 * 取舍:窗内恰好完整到达的短回答(<1s)会被整段吞掉漏一次提醒 —— 需要
 * 「用户正在改尺寸」与「整个回答 <1s」同时成立,概率极低;回答稍长只晚亮 1s。
 * 旧取舍(宁可保守放行)面向「无任何因果信息」时代,现已由 resize 因果取代。
 *
 * 空闲重绘闸(2026-09-11):SIGWINCH 之外的第二种重绘 —— CLI 空闲期状态栏/
 * spinner 以光标寻址持续原地自绘(实测 omp ≈2.8KB/s),照常推活动钟则轮次永不
 * 静默结算,侧栏标签永挂「运行时」、完成未读/已查看三态全部失效。判据 = 可见
 * 骨架重复:分片剥 ANSI 后仅留 \p{L}\p{N}(spinner braille glyph 与标点被排除),
 * 原地重绘的骨架在会话内恒定复现(实测空闲 36 帧仅 4 种骨架),真实输出每帧
 * 引入新字符(流式续字、计时 tick)。轮次进行中同样适用:回答由内容帧推钟,
 * 穿插的重复自绘帧不再吊住结算。长静默工具调用若只重绘恒定页脚,标签会提前
 * 翻「会话结束」;守卫只覆盖首问思考期,首答之后的此类轮中静默仍会提前翻
 * 结束且恢复需用户新写入(轮次开启闸既有限制),见思考期守卫段。
 * 思考期守卫(2026-09-11,P0 回归):空闲重绘闸使 spinner 自绘期 = 活动静默,
 * 而 omp 思考期唯一开轮输出是用户回显 —— 2s 假结算吞 awaitingTurn,真实应答
 * 从此被轮次开启闸永久拦截,标签卡死「会话结束-已查看」。守卫:结算时若仍无
 * 「回显窗外的内容分片」(写入后 400ms 内 = 回显/换帧,不算应答),跳过结算、
 * 保留轮次;真实应答到达后照常结算,结算后噪音闸不受影响。spinner 活性界:
 * 自绘分片停歇 >2s 不再豁免 —— 即时报错后归静默的 TUI 照常结算,不永挂运行时。
 */

/** 计时器句柄:webview 运行时是 number,Node 测试环境是 Timeout;仅内部持有。 */
type TimerHandle = ReturnType<typeof setInterval>;

/** 输出静默轮次阈值:静默超此值即结算一轮对话。 */
const TURN_SILENCE_MS = 2_000;
/** 应答回显窗:写入后此窗内的内容分片视作输入回显/TUI 换帧,不算应答证据
 *  (思考期守卫判据,见文件头);真实应答首帧因模型 TTFB 恒晚于此窗。 */
const ANSWER_ECHO_MS = 400;

/** 空闲重绘判定:每会话最近 N 个非空可见骨架的 FIFO(实测 omp 空闲帧在 4 种
 *  骨架间循环,6 容得下页脚/标题/边框各变体;真实内容帧几乎不可能在 6 帧窗内
 *  逐字符全等复现)。 */
const IDLE_SKELETON_WINDOW = 6;

/** 可见骨架:剥 ANSI 后仅留字母/数字(任意文字体系),剔除 spinner braille
 *  glyph、标点、空白 —— 原地重绘帧唯一变化的正是这些。 */
const SKELETON_RE = /[^\p{L}\p{N}]/gu;

/** 重绘抑制窗:resize 后此窗口内的输出视为 SIGWINCH 整屏重绘,不进活动语义。 */
const REDRAW_SUPPRESS_MS = 1_000;

/** Host 侧能力注入:守望只依赖这五个谓词/回调,不反向耦合 Host。 */
interface ActivityWatchHost {
  /** 该会话当前正被查看?(含窗口失焦判定,由 Host 提供) */
  isViewing(sessionId: string): boolean;
  /** 会话仍存活?(已死会话的轮次不标未读) */
  exists(sessionId: string): boolean;
  /** 轮次开启闸是否适用该会话?(ssh/shell「输出即活动」语义豁免,由 Host 按 kind 判定) */
  noiseGated(sessionId: string): boolean;
  /** 状态变化回调(Host.notify)。 */
  onChange(): void;
  /** 真实轮次结算回调(首写前的输出不结算,自然不触发)。 */
  onTurnSettled(sessionId: string, unviewed: boolean, settledAt: number): void;
}

export class ActivityWatch {
  /** 活动守望计时器:无进行中轮次时停表(0 轮次不空转)。 */
  private timer: TimerHandle | null = null;
  /** 每会话最近输出时间:驱动呼吸灯。 */
  private readonly lastActivityAtMap = new Map<string, number>();
  /** 呼吸灯 notify 节流记录(每会话 500ms 最多一次外壳重渲染)。 */
  private readonly lastActivityNotify = new Map<string, number>();
  /** 完成未读集合:纯内存态,随 PTY 消亡。 */
  private readonly unread = new Set<string>();
  /** 进行中的对话轮次:输出进站,守望判静默超时后出站结算。 */
  private readonly activeTurns = new Set<string>();
  /** 已锚定对话的会话(用户首写起,终生有效):锚定前输出不进呼吸灯语义。 */
  private readonly conversationStarted = new Set<string>();
  /** 未应答的用户写入(首写置位,下一轮次结算清除):关 tab 后首字节迟到也能开轮。 */
  private readonly awaitingTurn = new Set<string>();
  /** 每会话最后一字节到达瞬间是否正被查看(结算归因,见文件头)。 */
  private readonly lastOutputViewed = new Map<string, boolean>();
  /** 每会话最近一次自发 resize 时戳(host.resizeSession 馈入):重绘抑制窗起点。 */
  private readonly lastResizeAt = new Map<string, number>();
  /** 每会话最近一次用户写入时戳:回显窗起点(思考期守卫判据,见文件头)。 */
  private readonly lastWriteAt = new Map<string, number>();
  /** 自上次写入以来是否见过回显窗外的内容分片:思考期结算守卫判据。 */
  private readonly answeredSinceWrite = new Set<string>();
  /** 每会话最近一次被空闲重绘闸拦下的自绘分片时戳:守卫的 spinner 活性界。 */
  private readonly lastGatedFrameAt = new Map<string, number>();
  /** 每会话最近非空可见骨架 FIFO(空闲重绘闸判据,见文件头)。 */
  private readonly skeletons = new Map<string, string[]>();

  constructor(private readonly host: ActivityWatchHost) {}

  /**
   * 用户首写 = 锚定对话,后续输出(回显/应答)按对话语义结算。
   * 终端协议回传(焦点/鼠标/查询应答)不经过此入口,见 host.writeSession。
   */
  onUserWrite(sessionId: string): void {
    this.conversationStarted.add(sessionId);
    this.lastWriteAt.set(sessionId, Date.now());
    this.awaitingTurn.add(sessionId);
    this.answeredSinceWrite.delete(sessionId);
    /* 新提问 = 新基线:清骨架窗,防跨轮次逐字符全等的真实输出被误判重绘 */
    this.skeletons.delete(sessionId);
  }

  /**
   * 新输出入站。返回 true = 节流窗口已开,Host 应 notify() 一次外壳刷新;
   * 未锚定会话恒 false(灯不变,无需外壳重渲染;幕布渲染走 ptyLiveTopic)。
   * `visibleText` = 该分片剥 ANSI 后的可见文本(hostWatches 经 stripAnsi 馈入),
   * 供空闲重绘闸判骨架复现;省略 = 不参与判定(既有直调方语义不变)。
   */
  onOutput(sessionId: string, visibleText?: string): boolean {
    if (!this.conversationStarted.has(sessionId)) return false;
    /* 空闲重绘闸:骨架恒定复现(或纯控制序列)的分片 = 状态栏/spinner 原地
       自绘,不是对话产出,不推活动钟、不开轮次。ssh/shell「输出即活动」豁免
       (与轮次开启闸同圈)。 */
    if (
      visibleText !== undefined &&
      this.host.noiseGated(sessionId) &&
      this.isIdleRedraw(sessionId, visibleText)
    ) {
      this.lastGatedFrameAt.set(sessionId, Date.now());
      return false;
    }
    /* 轮次开启闸:无未应答写入且轮次已了结的 CLI 会话,新输出(异步噪音)不开轮、
       不推进活动钟 —— 状态保持「已查看」;tab 开关与闸无关(常驻 tab ≠ 正在
       查看)。在途轮次与 awaitingTurn 放行,照常推进结算。 */
    if (
      !this.activeTurns.has(sessionId) &&
      !this.awaitingTurn.has(sessionId) &&
      this.host.noiseGated(sessionId)
    ) {
      return false;
    }
    const now = Date.now();
    /* 重绘抑制窗:自发 resize 后窗内的输出 = SIGWINCH 整屏重绘,不推进活动钟、
       不进轮次 —— 空闲已锚定会话被重绘打亮重跑生命周期的路径在此掐断。 */
    if (now - (this.lastResizeAt.get(sessionId) ?? 0) < REDRAW_SUPPRESS_MS) return false;
    /* 回显窗外的内容分片 = 应答证据(思考期结算守卫判据,见文件头)。 */
    if (now - (this.lastWriteAt.get(sessionId) ?? 0) > ANSWER_ECHO_MS)
      this.answeredSinceWrite.add(sessionId);
    this.lastActivityAtMap.set(sessionId, now);
    this.lastOutputViewed.set(sessionId, this.host.isViewing(sessionId));
    this.activeTurns.add(sessionId);
    this.unread.delete(sessionId);
    this.ensureWatch();
    if (now - (this.lastActivityNotify.get(sessionId) ?? 0) > 500) {
      this.lastActivityNotify.set(sessionId, now);
      return true;
    }
    return false;
  }

  /** 自发 resize 入站(host.resizeSession 唯一调用方):开重绘抑制窗。 */
  onResized(sessionId: string): void {
    this.lastResizeAt.set(sessionId, Date.now());
  }

  /** 完成未读判定(会话列表蓝呼吸灯)。 */
  isUnread(sessionId: string): boolean {
    return this.unread.has(sessionId);
  }
  /** 对话轮次进行中判定(输出进站起,静默超阈结算止)。 */
  isTurnActive(sessionId: string): boolean {
    return this.activeTurns.has(sessionId);
  }

  /** 点开查看 = 已读(蓝 → 灰)。 */
  markViewed(sessionId: string): void {
    this.unread.delete(sessionId);
  }

  /** 会话最近输出时间戳(无输出为 0;未锚定会话不推进,灯恒灰)。 */
  lastActivityAt(sessionId: string): number {
    return this.lastActivityAtMap.get(sessionId) ?? 0;
  }

  /** 会话移除:未读/轮次/锚定残留一并清除;无可守望即停表。 */
  onSessionRemoved(sessionId: string): void {
    this.lastActivityAtMap.delete(sessionId);
    this.lastActivityNotify.delete(sessionId);
    this.lastOutputViewed.delete(sessionId);
    this.lastResizeAt.delete(sessionId);
    this.skeletons.delete(sessionId);
    this.lastWriteAt.delete(sessionId);
    this.answeredSinceWrite.delete(sessionId);
    this.lastGatedFrameAt.delete(sessionId);
    this.unread.delete(sessionId);
    this.activeTurns.delete(sessionId);
    this.conversationStarted.delete(sessionId);
    this.awaitingTurn.delete(sessionId);
    this.stopIfIdle();
  }

  /** 测试专用:假时钟换届时重置守望(清柄 + 全态归零,防跨用例残留)。 */
  resetForTest(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.lastActivityAtMap.clear();
    this.lastActivityNotify.clear();
    this.lastOutputViewed.clear();
    this.lastResizeAt.clear();
    this.skeletons.clear();
    this.unread.clear();
    this.activeTurns.clear();
    this.conversationStarted.clear();
    this.awaitingTurn.clear();
    this.lastWriteAt.clear();
    this.answeredSinceWrite.clear();
    this.lastGatedFrameAt.clear();
  }

  private ensureWatch(): void {
    if (this.timer !== null) return;
    this.timer = setInterval(() => {
      const now = Date.now();
      let changed = false;
      for (const id of [...this.activeTurns]) {
        if (now - (this.lastActivityAtMap.get(id) ?? 0) <= TURN_SILENCE_MS) continue;
        /* 思考期守卫:写入后尚无回显窗外的内容分片 = CLI 仍在处理本次提问
           (spinner 自绘被空闲重绘闸判静默所致的假结算)。此刻结算会吞掉
           awaitingTurn,真实应答从此被轮次开启闸永久拦截 —— 标签卡死
           「会话结束-已查看」。跳过结算,保留轮次与 awaitingTurn。 */
        if (
          this.awaitingTurn.has(id) &&
          !this.answeredSinceWrite.has(id) &&
          this.host.noiseGated(id) &&
          now - (this.lastGatedFrameAt.get(id) ?? 0) < TURN_SILENCE_MS
        )
          continue;
        this.activeTurns.delete(id);
        this.awaitingTurn.delete(id); // 本轮结算 = 应答了此前写入
        const unviewed =
          !this.host.isViewing(id) &&
          !this.lastOutputViewed.get(id) &&
          this.host.exists(id);
        if (unviewed) this.unread.add(id);
        this.host.onTurnSettled(id, unviewed, this.lastActivityAtMap.get(id) ?? now);
        changed = true;
      }
      this.stopIfIdle();
      if (changed) this.host.onChange();
    }, 1000);
  }

  /** 分片是否空闲重绘:可见骨架(仅 \p{L}\p{N})为空或复现于最近窗口。
   *  非重绘分片顺带入窗(骨架非空才记)。 */
  private isIdleRedraw(sessionId: string, visibleText: string): boolean {
    const skeleton = visibleText.replace(SKELETON_RE, "");
    if (skeleton === "") return true;
    const seen = this.skeletons.get(sessionId) ?? [];
    if (seen.includes(skeleton)) return true;
    seen.push(skeleton);
    if (seen.length > IDLE_SKELETON_WINDOW) seen.shift();
    this.skeletons.set(sessionId, seen);
    return false;
  }

  private stopIfIdle(): void {
    if (this.activeTurns.size === 0 && this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}
