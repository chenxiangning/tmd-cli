/**
 * composer 扩展注册表 —— CLI 无关的 composer 能力契约(触发源 + 发送变换)。
 *
 * 与 CliProfile.triggers(CLI 私有触发符,各 cli-* 插件声明)并行:本注册表承接
 * 「客户端自有资产」一类的 CLI 无关触发源(提示词库 / 智能体),由 assets 等
 * feature 插件在 activate 期注册、composer 插件消费 —— 跨插件契约进 kernel 的惯例。
 *
 * composerWakeRef 唤醒桥:composer 挂载时交接,右缘 inputRail 唤醒图标经它让指定
 * 触发源弹出候选(模块级 ref 桥先例:composerSendRef / findRequestRef)。
 *
 * 纯注册表,零插件私有知识;运行期不增删(deactivate 反注册供测试与热退避用)。
 */

import type { CliSuggestion } from "./cli";

/** CLI 无关的 composer 触发源。 */
export interface ComposerTriggerSource {
  /** 触发符,支持多字符(如 "!!" / "##")。 */
  char: string;
  /** 候选面板分区标题。 */
  label: string;
  /** 同步返回候选(实现方读自己的内存 store);cwd 供工作区级过滤。 */
  list(cwd: string): CliSuggestion[];
  /** 选中后替换 token 的文本;缺省 = char + value;声明 onPick 后缺省 = 空串(token 回收)。 */
  insertText?: (s: CliSuggestion, cwd: string) => string;
  /** 选中副作用(如智能体置选中,不写文本)。 */
  onPick?: (s: CliSuggestion, sessionId: string | null) => void;
}

/** 发送前文本变换:translatePrompt 之后、CR / bracketedPaste 包装之前执行(注册序)。 */
export type ComposerSendTransform = (text: string, sessionId: string | null) => string;

/** 唤醒指定触发源的候选面板;composer 挂载期交接,未挂载 = null(欢迎页等无输入区场景)。 */
export const composerWakeRef: { current: ((char: string) => void) | null } = { current: null };

const triggerSources: ComposerTriggerSource[] = [];
const sendTransforms: ComposerSendTransform[] = [];

export function registerComposerTriggerSource(src: ComposerTriggerSource): () => void {
  triggerSources.push(src);
  return () => {
    const i = triggerSources.indexOf(src);
    if (i >= 0) triggerSources.splice(i, 1);
  };
}

export function registerComposerSendTransform(fn: ComposerSendTransform): () => void {
  sendTransforms.push(fn);
  return () => {
    const i = sendTransforms.indexOf(fn);
    if (i >= 0) sendTransforms.splice(i, 1);
  };
}

export function composerTriggerSources(): readonly ComposerTriggerSource[] {
  return triggerSources;
}

export function composerSendTransforms(): readonly ComposerSendTransform[] {
  return sendTransforms;
}
