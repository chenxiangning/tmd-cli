/**
 * promptSent 广播轮次闸 —— 只有「会开启新对话轮次」的发送才广播。
 *
 * promptSent 的唯一消费语义是审批线锚点(一轮对话开始)+ 时间线在途标记;
 * 把不开轮的输入当轮次,审批线就被切成假批次 —— 2026-09-08 账本实证:
 * 轮中 /model 切模型与 ask 工具作答各起一个锚点,在途轮被拦腰切断,
 * 实施批 19 个文件挂到 "/model" 名下,真提示词轮空封消失,
 * 批次序号与时间线轮次彻底脱钩(omp 会话 JSONL 里它们都不是 user 行)。
 *
 * 两道闸(state 须在 writeSession 前现读 —— 用户写入即清 ask 等待态):
 * 1. ask 作答:Ask/确认面板阻塞等待时,一切发送都是本轮的中段输入,续当前轮不起锚;
 * 2. 轮中斜杠:对话进行中 "/" 前缀输入被 CLI TUI 就地消费(omp 流中弹模型选择先例),
 *    不开轮不切批。
 *
 * ponytail:轮中斜杠一律视为控制命令 —— 若某 CLI 把轮中斜杠排队成真实消息,
 * 该轮改动漏记(宁漏勿串方向);升级路径 = CliProfile 声明控制命令精确表。
 * 空闲斜杠照广播:自定义命令可能展开成提示词真开轮,空封锚点不占审批线。
 * "!" 壳透传不拦:git 归因 CLI 的壳写入靠窗口推断归入该锚点,是有效覆盖。
 */
import { host } from "@kernel/host";
import { KernelTopics } from "@kernel/events";

/** 轮次闸输入:两个内核守望的瞬时态(writeSession 前读)。 */
export interface PromptGateState {
  /** Ask/确认面板阻塞等待中(host.isWaitingConfirm)。 */
  waitingConfirm: boolean;
  /** 对话轮次进行中(host.isTurnActive)。 */
  turnActive: boolean;
}

/** 纯判定:这次发送会不会开启新对话轮次。 */
export function shouldBroadcastPrompt(state: PromptGateState, text: string): boolean {
  if (state.waitingConfirm) return false;
  if (state.turnActive && text.startsWith("/")) return false;
  return true;
}

/** 写前现读轮次闸态(writeSession 作答即清等待态,事后读不到)。 */
export function readPromptGate(sessionId: string): PromptGateState {
  return {
    waitingConfirm: host.isWaitingConfirm(sessionId),
    turnActive: host.isTurnActive(sessionId),
  };
}

/** 过闸后广播 promptSent(text 截 400 字,供审批线锚点快照)。 */
export function emitPromptSent(gate: PromptGateState, sessionId: string, text: string): void {
  if (!shouldBroadcastPrompt(gate, text)) return;
  host.events.emit(KernelTopics.promptSent, { sessionId, text: text.slice(0, 400) });
}
