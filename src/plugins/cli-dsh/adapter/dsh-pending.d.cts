export interface PendingInfo {
  kind: "approval" | "question";
  sessionId: string;
  approvalId?: string;
  toolName?: string;
  message?: string;
  questions?: Array<{ id?: string; header?: string; question?: string; options?: Array<{ label?: string } | string> }>;
}
export interface PendingDeps {
  print: Record<string, unknown>;
  render: { band(name: string, line: string): string };
  zone: { show(l: string[], e: Array<(() => void) | null>): void; hide(): void };
  menu: unknown;
  pending: Map<string, PendingInfo>;
  ORIGIN: string;
  respondApproval: (...a: never[]) => unknown;
  respondQuestion: (...a: never[]) => unknown;
  respondQuestionCancel: (...a: never[]) => unknown;
  onSettled?: () => void;
}
export interface PendingCards {
  showApproval(rpcId: string, info: PendingInfo): void;
  showQuestion(rpcId: string, info: PendingInfo): void;
  onKey(k: string): boolean;
  onWheel(row: number, dir: number): boolean;
  onChar(ch: string): boolean;
  onLine(line: string): boolean;
  closeFor(why: string): void;
  isOpen(): boolean;
}
export function createPendingCards(deps: PendingDeps): PendingCards;
