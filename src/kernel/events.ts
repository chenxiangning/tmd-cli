/**
 * 内核事件总线 —— 跨插件通信的唯一通道。
 * 刻意极简：字符串 topic + 任意负载，类型安全靠各插件自定义窄接口。
 */

export type EventHandler<T = unknown> = (payload: T) => void;

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
  /** 一轮对话结算(输出静默超阈)。payload: TurnSettledEvent */
  turnSettled: "kernel.sessions.turn.settled",
} as const;

/** turnSettled 负载:unviewed = 结算时未被查看(即标了完成未读);settledAt = 末次输出时刻。 */
export interface TurnSettledEvent {
  sessionId: string;
  unviewed: boolean;
  settledAt: number;
}
