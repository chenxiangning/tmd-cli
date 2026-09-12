/** dsh-project.js 的类型声明(Node CJS 脚本,供 vitest 与 TS 侧消费)。 */
export interface DshAction {
  sid: string | null;
  kind:
    | "turn-start"
    | "turn-end"
    | "text"
    | "reasoning"
    | "tool"
    | "tool-result"
    | "approval"
    | "question"
    | "snapshot"
    | "events-ready";
  text?: string;
  turnKind?: string;
  error?: string | null;
  name?: string | null;
  input?: unknown;
  output?: unknown;
  /** waterfall 应答键(审批/提问);旧协议 rpcId 位。 */
  eventId?: string;
  toolName?: string;
  message?: string;
  questions?: unknown[];
  records?: unknown[];
  header?: unknown;
  projections?: unknown;
  clientId?: string | null;
}
/** value = mux 下行帧的 value;channel = "follow" | "events";sessionId 仅 follow 流有意义。 */
export function projectFrame(value: unknown, channel: "follow" | "events", sessionId: string | null): DshAction[];
