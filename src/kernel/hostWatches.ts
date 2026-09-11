/**
 * 守望组合件 —— 自 host.ts 拆出(文件规模铁则收紧至 300 行)。
 * 承担:身份/状态/Ask/编辑/活动五守望与输出缓冲、CLI 磁盘身份账本的装配,
 * 以及 appendOutput 主链路(缓冲落盘 + 实时 topic 广播 + 三守望馈送)。
 * Host 经 ctx 注入会话表/profile 访问与通知回调;ptyLiveTopic 移居此,
 * host.ts re-export 保持 import 契约不变。
 */

import { KernelTopics, type EventBus } from "./events";
import { getSettingsState } from "./settings";
import { ActivityWatch } from "./activityWatch";
import { AskWatchFeed } from "./askWatch";
import { stripAnsi } from "./askDetect";
import { EditWatch } from "./editWatch";
import { DiskIdentityWatch } from "./identityWatch";
import { OutputBufferStore } from "./outputBuffers";
import { SessionStatusWatch } from "./sessionStatus";
import { getSessionTabs } from "./sessionTabs";
import type { CliProfile, CliSessionStatus } from "./cli";
import type { SessionMeta } from "./ipc";
import { noteLogBinding } from "./diskReplay";
/** 幕布实时输出 topic(TerminalView 订阅,与 appendOutput 共用)。 */
export function ptyLiveTopic(sessionId: string): string {
  return `kernel.pty.live.${sessionId}`;
}

/** Host 侧能力注入(箭头函数惰性绑定,避免整 host 的构造顺序耦合)。 */
export interface HostWatchesCtx {
  getCliProfile(profileId: string): CliProfile | undefined;
  findSession(sessionId: string): SessionMeta | undefined;
  hasSession(sessionId: string): boolean;
  getActiveSessionId(): string | null;
  /** 该会话当前正被查看?(含窗口失焦判定,由 Host 提供) */
  isViewing(sessionId: string): boolean;
  /** 外壳重渲染通知(Host.notify)。 */
  notify(): void;
  events: EventBus;
}

/** 缓冲上限兜底值(设置未落地前/异常时)。全屏 TUI 靠重绘恢复,保留尾部足够。 */
const OUTPUT_BUFFER_LIMIT = 500_000;

export class HostWatches {
  /** 待绑定磁盘身份的会话探测(快相位 500ms×30 → 巡航 5s,预算 10min);实现见 kernel/identityWatch.ts。 */
  private readonly identityWatch = new DiskIdentityWatch({
    getCliProfile: (profileId) => this.ctx.getCliProfile(profileId),
    sessionAlive: (sessionId) => this.ctx.hasSession(sessionId),
    isBound: (sessionId) => this.cliSessionIds.has(sessionId),
    claimedIds: () => new Set(this.cliSessionIds.values()),
    onBound: (sessionId, cliSessionId) => {
      this.bindIdentity(sessionId, cliSessionId);
      void this.statusWatch.refresh(sessionId);
      this.ctx.notify();
    },
  });
  /** 活会话对应的 CLI 当前模型/思考强度与来源分级(实现见 kernel/sessionStatus.ts)。 */
  private readonly statusWatch = new SessionStatusWatch({
    getActiveSessionId: () => this.ctx.getActiveSessionId(),
    findSession: (sessionId) => this.ctx.findSession(sessionId),
    hasSession: (sessionId) => this.ctx.hasSession(sessionId),
    getCliProfile: (profileId) => this.ctx.getCliProfile(profileId),
    getCliSessionId: (sessionId) => this.cliSessionIds.get(sessionId),
    isPendingIdentity: (sessionId) => this.identityWatch.has(sessionId),
    tryBindIdentity: (sessionId) => this.identityWatch.tryBind(sessionId),
    notify: () => this.ctx.notify(),
  });
  /** 每会话 PTY 输出环形缓冲:xterm 重挂载回放("切回不黑屏");存储细节见 kernel/outputBuffers.ts。 */
  private readonly outputBuffers = new OutputBufferStore();
  private readonly askWatch = new AskWatchFeed({
    sessionKind: (sessionId) => this.ctx.findSession(sessionId)?.kind,
    askMarks: (sessionId) =>
      this.ctx.getCliProfile(this.ctx.findSession(sessionId)?.profileId ?? "")
        ?.askMarks,
    emitAsked: (sessionId) =>
      this.ctx.events.emit(KernelTopics.askDetected, sessionId),
    notify: () => this.ctx.notify(),
    bufferTail: (sessionId, maxChars) =>
      this.outputBuffers.get(sessionId).slice(-maxChars), // askWatch 检测核心见 kernel/askWatch.ts
  });
  /** AI 写入文件守望(events 归因主信号,见 kernel/editWatch.ts;纯内存,随 PTY 消亡) */
  private readonly editWatch = new EditWatch();
  /**
   * 活会话 → CLI 磁盘身份绑定(omp/pi 的 jsonl uuid、codex 的 rollout id)。
   * 纯前端内存,随 PTY 消亡 —— 这是活会话的身份属性,不是持久化映射。
   * 用途:UI 按身份去重(同一会话在活区/磁盘区只出现一次)。
   */
  private cliSessionIds = new Map<string, string>();
  private readonly activity = new ActivityWatch({
    /* 后台提醒开启时,窗口失焦的激活会话不算"正在查看"(完成照标蓝/响结束音);
       Node 测试环境窗口恒聚焦,退化为纯 activeSessionId 语义 */
    isViewing: (id) => this.ctx.isViewing(id),
    exists: (id) => this.ctx.hasSession(id),
    /* 轮次开启闸:关 tab(含容量挤除)的已了结会话不被异步噪音开轮;
       与 sessionTabs 的模块级循环仅有运行时延迟调用,安全。 */
    hasOpenTab: (id) => getSessionTabs().includes(id),
    /* ssh/shell「输出即活动」是既定语义(远端长任务完工要通知),闸只适用 CLI 会话 */
    noiseGated: (id) => {
      const kind = this.ctx.findSession(id)?.kind;
      return kind !== "ssh" && kind !== "shell";
    },
    onChange: () => this.ctx.notify(),
    onTurnSettled: (id, unviewed, settledAt) => {
      this.ctx.events.emit(KernelTopics.turnSettled, {
        sessionId: id,
        unviewed,
        settledAt,
      });
    },
  });

