/**
 * footprint 域词典随插件自带:import 即注册(先例 workbench/journal/locales)。
 */
import { registerMessages } from "@kernel/i18n";
import { MESSAGES_EN } from "./en";
import { MESSAGES_JA } from "./ja";

registerMessages({ en: MESSAGES_EN, ja: MESSAGES_JA });
