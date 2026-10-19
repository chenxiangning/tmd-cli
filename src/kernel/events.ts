/**
 * 内核事件总线 —— 跨插件通信的唯一通道。
 * 刻意极简：字符串 topic + 任意负载，类型安全靠各插件自定义窄接口。
 */

type EventHandler<T = unknown> = (payload: T) => void;

export class EventBus {
  private handlers = new Map<string, Set<EventHandler>>();

  on<T>(topic: string, handler: EventHandler<T>): () => void {
    let set = this.handlers.get(topic);
    if (!set) {
      set = new Set();
      this.handlers.set(topic, set);
    }
    set.add(handler as EventHandler);
    return () => set.delete(handler as EventHandler);
  }

  emit<T>(topic: string, payload: T): void {
    this.handlers.get(topic)?.forEach((h) => h(payload));
  }
}

/** 内核内置 topic 清单（插件自定义 topic 不在此列）。 */
export const KernelTopics = {
  /** 会话列表变化（新建/销毁/元数据更新）。 */
  sessionsChanged: "kernel.sessions.changed",
  /** 当前激活会话切换。payload: sessionId | null */
  activeSessionChanged: "kernel.sessions.active",
  /**
   * 用户显式「去看这个会话」的手势信号(侧栏行/历史行/工作台会话链/续聊/
   * 搜索命中/通知点击等)。payload: null。
   * 消费方:app-shell 还原编辑区最大化(幕布被盖住时「打开 = 看不到」)。
   * 红线:程序自动化(任务自动状态、会话退出 MRU 回落、adopt、activate:false
   * 后台拉起)严禁发——「激活 ≠ 用户意图」,误发会把最大化持续打掉
   * (2026-10-11 激活守卫翻车回撤的教训)。
   */
  sessionViewRequested: "kernel.sessions.viewRequested",
  /** 某会话 CLI 进程退出。payload: sessionId */
  sessionExited: "kernel.sessions.exited",
  /**
   * 退出详情(与 sessionExited 同边沿补发;旧消费方零迁移)。
   * payload: SessionExitedDetailEvent —— exitCode 来自 portable-pty
   * (0 = 正常;信号中止归一 1;用户 kill 与 SSH 通道为 null = 未知,静默)。
   */
  sessionExitedDetail: "kernel.sessions.exited.detail",
  /**
   * 会话启动失败(spawn 即被拒,或进程在启动窗口内秒退)。
   * payload: SessionStartFailedEvent —— 秒退路径幕布缓冲随 tab 消亡,
   * 报错来不及呈现,由 spawn 编排件摘尾部广播(见 kernel/sessionSpawn.ts)。
   */
  sessionStartFailed: "kernel.sessions.startFailed",
  /** 一轮对话结算(输出静默超阈)。payload: TurnSettledEvent */
  turnSettled: "kernel.sessions.turn.settled",
  /** 会话新进入等待用户确认(Ask 标记命中,本轮首次)。payload: sessionId */
  askDetected: "kernel.sessions.ask.detected",
  /**
   * CLI 输出出现「AI 写入文件」标记(EditWatch 命中,路径已按会话 cwd 归一)。
   * payload: { sessionId, paths } —— 审批线 events 归因的主信号
   * (作者设计点:审批线跟随 AI 输出落盘,而不是光靠 git 推断)。
   * 常量归内核,检测归 editWatch(host 主链路);消费方:checkpoints 流式记账。
   */
  fileEditDetected: "kernel.sessions.fileEdit.detected",
  /**
   * 一条用户 prompt 已写入 PTY。payload: { sessionId, text }
   * 常量与轮次闸归内核(kernel/promptGate),composer 三条写路径与
   * session-relay 接力首发同权消费 —— 发送语义不再归属单一插件
   * (幕布击键同样走 writeSession,不能当 prompt)。消费方:checkpoints 插件打锚点快照。
   * 仅「开启新对话轮次」的发送才广播:kernel/promptGate 轮次闸把守,
   * ask 作答与轮中控制命令(如 /model 切模型)不开轮、不广播。
   */
  promptSent: "kernel.sessions.promptSent",
  /**
   * checkpoints 一轮真实封口落账(checkpoint_seal 返回 true 的边沿,幂等封口
   * 不广播)。payload: CkptTurnSealedEvent —— 只带身份三元组;批内容(文件±/
   * batchId/引擎)由消费方经 checkpointList 拉最新批自取,契约不复制账本形状。
   * 消费方:footprint 插件落按日 rollup。sealDeadTurns 的代封不广播(无单会话
   * 身份,残留轮缺口诚实留给 git 证据兜底)。
   */
  ckptTurnSealed: "kernel.checkpoints.turn.sealed",
} as const;

/** ckptTurnSealed 负载:CLI 会话 id + tmd 会话 id + 工作区(查询键,非内容)。 */
export interface CkptTurnSealedEvent {
  cwd: string;
  sessionId: string;
  tmdSessionId: string;
}

/** promptSent 负载:text = 发送的原文(prepareSendPayload 前,translate 后的展示文本截断);
 *  ranges = 本轮随发携带的文件区间引用(marks 标注等,审批线存证消费;未携带缺省)。 */
export interface PromptSentEvent {
  sessionId: string;
  text: string;
  ranges?: PromptSentRange[];
}

/** 随发携带的文件区间引用(id + 1 基闭区间;语义自定义,审批线存证消费)。 */
export interface PromptSentRange {
  id: string;
  path: string;
  startLine: number;
  endLine: number;
}

/** turnSettled 负载:unviewed = 结算时未被查看(即标了完成未读);settledAt = 末次输出时刻。 */
export interface TurnSettledEvent {
  sessionId: string;
  unviewed: boolean;
  settledAt: number;
}

/** 退出详情负载:元数据自移除前的会话表快照;exitCode null = 注册表已失句柄(重载竞态)。 */
export interface SessionExitedDetailEvent {
  sessionId: string;
  profileId: string;
  cwd: string;
  workspaceId?: string;
  cliSessionId?: string;
  kind?: "cli" | "ssh" | "shell";
  title?: string;
  exitCode: number | null;
  at: number;
}

/** fileEditDetected 负载:paths = 本批新增命中(去重后,仓库相对、已归一)。 */
export interface FileEditEvent {
  sessionId: string;
  paths: string[];
}

/** sessionStartFailed 负载:reason = 幕布尾部摘要(秒退)或错误消息(spawn 被拒);
 *  sessionId 为 null = PTY 尚未诞生;late = 启动窗口外退出(崩溃特征命中才广播)。 */
export interface SessionStartFailedEvent {
  sessionId: string | null;
  profileId: string | null;
  reason: string;
  late?: boolean;
}

