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
  private readonly queued: PendingPrompt[] = [];
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
  }

  private open(prompt: PendingPrompt): void {
    this.activeSessionId = prompt.sessionId;
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

  /** 换进程前丢弃未发送队列与在途工具;已落账 Promise 链继续结算。 */
  reset(): void {
    this.activeSessionId = null;
    this.queued.length = 0;
    this.tools.clear();
  }

  settled(): Promise<void> {
    /* settled 后的迟到 end 不得凭旧 start 补记到下一轮。 */
    this.tools.clear();
    const sessionId = this.activeSessionId;
    if (!sessionId) return this.chain;
    this.activeSessionId = null;
    this.enqueue(() => this.deps.seal(this.cwd, sessionId, this.ledgerId, (cwd, cliId, tmdSessionId) => {
      host.events.emit<CkptTurnSealedEvent>(KernelTopics.ckptTurnSealed, { cwd, sessionId: cliId, tmdSessionId });
    }));
    return this.chain;
  }
}
