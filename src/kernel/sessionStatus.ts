/**
 * 会话状态观测(模型/思考强度)—— 从 host.ts 拆出(文件规模铁则 ≤500 行)。
 *
 * 数据源两级:
 * - 种子(seed):新会话创建即赋值,读 CLI 默认配置(readDefaultStatus)。
 *   磁盘会话文件要等首条消息才落盘(实证 omp),在此之前工具栏只能取配置默认;
 *   来源记为 "seeded",UI 据此打「默认」角标 —— 种子可能与会话实际生效模型不符
 *   (实证 omp 的 spawn 默认 = 全局上次使用,而非 config 的 modelRoles.default)。
 * - 观测(refresh):身份绑定后每 2s(仅活跃会话)读会话文件尾窗(readSessionStatus),
 *   来源记为 "observed";字段级合并防 tail 滚出窗口抹值,模型变更时 thinking
 *   不跨代延续(宁显 "—" 不冒充观测)。
 */

import type { CliProfile, CliSessionStatus } from "./cli";

/** 计时器句柄:webview 运行时是 number,Node 测试环境是 Timeout。 */
type TimerHandle = ReturnType<typeof setInterval>;

/** host 侧最小依赖面(箭头函数惰性绑定,避免整 host 的构造顺序耦合)。 */
interface SessionStatusHost {
  getActiveSessionId(): string | null;
  findSession(sessionId: string): { profileId: string; cwd: string } | undefined;
  hasSession(sessionId: string): boolean;
  getCliProfile(profileId: string): CliProfile | undefined;
  getCliSessionId(sessionId: string): string | undefined;
  /** 身份尚未绑定(pendingIdentities 在册):巡航期继续驱动绑定探测。 */
  isPendingIdentity(sessionId: string): boolean;
  tryBindIdentity(sessionId: string): Promise<void>;
  notify(): void;
}

export class SessionStatusWatch {
  private statuses = new Map<string, CliSessionStatus>();
  /** 状态值来源:"seeded" = CLI 默认配置种子,"observed" = 会话文件真实观测。 */
  private sources = new Map<string, "seeded" | "observed">();
  private timer: TimerHandle | null = null;

  constructor(private readonly h: SessionStatusHost) {}

  get(sessionId: string): CliSessionStatus | undefined {
    return this.statuses.get(sessionId);
  }

  source(sessionId: string): "seeded" | "observed" | undefined {
    return this.sources.get(sessionId);
  }

  remove(sessionId: string): void {
    this.statuses.delete(sessionId);
    this.sources.delete(sessionId);
  }

  /** 测试专用:假时钟换届时重置巡航计时器(真实运行单例连续,无需调用)。 */
  resetTimerForTest(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  ensurePolling(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      const sessionId = this.h.getActiveSessionId();
      if (!sessionId) return;
      if (this.h.getCliSessionId(sessionId)) {
        void this.refresh(sessionId);
      } else if (this.h.isPendingIdentity(sessionId)) {
        /* 慢相位:文件迟到(首条消息才落盘)/快照失败,激活会话 2s 巡航直到绑上 */
        void this.h.tryBindIdentity(sessionId);
      }
    }, 2_000);
  }

  /**
   * 创建即赋值的种子:CLI 配置的默认模型/思考强度。
   * 磁盘真相(身份绑定后的会话文件观测)落地后由字段级合并自然覆盖,无需清理种子。
   */
  async seed(sessionId: string): Promise<void> {
    const session = this.h.findSession(sessionId);
    if (!session || this.statuses.has(sessionId)) return;
    const profile = this.h.getCliProfile(session.profileId);
    if (!profile?.readDefaultStatus) return;
    const status = await profile.readDefaultStatus(session.cwd).catch(() => null);
    if (!status) return;
    /* 竞态防线:await 期间磁盘真相可能已落地,默认种子不得覆盖真实观测;
       会话可能已被移除 —— 死会话不得回写状态表 */
    if (
      !this.h.hasSession(sessionId) ||
      this.statuses.has(sessionId) ||
      this.h.getCliSessionId(sessionId)
    ) {
      return;
    }
    this.statuses.set(sessionId, status);
    this.sources.set(sessionId, "seeded");
    this.h.notify();
  }

  async refresh(sessionId: string): Promise<void> {
    const session = this.h.findSession(sessionId);
    const cliSessionId = this.h.getCliSessionId(sessionId);
    if (!session || !cliSessionId) return;
    const profile = this.h.getCliProfile(session.profileId);
    if (!profile?.readSessionStatus) return;
    const observed = await profile
      .readSessionStatus(session.cwd, cliSessionId)
      .catch(() => null);
    if (!observed) return;
    /* await 期间会话可能已被移除:回包不得给死会话写状态 */
    if (!this.h.hasSession(sessionId)) return;
    const previous = this.statuses.get(sessionId);
    /* tail 扫描是"最新观测"而非全量状态:字段缺省 = 事件滚出 256KB 窗口或尚未落盘,
       不等于"被清除"——同模型下缺省字段保留旧值。真实切换必在 tail 落新事件,
       以非空观测推进,故合并不会挡住正常的模型/思考变更。
       模型变更 = 新时代开启:缺省的 thinking 不得延续上一代的值(跨代拼值
       会把 A 模型+B 时代的思考强度同时示人),宁显 "—" 也不冒充观测。 */
    const modelChanged =
      observed.model !== undefined && observed.model !== previous?.model;
    const status: CliSessionStatus = {
      model: observed.model ?? previous?.model,
      thinkingLevel: modelChanged
        ? observed.thinkingLevel
        : (observed.thinkingLevel ?? previous?.thinkingLevel),
    };
    /* 值相等也必须推进来源(seeded → observed):种子值恰好等于观测值时,
       工具条的「默认」角标要靠来源翻转才摘得掉,故来源变化同样触发重渲染。 */
    const valueChanged = !(
      previous?.model === status.model &&
      previous?.thinkingLevel === status.thinkingLevel
    );
    const sourceChanged = this.sources.get(sessionId) !== "observed";
    if (!valueChanged && !sourceChanged) return;
    this.statuses.set(sessionId, status);
    this.sources.set(sessionId, "observed");
    this.h.notify();
  }
}
