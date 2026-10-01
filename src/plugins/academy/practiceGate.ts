/**
 * 「试一试」前置闸(纯函数,单测面)—— audit B3 收口:
 * 无 composer(欢迎页等)静默丢命令、激活会话引擎 ≠ 课程引擎仍插命令,
 * 都改为给引导文案:不插入命令、不结课。规则:宁放行勿误伤 —— 引擎不可知
 * (有输入框但无活跃会话)不拦,课程引擎未知形态不猜。
 */
import { t } from "@kernel/i18n";

export interface PracticeGateInput {
  /** 课程归属引擎(cliId,对齐 CliProfile.id)。 */
  cliId: string;
  /** composer 输入框在挂载(composerInsertRef.current != null)。 */
  hasComposer: boolean;
  /** 激活会话引擎(profileId / ssh engine;无活跃会话 = null)。 */
  activeEngine: string | null;
}

/** 可插入 = null;否则返回引导文案(调用方原地展示,不插命令不结课)。 */
export function practiceGate(input: PracticeGateInput): string | null {
  if (!input.hasComposer) {
    return t("先打开任意工作区会话再试(当前页面没有命令输入框)");
  }
  if (input.activeEngine && input.activeEngine !== input.cliId) {
    return t("本课命令属于 {engine} 会话;当前激活的是 {current},切换后再试", {
      engine: input.cliId,
      current: input.activeEngine,
    });
  }
  return null;
}
