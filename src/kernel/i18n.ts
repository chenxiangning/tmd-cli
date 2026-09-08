/**
 * i18n 内核 —— gettext 式查表:中文源串即 key(zh 恒等),en/ja 词典按域分文件
 * (locales/<lang>/<domain>.ts,域文件由文案迁移按归属写入)。
 *
 * 即时生效机制:main.tsx 根组件以 key={settings.language} 整树重挂载(低频操作,
 * host/PTY 态在 React 外不受影响,幕布本就按重挂载回放设计);bootI18n 另同步
 * <html lang>。约定:模块顶层数据(cli profile 描述、快捷键命令名等)不在定义处
 * 调 t(),消费点渲染时 t(field) 包裹,避免 import 期固化语言。
 *
 * 插值:t("共 {n} 条", { n }) —— {name} 占位符全量替换;无复数/性别/日期格式。
 */

import { getSettingsState, subscribeSettings } from "./settings";
import type { UiLanguage } from "./settingsAppearance";
import { EN_MESSAGES } from "./locales/en";
import { JA_MESSAGES } from "./locales/ja";

const DICTIONARIES: Record<Exclude<UiLanguage, "zh">, Record<string, string>> = {
  en: EN_MESSAGES,
  ja: JA_MESSAGES,
};

/** 查词典 + 插值;缺失键回落源中文串(zh 或未迁移文案的兜底语义)。 */
export function t(
  key: string,
  params?: Record<string, string | number | null | undefined>,
): string {
  const { language } = getSettingsState().settings;
  let text = language === "zh" ? key : (DICTIONARIES[language][key] ?? key);
  if (params) {
    for (const [name, value] of Object.entries(params)) {
      if (value === null || value === undefined) continue; // 空值占位符原样保留
      text = text.replaceAll(`{${name}}`, String(value));
    }
  }
  return text;
}

/** 语言显示名:以各自语言自称(不随界面语言翻译,设置页 segmented 用)。 */
export const LANGUAGE_LABELS: Record<UiLanguage, string> = {
  zh: "简体中文",
  en: "English",
  ja: "日本語",
};

/** 启动时调用一次(main.tsx):同步 <html lang>,语言切换时跟随。幂等。 */
let i18nBooted = false;
export function bootI18n(): void {
  if (i18nBooted) return;
  i18nBooted = true;
  const sync = () => {
    if (typeof document === "undefined") return; // 测试 node 环境无 DOM
    document.documentElement.lang = getSettingsState().settings.language;
  };
  sync();
  subscribeSettings(sync);
}
