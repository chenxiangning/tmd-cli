/**
 * pi 族 RPC 协议类型(omp/pi `--mode rpc` NDJSON)。
 * 从 piRpc.ts 拆出:piRpc 恒满 300,类型块独立成家;所有形状均为 18.6.0 真机
 * 抓包实证(2026-10-04,见 piRpc.ts 头注)。CLI 私有格式知识不越出 cli-shared。
 */

import type { CliTranscriptBlock } from "@kernel/cli";
import type { PiLiveSurface } from "./piRpcReducer";


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
  /** 引擎版本(get_state 若带;协议层留位,UI 消费待字段名实证后接)。 */
  version?: string;
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

/** 事件回调面(PiRpcSession 构造入参;转录快照 + 生命周期边沿)。 */
export interface PiRpcHandlers {
  /** 转录块快照(变更即新数组引用)+ 当前轮首块下标(渲染层切「落定历史|流内活轮」)
   * + 流内活跃输出面(活思考/正文据此展开,与块位置无关)。 */
  onBlocks: (blocks: CliTranscriptBlock[], turnStart: number, liveSurface: PiLiveSurface) => void;
  /** 轮次进行中/结算(session_settled 边沿)。 */
  onBusy: (busy: boolean) => void;
  /** 工具执行原始帧(structured-session 成功写工具存证;展示仍走 reducer)。 */
  onToolExecution?: (rec: Record<string, unknown>) => void;
  /** queue_update 原帧(steering/followUp 数组 = 队列深度;B2-6 实证:队列
   *  ≥1→0 变迁 = 排队 follow_up 起跑轮界,omp 18.16/pi 1.4.0 双引擎同形,
   *  自主步零 queue_update)。变迁检测归存证消费方。 */
  onQueueUpdate?: (rec: Record<string, unknown>) => void;
  /** 审批请求;respond 由消费方 UI 调用(confirmId 传入)。 */
  /** 协议帧被丢弃(半行/超限截断;首次即告,一次性)。 */
  onDroppedFrame?: () => void;
  onConfirm: (req: PiRpcConfirm) => void;
  /** 子进程退出(code null = 被杀);此后会话终态。 */
  onExit: (code: number | null) => void;
  /** 协议/连接异常(展示态,不断链)。 */
  onError: (message: string) => void;
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
    version: typeof d.version === "string" ? d.version : undefined,
  };
}
