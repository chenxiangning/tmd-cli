/**
 * footprint 域词典随插件自带:import 即注册(先例 workbench/journal/locales)。
 * 借用 checkpoints/locales.ts 键(同字面同义;键主权在彼方,彼方改名此处静默回落中文):
 * 看对话 / 已在转录查看器中打开 / 未能定位到该条对话消息 /
 * 定位这轮消息在对话中的位置(已结束的会话会先恢复再定位)
 */
import { registerMessages } from "@kernel/i18n";
import { MESSAGES_EN } from "./en";
import { MESSAGES_JA } from "./ja";

registerMessages({ en: MESSAGES_EN, ja: MESSAGES_JA });
