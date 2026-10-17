/** agent wiki 域词典(memory-coordinator 插件自带;键 = 中文源串)。 */
import { registerMessages } from "@kernel/i18n";
import { MESSAGES_EN as en } from "./locales/en";
import { MESSAGES_JA as ja } from "./locales/ja";

registerMessages({ en, ja });
