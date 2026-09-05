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
  /** 某会话 CLI 进程退出。payload: sessionId */
  sessionExited: "kernel.sessions.exited",
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
   * 常量归内核,emit 归 composer —— 发送语义是 composer 的知识
   * (幕布击键同样走 writeSession,不能当 prompt)。消费方:checkpoints 插件打锚点快照。
   */
  promptSent: "kernel.sessions.prompt",
} as const;

/** promptSent 负载:text = 发送的原文(prepareSendPayload 前,translate 后的展示文本截断)。 */
export interface PromptSentEvent {
  sessionId: string;
  text: string;
}

/** turnSettled 负载:unviewed = 结算时未被查看(即标了完成未读);settledAt = 末次输出时刻。 */
export interface TurnSettledEvent {
  sessionId: string;
  unviewed: boolean;
  settledAt: number;
}

/** fileEditDetected 负载:paths = 本批新增命中(去重后,仓库相对、已归一)。 */
export interface FileEditEvent {
  sessionId: string;
  paths: string[];
}

/** sessionStartFailed 负载:reason = 幕布尾部摘要(秒退)或错误消息(spawn 被拒);sessionId 为 null = PTY 尚未诞生。 */
export interface SessionStartFailedEvent {
  sessionId: string | null;
  profileId: string | null;
  reason: string;
}
