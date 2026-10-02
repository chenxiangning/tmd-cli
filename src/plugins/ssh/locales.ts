/**
 * ssh 域词典(ssh 插件自带,i18n.registerMessages 注册)。
 * 键 = 中文源串;zh 恒等无词典。存量词条在 kernel/locales/<lang>/ssh.ts,
 * 2026-10-02 起新增单插件词条随插件自带(kernel 词典不再收纳)。
 */
import { registerMessages } from "@kernel/i18n";
import { MESSAGES_EN } from "./locales/en";
import { MESSAGES_JA } from "./locales/ja";

registerMessages({ en: MESSAGES_EN, ja: MESSAGES_JA });
