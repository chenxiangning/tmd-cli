/**
 * 空输入方向键 → 幕布焦点移交的判定(纯函数,单测覆盖五行顺序契约)。
 *
 * 判定顺序(openspec design §6):
 * 1. IME 组合中 → 不移交(交给输入法)
 * 2. 触发符候选下拉打开 → 下拉自己的 ↑↓,不移交
 * 3. 非空输入 → ↑↓ 是光标移动,不移交(抢走会打断编辑)
 * 4. 其余(空输入的 ↑/↓)→ 移交幕布
 * 幕布拿到焦点后按键经 PTY 原生透传,语义(历史/选择)归各 CLI 自行解释。
 */

type ArrowIntent = "handoff" | "default";

interface ArrowIntentInput {
  key: string;
  /** 当前输入框文本(trim 判空)。 */
  value: string;
  /** 触发符候选下拉是否打开。 */
  hasMatches: boolean;
  /** 是否处于 IME 组合状态。 */
  isComposing: boolean;
}

export function resolveArrowIntent(input: ArrowIntentInput): ArrowIntent {
  if (input.key !== "ArrowUp" && input.key !== "ArrowDown") return "default";
  if (input.isComposing) return "default";
  if (input.hasMatches) return "default";
  if (input.value.trim() !== "") return "default";
  return "handoff";
}
