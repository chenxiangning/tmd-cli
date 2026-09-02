/**
 * 活动守望 + 完成未读状态机(呼吸灯三态结算)。
 *
 * 从 host.ts 拆出(单文件 ≤500 行铁则,与 pluginLifecycle/diskIdentity 同因):
 * Host 组合持有;UI 只读 host.isUnread,不各自实现状态机。
 * 结算规则(1Hz):输出静默 >2s = 一轮对话结束;结束时未被查看(≠ activeSessionId)
 * 才标未读(蓝),正在看的会话完成不打扰;新输出回绿;点开即清(灰)。
 */

/** 计时器句柄:webview 运行时是 number,Node 测试环境是 Timeout;仅内部持有。 */
type TimerHandle = ReturnType<typeof setInterval>;

/** Host 侧能力注入:守望只依赖这三个谓词,不反向耦合 Host。 */
interface ActivityWatchHost {
  /** 该会话当前正被查看? */
  isViewing(sessionId: string): boolean;
  /** 会话仍存活?(已死会话的轮次不标未读) */
  exists(sessionId: string): boolean;
  /** 状态变化回调(Host.notify)。 */
  onChange(): void;
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

  constructor(private readonly host: ActivityWatchHost) {}

  /**
   * 新输出入站。返回 true = 节流窗口已开,Host 应 notify() 一次外壳刷新。
   */
  onOutput(sessionId: string): boolean {
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

  /** 会话最近输出时间戳（无输出为 0）。 */
  lastActivityAt(sessionId: string): number {
    return this.lastActivityAtMap.get(sessionId) ?? 0;
  }

  /** 会话移除:未读/轮次/活动时间残留一并清除;无进行中轮次即停表。 */
  onSessionRemoved(sessionId: string): void {
    this.lastActivityAtMap.delete(sessionId);
    this.lastActivityNotify.delete(sessionId);
    this.unread.delete(sessionId);
    this.activeTurns.delete(sessionId);
    this.stopIfIdle();
  }

  /** 测试专用:假时钟换届时重置守望计时器(真实运行单例连续,无需调用)。 */
  resetForTest(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private ensureWatch(): void {
    if (this.timer !== null) return;
    this.timer = setInterval(() => {
      const now = Date.now();
      let changed = false;
      for (const id of [...this.activeTurns]) {
        if (now - (this.lastActivityAtMap.get(id) ?? 0) <= 2000) continue;
        this.activeTurns.delete(id);
        if (!this.host.isViewing(id) && this.host.exists(id)) {
          this.unread.add(id);
        }
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
