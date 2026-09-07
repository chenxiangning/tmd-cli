/** dsh-project.js 的类型声明(Node CJS 脚本,供 vitest 与 TS 侧消费)。 */
export interface DshAction {
  sid: string | null;
  kind: "turn-start" | "turn-end" | "text" | "reasoning" | "tool" | "tool-result" | "approval" | "question";
  text?: string;
  turnKind?: string;
  error?: string | null;
  name?: string | null;
  input?: unknown;
  output?: unknown;
  rpcId?: string;
  approvalId?: string;
  toolName?: string;
  message?: string;
  questions?: unknown[];
}
export function projectFrame(raw: unknown): DshAction[];
