/**
 * 活动守望 + 完成未读状态机(呼吸灯三态结算)。
 *
 * 从 host.ts 拆出(单文件 ≤500 行铁则,与 pluginLifecycle/diskIdentity 同因):
 * Host 组合持有;UI 只读 host.isUnread,不各自实现状态机。
 * 结算规则(1Hz):输出静默 >2s = 一轮对话结束;结束时未被查看(≠ activeSessionId)
 * 才标未读(蓝),正在看的会话完成不打扰;新输出回绿;点开即清(灰)。
 *
 * 宽限期(grace):spawn(新会话横幅/历史会话 resume 回放)的首个输出突发
 * 不是用户发起的对话 —— 期间输出只推进宽限静默钟,不进呼吸灯/未读/轮次,
 * 静默 2s 或用户首次写入(先到者)出宽限;出宽限后语义与既有完全一致。
 * 宽限结算不发 turnSettled(打开历史会话不得响"结束音")。
 */

/** 计时器句柄:webview 运行时是 number,Node 测试环境是 Timeout;仅内部持有。 */
type TimerHandle = ReturnType<typeof setInterval>;

/** 输出静默轮次阈值:轮次结算与宽限退出共用同一语义。 */
const TURN_SILENCE_MS = 2_000;

/** Host 侧能力注入:守望只依赖这四个谓词/回调,不反向耦合 Host。 */
interface ActivityWatchHost {
  /** 该会话当前正被查看?(含窗口失焦判定,由 Host 提供) */
  isViewing(sessionId: string): boolean;
  /** 会话仍存活?(已死会话的轮次不标未读) */
  exists(sessionId: string): boolean;
  /** 状态变化回调(Host.notify)。 */
  onChange(): void;
  /** 真实轮次结算回调(宽限静默退出不触发)。 */
  onTurnSettled(sessionId: string, unviewed: boolean, settledAt: number): void;
}

export class ActivityWatch {
  /** 活动守望计时器:无进行中轮次且无宽限钟时停表(0 轮次不空转)。 */
  private timer: TimerHandle | null = null;
  /** 每会话最近输出时间:驱动呼吸灯。 */
  private readonly lastActivityAtMap = new Map<string, number>();
  /** 呼吸灯 notify 节流记录(每会话 500ms 最多一次外壳重渲染)。 */
  private readonly lastActivityNotify = new Map<string, number>();
  /** 完成未读集合:纯内存态,随 PTY 消亡。 */
  private readonly unread = new Set<string>();
  /** 进行中的对话轮次:输出进站,守望判静默超时后出站结算。 */
  private readonly activeTurns = new Set<string>();
  /** 宽限成员(spawn 起,静默/首写止):成员期输出不计入呼吸灯语义。 */
  private readonly gracePhase = new Set<string>();
  /** 宽限静默钟:仅记有输出的宽限会话(零输出无需守钟,不空转)。 */
  private readonly graceClocks = new Map<string, number>();

  constructor(private readonly host: ActivityWatchHost) {}

  /**
   * 会话诞生(createSession/openDiskSession 共用):入宽限。
   * 横幅与 resume 回放是落盘历史的重绘,不是对话。
   */
  onSpawned(sessionId: string): void {
    this.gracePhase.add(sessionId);
  }

  /** 用户首次写入 = 宽限立即终止,后续输出(回显/应答)按对话语义结算。 */
  onUserWrite(sessionId: string): void {
    this.gracePhase.delete(sessionId);
    this.graceClocks.delete(sessionId);
  }

  /**
   * 新输出入站。返回 true = 节流窗口已开,Host 应 notify() 一次外壳刷新;
   * 宽限期内恒 false(灯不变,无需外壳重渲染;幕布渲染走 ptyLiveTopic)。
   */
  onOutput(sessionId: string): boolean {
    const now = Date.now();
    if (this.gracePhase.has(sessionId)) {
      this.graceClocks.set(sessionId, now);
      this.ensureWatch();
      return false;
    }
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

  /** 会话最近输出时间戳（无输出为 0;宽限期不推进,灯恒灰）。 */
  lastActivityAt(sessionId: string): number {
    return this.lastActivityAtMap.get(sessionId) ?? 0;
  }

  /** 会话移除:未读/轮次/宽限残留一并清除;无可守望即停表。 */
  onSessionRemoved(sessionId: string): void {
    this.lastActivityAtMap.delete(sessionId);
    this.lastActivityNotify.delete(sessionId);
    this.unread.delete(sessionId);
    this.activeTurns.delete(sessionId);
    this.gracePhase.delete(sessionId);
    this.graceClocks.delete(sessionId);
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
    this.gracePhase.clear();
    this.graceClocks.clear();
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
      /* 宽限静默退出:不发事件、不标未读 —— 回放不是对话。 */
      for (const [id, lastAt] of [...this.graceClocks]) {
        if (now - lastAt <= TURN_SILENCE_MS) continue;
        this.graceClocks.delete(id);
        this.gracePhase.delete(id);
      }
      this.stopIfIdle();
      if (changed) this.host.onChange();
    }, 1000);
  }

  private stopIfIdle(): void {
    if (this.activeTurns.size === 0 && this.graceClocks.size === 0 && this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}