  constructor(private readonly ctx: HostWatchesCtx) {}

  /** 活会话绑定的 CLI 磁盘身份;未绑定(探测前)为 undefined。 */
  getCliSessionId(sessionId: string): string | undefined {
    return this.cliSessionIds.get(sessionId);
  }

  /**
   * 绑定表唯一写入口:一个 CLI 磁盘身份只准一个活会话持有。身份守望的
   * claimed 过滤是快照式(await 期间会过期),此处是绑定落表的同步终审
   * (实证:四会话共绑一老会话,ptys 各自 resume 了同一磁盘会话)。抢绑失败
   * = 新会话保持未绑定(fail-closed):账本按 tmd id 隔离,UI 不去重不并账。
   */
  bindIdentity(sessionId: string, cliSessionId: string): boolean {
    const rival = [...this.cliSessionIds.entries()].some(
      ([id, cid]) => id !== sessionId && cid === cliSessionId,
    );
    if (rival) return false;
    this.cliSessionIds.set(sessionId, cliSessionId);
    /* 磁盘先行回放:绑定成功即覆写「CLI 会话 → 当前代日志」指针(冷开寻址上一代)。
       收口在唯一写入口,显式恢复(openDiskSession)与探测绑定(identityWatch)两路共用 */
    const meta = this.ctx.findSession(sessionId);
    if (meta) noteLogBinding(meta.profileId, meta.cwd, cliSessionId, sessionId);
    return true;
  }

  /** 测试专用:直通绑定终审闸(共绑一磁盘身份的回归入口)。 */
  bindIdentityForTest(sessionId: string, cliSessionId: string): boolean {
    return this.bindIdentity(sessionId, cliSessionId);
  }

  appendOutput(sessionId: string, text: string): void {
    /* 上限读设置项 sessionOutputBufferLimit(行为页可调),异常值已被 sanitize 拦截。 */
    const limit =
      getSettingsState().settings.sessionOutputBufferLimit || OUTPUT_BUFFER_LIMIT;
    const chunkBytes = this.outputBuffers.append(sessionId, text, limit);
    this.ctx.events.emit(ptyLiveTopic(sessionId), text);

    /* AskWatch 升级 → askDetected(提示音)+ 标签;ActivityWatch 回绿;
       EditWatch 检测 AI 写入标记 → fileEditDetected(审批线归因)。
       notify 单次:ask 升级与回绿共享同一渲染节拍。
       可见文本 = 剥 ANSI 后原文,供 activityWatch 空闲重绘闸判骨架复现
       (见该文件头);未锚定会话白算一次 regex,换取调用点单一、无状态泄漏。 */
    const asked = this.askWatch.onOutput(sessionId, text, chunkBytes);
    const visible = stripAnsi(text);
    if (asked || this.activity.onOutput(sessionId, visible)) this.ctx.notify();
    const session = this.ctx.findSession(sessionId);
    const marks = session
      ? this.ctx.getCliProfile(session.profileId)?.editMarks
      : undefined;
    if (session && marks && marks.length > 0) {
      const paths = this.editWatch.onOutput(sessionId, text, session.cwd, marks);
      if (paths.length > 0) {
        this.ctx.events.emit(KernelTopics.fileEditDetected, { sessionId, paths });
      }
    }
  }

  /* 回放补观察 / 屏幕采样:委托 askWatch 组合件(语义见 kernel/askWatch.ts)。 */
  observeReplayTail(sessionId: string): void {
    this.askWatch.observeReplayTail(sessionId);
  }
  /** 磁盘日志尾巴恢复(boot;语义见 kernel/askWatchFeed.ts restoreTail)。 */
  restoreTail(sessionId: string, tail: string, extraMarks?: RegExp[]): void {
    this.askWatch.restoreTail(sessionId, tail, extraMarks);
  }
  observeAskScreen(sessionId: string, screenText: string): void {
    this.askWatch.onScreenSample(sessionId, screenText);
  }

