export type DshRpcCall = (
  origin: string,
  method: string,
  args: unknown,
) => Promise<{ ok: boolean; value?: unknown; error?: unknown }>;

export interface WorkspaceResult {
  ok: boolean;
  workspaceId?: string;
  error?: unknown;
}

export interface SessionResult {
  ok: boolean;
  sessionId?: string;
  /** 非空 = 采用失败已回落新建(调用方提示)。 */
  adoptError?: string | null;
  error?: unknown;
}

export function openWorkspace(
  origin: string,
  workspacePath: string,
  rpcCall?: DshRpcCall,
): Promise<WorkspaceResult>;
export function createSession(
  origin: string,
  workspaceId: string,
  sessionId?: string,
  rpcCall?: DshRpcCall,
  pause?: (ms: number) => Promise<void>,
): Promise<SessionResult>;
