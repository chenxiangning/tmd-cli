/** tmd-lint 域词典注册(import 即注册,i18n.registerMessages 全局并入)。 */
import { registerMessages } from "@kernel/i18n";
import { MESSAGES_EN as en } from "./locales/en";
import { MESSAGES_JA as ja } from "./locales/ja";

registerMessages({ en, ja });
