/**
 * lsp 域词典(插件自带,i18n.registerMessages 注册)。
 * 键 = 中文源串;zh 恒等无词典。
 */
import { registerMessages } from "@kernel/i18n";
import { MESSAGES_EN } from "./locales/en";
import { MESSAGES_JA } from "./locales/ja";

registerMessages({ en: MESSAGES_EN, ja: MESSAGES_JA });
