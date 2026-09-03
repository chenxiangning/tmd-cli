/**
 * 活动守望 + 完成未读状态机(呼吸灯三态结算)。
 *
 * 从 host.ts 拆出(单文件 ≤500 行铁则)。Host 组合持有;UI 只读 host.isUnread,
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
 *
 * 已知取舍:首写后的 TUI 重绘(SIGWINCH/焦点切换)仍可能亮一次绿 —— 它与
 * "CLI 正在回答"在字节流上不可区分,靠时序窗口收紧会漏掉长思考后的真回答
 * (未读提醒失效),宁可保守放行。
 */

/** 计时器句柄:webview 运行时是 number,Node 测试环境是 Timeout;仅内部持有。 */
type TimerHandle = ReturnType<typeof setInterval>;

/** 输出静默轮次阈值:静默超此值即结算一轮对话。 */
const TURN_SILENCE_MS = 2_000;

/** Host 侧能力注入:守望只依赖这四个谓词/回调,不反向耦合 Host。 */
interface ActivityWatchHost {
  /** 该会话当前正被查看?(含窗口失焦判定,由 Host 提供) */
  isViewing(sessionId: string): boolean;
  /** 会话仍存活?(已死会话的轮次不标未读) */
  exists(sessionId: string): boolean;
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

  constructor(private readonly host: ActivityWatchHost) {}

  /**
   * 用户首写 = 锚定对话,后续输出(回显/应答)按对话语义结算。
   * 终端协议回传(焦点/鼠标/查询应答)不经过此入口,见 host.writeSession。
   */
  onUserWrite(sessionId: string): void {
    this.conversationStarted.add(sessionId);
  }

  /**
   * 新输出入站。返回 true = 节流窗口已开,Host 应 notify() 一次外壳刷新;
   * 未锚定会话恒 false(灯不变,无需外壳重渲染;幕布渲染走 ptyLiveTopic)。
   */
  onOutput(sessionId: string): boolean {
    if (!this.conversationStarted.has(sessionId)) return false;
    const now = Date.now();
    this.lastActivityAtMap.set(sessionId, now);
    this.activeTurns.add(sessionId);
    this.unread.delete(sessionId);
    this.ensureWatch();
    if (now - (this.lastActivityNotify.get(sessionId) ?? 0) > 500) {
      this.lastActivityNotify.set(sessionId, now);
      return true;
    }
    return false;
  }

  /** 完成未读判定(会话列表蓝呼吸灯)。 */
  isUnread(sessionId: string): boolean {
    return this.unread.has(sessionId);
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
    this.unread.delete(sessionId);
    this.activeTurns.delete(sessionId);
    this.conversationStarted.delete(sessionId);
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
    this.unread.clear();
    this.activeTurns.clear();
    this.conversationStarted.clear();
  }

  private ensureWatch(): void {
    if (this.timer !== null) return;
    this.timer = setInterval(() => {
      const now = Date.now();
      let changed = false;
      for (const id of [...this.activeTurns]) {
        if (now - (this.lastActivityAtMap.get(id) ?? 0) <= TURN_SILENCE_MS) continue;
        this.activeTurns.delete(id);
        const unviewed = !this.host.isViewing(id) && this.host.exists(id);
        if (unviewed) this.unread.add(id);
        this.host.onTurnSettled(id, unviewed, this.lastActivityAtMap.get(id) ?? now);
        changed = true;
      }
      this.stopIfIdle();
      if (changed) this.host.onChange();
    }, 1000);
  }

  private stopIfIdle(): void {
    if (this.activeTurns.size === 0 && this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}