  /** 磁盘尾恢复(走法 1 冷开回放;带写后闸,语义见 askWatchFeed.restoreDiskTail)。 */
  restoreDiskTail(sessionId: string, tail: string): void {
    this.askWatch.restoreDiskTail(sessionId, tail);
  }

  /** 用户写入的守望扇出:对话锚定(呼吸灯首写闸)+ EditWatch 去重集清空 + Ask 作答解除。
      synthetic 回传(焦点/鼠标/查询应答,terminalReports.ts)不是作答,三守望一概不碰 ——
      否则点一下终端/切一次 tab 就清候选并重启 8s 抑制窗,亮标被无限推迟(实测根因)。
      返回 true = Ask 等待态翻转,Host 据此重渲染。 */
  onUserWrite(sessionId: string, synthetic: boolean): boolean {
    if (synthetic) return false;
    this.activity.onUserWrite(sessionId);
    this.editWatch.onUserWrite(sessionId); // 新一轮:EditWatch 去重集清空
    return this.askWatch.onUserWrite(sessionId);
  }

  /** 幕布尺寸同步:给活动守望记重绘抑制窗起点。 */
  onResized(sessionId: string): void {
    this.activity.onResized(sessionId);
  }

  /** 点开查看 = 已读:清完成未读标记(蓝 → 灰)。 */
  markViewed(sessionId: string): void {
    this.activity.markViewed(sessionId);
  }

  /** 完成未读判定(会话列表蓝呼吸灯)。 */
  isUnread(sessionId: string): boolean {
    return this.activity.isUnread(sessionId);
  }
  /** 对话轮次进行中判定(composer 模型位等「运行时不发送」门控消费)。 */
  isTurnActive(sessionId: string): boolean {
    return this.activity.isTurnActive(sessionId);
  }

  /** 等待确认判定(会话列表「等待确认」标签;用户写入即清)。 */
  isWaiting(sessionId: string): boolean {
    return this.askWatch.isWaiting(sessionId);
  }

  getSessionStatus(sessionId: string): CliSessionStatus | undefined {
    return this.statusWatch.get(sessionId);
  }

  /** 状态值来源:"seeded" = CLI 默认配置种子,"observed" = 会话文件真实观测。 */
  getSessionStatusSource(sessionId: string): "seeded" | "observed" | undefined {
    return this.statusWatch.source(sessionId);
  }

  /** 会话至今的全部(尾部)输出,供 xterm 重挂载回放(压实语义见 OutputBufferStore.get)。 */
  getOutputBuffer(sessionId: string): string {
    return this.outputBuffers.get(sessionId);
  }

  /**
   * 缓冲的 UTF-8 字节数(增量维护,O(1) 读取)。
   * 供 TerminalView 翻页锚点反推缓冲起点的绝对日志偏移。
   */
  getOutputBufferBytes(sessionId: string): number {
    return this.outputBuffers.getBytes(sessionId);
  }

  /** 缓冲尾巴(spawn 秒退守望摘报错用;removeSession 即清,须在退出回调同步取)。 */
  outputTail(sessionId: string, maxChars: number): string {
    return this.outputBuffers.get(sessionId).slice(-maxChars);
  }

  /** 会话最近输出时间戳(无输出为 0)。 */
  lastActivityAt(sessionId: string): number {
    return this.activity.lastActivityAt(sessionId);
  }

  /** 身份探测登记(createSession 专用;openDiskSession 已知身份不探测)。 */
  identityTrack(
    sessionId: string,
    profileId: string,
    cwd: string,
    before: Map<string, number> | null,
    spawnedAt: number,
  ): void {
    this.identityWatch.track(sessionId, profileId, cwd, before, spawnedAt);
  }

  statusEnsurePolling(): void {
    this.statusWatch.ensurePolling();
  }

  statusRefresh(sessionId: string): void {
    void this.statusWatch.refresh(sessionId);
  }

  statusSeed(sessionId: string): void {
    void this.statusWatch.seed(sessionId);
  }

  /** 会话移除:五守望与缓冲/身份账本残留一并清除。 */
  onSessionRemoved(sessionId: string): void {
    this.cliSessionIds.delete(sessionId);
    this.identityWatch.remove(sessionId);
    this.statusWatch.remove(sessionId);
    this.outputBuffers.remove(sessionId);
    this.activity.onSessionRemoved(sessionId);
    this.askWatch.onSessionRemoved(sessionId);
    this.editWatch.onSessionRemoved(sessionId); // 无条件清:非激活会话移除同样不得泄漏检测态
  }

  /** 测试专用:假时钟换届时重置活动守望与 Ask 守望(与 resetStatusTimerForTest 同因)。 */
  resetActivityWatchForTest(): void {
    this.activity.resetForTest();
    this.askWatch.resetForTest();
  }

  /** 测试专用:假时钟换届时重置巡航计时器(真实运行单例连续,无需调用)。 */
  resetStatusTimerForTest(): void {
    this.statusWatch.resetTimerForTest();
  }
}
