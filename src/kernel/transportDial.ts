/**
 * 桥拨号策略(纯状态机):退避闸 + 候选端点轮换。
 * 从 transportBridge 拆出(二轮评审后文件过 300 行铁则);桥持有一个实例,
 * ensure/onClose/onopen 三处驱动。
 */

/** 退避曲线:1s 起步,×2,封顶 10s。 */
const RETRY_MAX_MS = 10_000;
/** 连续失败多少次后轮换下一候选(单次失败不切:网络抖动/桌面重启误切)。 */
const ROTATE_AFTER_FAILS = 2;

export class DialPolicy {
  private retryMs = 1000;
  private nextDialAt = 0;
  private urlIdx = 0;
  private failStreak = 0;

  /** 退避闸:ensure() 快败判定。 */
  gated(now = Date.now()): boolean {
    return now < this.nextDialAt;
  }

  /** 拨号成功:清连败与退避。 */
  dialed(): void {
    this.retryMs = 1000;
    this.nextDialAt = 0;
    this.failStreak = 0;
  }

  /**
   * 断线收账。返回本轮等待毫秒与是否轮换;轮换 = 新意图,清退避闸短等即拨。
   * delayMs 取翻倍前的当前值(旧序语义:等 1s、下次等 2s)。
   */
  failed(candidates: string[]): { delayMs: number; rotated: boolean } {
    if (++this.failStreak >= ROTATE_AFTER_FAILS && candidates.length > 1) {
      this.failStreak = 0;
      this.urlIdx = (this.urlIdx + 1) % candidates.length;
      this.retryMs = 1000;
      this.nextDialAt = 0;
      return { delayMs: 250, rotated: true };
    }
    const delayMs = this.retryMs;
    this.nextDialAt = Date.now() + delayMs;
    this.retryMs = Math.min(this.retryMs * 2, RETRY_MAX_MS);
    return { delayMs, rotated: false };
  }

  /** 显式重拨(用户手势/回前台/换端点):绕过退避闸。 */
  arm(): void {
    this.retryMs = 1000;
    this.nextDialAt = 0;
    this.urlIdx = 0;
    this.failStreak = 0;
  }

  /** 当前候选下标(候选表可能变化,取模防越界)。 */
  index(list: string[]): number {
    return this.urlIdx % Math.max(list.length, 1);
  }

}
