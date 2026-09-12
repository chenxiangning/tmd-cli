/**
 * memory 域词典(memory-coordinator 插件自带,i18n.registerMessages 注册)。
 * 键 = 中文源串;zh 恒等无词典。自 kernel/locales 迁出(2026-09-12 插件词典纪律)。
 */
import { registerMessages } from "@kernel/i18n";
import { MESSAGES_EN as en } from "./locales/en";
import { MESSAGES_JA as ja } from "./locales/ja";

registerMessages({ en, ja });
