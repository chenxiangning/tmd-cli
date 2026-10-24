import { t } from "@kernel/i18n";

/** 模型位可点性与标题(纯计算):ask 等待期恒禁(此时任何写入都会被 CLI 当
 *  作答案文本提交,命令形态永不达意);声明 modelCommandMidTurn 的 CLI(omp,
 *  TUI 支持流中弹出模型选择)轮中随时可发;其余对话进行中不可发(会串进
 *  输出流),等轮次结算(呼吸灯蓝态结束)才生效。
 *  回归钉:WSL 重构(b7fe1c71)曾把 omp 轮中豁免收丢,轮中点击永远无响应。 */
export function modelClickState(
  noSession: boolean,
  turnActive: boolean,
  midTurnAllowed: boolean,
  waitingConfirm = false,
): { clickable: boolean; title: string } {
  if (noSession) return { clickable: false, title: t("未识别模型") };
  if (waitingConfirm) return { clickable: false, title: t("等待确认中,先在面板作答") };
  if (turnActive && !midTurnAllowed)
    return { clickable: false, title: t("对话进行中,本轮结束后可点击切换模型") };
  return { clickable: true, title: t("点击发送 /model 打开 CLI 模型选择") };
}
