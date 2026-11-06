/** structured-session → checkpoints/footprint 共同存证。
 * 只认 RPC 成功 write/edit 完成帧；进程退出不封口，session_settled 才结算。
 */
import { KernelTopics, type CkptTurnSealedEvent } from "@kernel/events";
import { host } from "@kernel/host";
import type { CkptAnchorMeta } from "@kernel/ipc";
import { captureAnchor, recordEdit, sealTurn } from "@plugins/checkpoints/store";

interface EvidenceDeps {
  capture: typeof captureAnchor;
  record: typeof recordEdit;
  seal: typeof sealTurn;
}

const defaultDeps: EvidenceDeps = { capture: captureAnchor, record: recordEdit, seal: sealTurn };

interface PendingPrompt {
  sessionId: string;
  text: string;
  meta: CkptAnchorMeta;
}

interface WriteTool {
  name: string;
  path: string;
}

function writeToolOf(rec: Record<string, unknown>): { id: string; tool: WriteTool } | null {
  const id = typeof rec.toolCallId === "string" ? rec.toolCallId : "";
  const name = typeof rec.toolName === "string" ? rec.toolName : "";
  const args = rec.args && typeof rec.args === "object" && !Array.isArray(rec.args)
    ? rec.args as Record<string, unknown>
    : {};
  const path = typeof args.path === "string" ? args.path.trim() : "";
  return id && (name === "write" || name === "edit") && path ? { id, tool: { name, path } } : null;
}

export class StructuredTurnEvidence {
  private activeSessionId: string | null = null;
  /* 锚定轮链:prompt open 记会话;settled 封存锚定轮后允许同链重挂 ——
   * reset 丢队列后的幽灵 agent_start 不伪造封存。 */
  private anchoredSessionId: string | null = null;
  private rearmSessionId: string | null = null;
  private readonly queued: PendingPrompt[] = [];
  /** queue_update 队列深度(steering+followUp 长度):≥1→0 变迁 = 排队
   *  follow_up 起跑轮界(omp 18.16/pi 1.4.0 双引擎实证,自主步零 queue_update)。
   *  agentStart 的队列消费保留为旧引擎(无 queue_update 帧)回落。 */
  private queueDepth = 0;
  private readonly tools = new Map<string, WriteTool>();
  private chain: Promise<void> = Promise.resolve();

  constructor(
    private readonly cwd: string,
    private readonly ledgerId: string,
    private readonly deps: EvidenceDeps = defaultDeps,
  ) {}

  /** 同一结构化 tab 的 anchor/edit/seal 严格按 RPC 事件顺序落账。 */
  private enqueue(operation: () => Promise<void>): void {
    this.chain = this.chain.then(operation).catch(() => undefined);
  }

  /** RPC 应答成功后才打锚；busy 排队消息等到对应 agent_start，避免切开在途轮。 */
  prompt(sessionId: string, text: string, meta: CkptAnchorMeta, queued = false): void {
    if (queued) this.queued.push({ sessionId, text, meta });
    else this.open({ sessionId, text, meta });
  }

  agentStart(sessionId: string): void {
    if (this.activeSessionId) return;
    const next = this.queued.shift();
    if (next) this.open(next.sessionId === sessionId ? next : { ...next, sessionId });
    /* 多步轮:步间 settled 已清归属,同锚定链空队列重挂(锚首轮已打,不补锚),
     * 后续步的 edit 仍落账、下一 settled 正常封存 —— 修多步轮存证失明。 */
    else if (sessionId && this.rearmSessionId === sessionId) this.activeSessionId = sessionId;
  }

  /** queue_update 原帧:队列 ≥1→0 变迁时消费排队锚(锚落 follow_up 起跑轮首,
   *  不再提前吃进上一轮自主步中段 —— B2-6,锚位歪斜修复)。 */
  queueUpdate(rec: Record<string, unknown>): void {
    const depth = (Array.isArray(rec.steering) ? rec.steering.length : 0)
      + (Array.isArray(rec.followUp) ? rec.followUp.length : 0);
    if (depth === 0 && this.queueDepth > 0) {
      const next = this.queued.shift();
      if (next) this.open(next);
    }
    this.queueDepth = depth;
  }

  private open(prompt: PendingPrompt): void {
    this.activeSessionId = prompt.sessionId;
    this.anchoredSessionId = prompt.sessionId;
    this.enqueue(() => this.deps.capture(
      this.cwd, prompt.sessionId, this.ledgerId, prompt.text, prompt.meta, "events",
    ));
  }

  toolExecution(rec: Record<string, unknown>): void {
    const type = rec.type;
    const id = typeof rec.toolCallId === "string" ? rec.toolCallId : "";
    const current = writeToolOf(rec);
    if (type !== "tool_execution_end") {
      if (current) this.tools.set(current.id, current.tool);
      return;
    }
    const tool = current?.tool ?? (id ? this.tools.get(id) : undefined);
    if (id) this.tools.delete(id);
    /* 完成帧才入账；bash 等工具即使返回成功也不猜文件副作用。 */
    const sessionId = this.activeSessionId;
    if (!sessionId || !tool || rec.isError === true) return;
    this.enqueue(() => this.deps.record(this.cwd, sessionId, this.ledgerId, tool.path));
  }

  /** 换进程前丢弃未发送队列与在途工具;已落账 Promise 链继续结算。
   *  keepSessionId:--resume 续跑同一引擎会话时保身份与在途工具集 ——
   *  重放在途轮的 tool_execution_end(可能无配对 start)仍落账
   *  (批次 6 存证封口,修重放盲区)。 */
  reset(keepSessionId?: string): void {
    this.activeSessionId = keepSessionId ?? null;
    this.queued.length = 0;
    this.queueDepth = 0; /* 换进程 = 引擎队列新起,旧深度不串场 */
    if (!keepSessionId) {
      this.tools.clear();
      this.anchoredSessionId = null;
      this.rearmSessionId = null;
    } else {
      /* resume 在途轮重放仍可封存(锚在换壳前已打)。 */
      this.rearmSessionId = this.anchoredSessionId;
    }
  }

  settled(): Promise<void> {
    /* settled 后的迟到 end 不得凭旧 start 补记到下一轮。 */
    this.tools.clear();
    const sessionId = this.activeSessionId;
    if (!sessionId) return this.chain;
    this.activeSessionId = null;
    this.rearmSessionId = this.anchoredSessionId === sessionId ? sessionId : null;
    this.enqueue(() => this.deps.seal(this.cwd, sessionId, this.ledgerId, (cwd, cliId, tmdSessionId) => {
      host.events.emit<CkptTurnSealedEvent>(KernelTopics.ckptTurnSealed, { cwd, sessionId: cliId, tmdSessionId });
    }));
    return this.chain;
  }
}
