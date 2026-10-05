/**
 * pi 族 RPC 协议类型(omp/pi `--mode rpc` NDJSON)。
 * 从 piRpc.ts 拆出:piRpc 恒满 300,类型块独立成家;所有形状均为 18.6.0 真机
 * 抓包实证(2026-10-04,见 piRpc.ts 头注)。CLI 私有格式知识不越出 cli-shared。
 */

/** 家族分叉:启动命令 + 断线接续旗标(monocode piFlavor 同参照)。 */
export interface PiRpcFlavor {
  command: string;
  /** 接续旗标(omp --resume <id> / pi --session <id>;2026-10-04 实证与 rpc 模式共存);缺省 = 新会话。 */
  resumeArgs?: (sessionId: string) => string[];
}

/** 模型行(get_available_models → models[];provider+id 唯一定位,name 展示)。 */
export type PiRpcModel = { provider: string; id: string; name?: string };

/** get_state 提炼的会话身份(握手与模型菜单刷新共用)。 */
export interface PiRpcState {
  sessionId?: string;
  model?: PiRpcModel;
  thinkingLevel?: string;
  queuedMessageCount?: number;
}

/** get_session_stats 提炼的会话用量(tokens.total + contextUsage.percent)。 */
export interface PiRpcStats {
  totalTokens?: number;
  contextPercent?: number;
}

/** / 命令目录行(get_available_commands → commands[];hint 来自 input.hint)。 */
export interface PiRpcCommand {
  name: string;
  description?: string;
  hint?: string;
}

/** 审批请求(extension_ui_request confirm;答案经 respond 回写)。
 *  frameId 保原始类型(JSON-RPC id 可为数字;数值 confirm 帧若被字符串化,
 *  引擎同型匹配不认领 → 审批静默丢失挂死轮次 —— 与 normWidgetFrameId 同律,
 *  2026-10-03 二轮复查);React key 与 respond 透传都吃 string|number。 */
export interface PiRpcConfirm {
  frameId: string | number;
  title: string;
  message: string;
}

export function parseState(d: Record<string, unknown>): PiRpcState {
  const m = d.model as Record<string, unknown> | null | undefined;
  return {
    sessionId: typeof d.sessionId === "string" ? d.sessionId : undefined,
    model: m && typeof m.provider === "string" && typeof m.id === "string"
      ? { provider: m.provider, id: m.id, name: typeof m.name === "string" ? m.name : undefined }
      : undefined,
    thinkingLevel: typeof d.thinkingLevel === "string" ? d.thinkingLevel : undefined,
    queuedMessageCount: typeof d.queuedMessageCount === "number" ? d.queuedMessageCount : undefined,
  };
}
