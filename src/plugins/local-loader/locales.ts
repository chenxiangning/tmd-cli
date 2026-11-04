/**
 * local-loader 域词典(插件自带,i18n.registerMessages 注册)。
 * 键 = 中文源串;zh 恒等无词典。
 */
import { registerMessages } from "@kernel/i18n";

/** en 词典 · local-loader 域。 */
const MESSAGES_EN = {
  "插件与扩展": "Plugins & extensions",
  "管理内置插件启停与 ~/.tmd-cli/plugins/ 本地插件。":
    "Manage built-in plugin enablement and local plugins in ~/.tmd-cli/plugins/.",
  "插件与扩展管理": "Plugin & extension management",
  "在插件市场统一查看内置与本地插件;本地插件支持信任确认、免重启装载和版本回退。":
    "View built-in and local plugins in the plugin market; local plugins support trust confirmation, hot loading, and version rollback.",
  "内置插件": "Built-in plugins",
  "在插件市场插拔内置能力;变更写入启停清单,重启后生效。":
    "Plug or unplug built-in capabilities in the plugin market; changes are saved to the enablement list and take effect after restart.",
  "本地插件": "Local plugins",
  "管理 ~/.tmd-cli/plugins/ 下的本地插件:信任确认、免重启装载与版本回退。":
    "Manage local plugins under ~/.tmd-cli/plugins/: trust confirmation, hot loading, and version rollback.",
  "打开插件市场": "Open plugin market",
  "当前运行环境暂不支持打开插件市场。":
    "The plugin market is not available in the current runtime.",
} as const;

/** ja 词典 · local-loader 域。 */
const MESSAGES_JA = {
  "插件与扩展": "プラグインと拡張",
  "管理内置插件启停与 ~/.tmd-cli/plugins/ 本地插件。":
    "組み込みプラグインの有効化と ~/.tmd-cli/plugins/ のローカルプラグインを管理します。",
  "插件与扩展管理": "プラグインと拡張の管理",
  "在插件市场统一查看内置与本地插件;本地插件支持信任确认、免重启装载和版本回退。":
    "プラグインマーケットで組み込みプラグインとローカルプラグインを統合表示;ローカルプラグインは信頼確認、再起動なしの読み込み、バージョン巻き戻しに対応。",
  "内置插件": "組み込みプラグイン",
  "在插件市场插拔内置能力;变更写入启停清单,重启后生效。":
    "プラグインマーケットで組み込み機能を着脱;変更は有効化一覧に保存され、再起動後に有効になります。",
  "本地插件": "ローカルプラグイン",
  "管理 ~/.tmd-cli/plugins/ 下的本地插件:信任确认、免重启装载与版本回退。":
    "~/.tmd-cli/plugins/ のローカルプラグインを管理:信頼確認、再起動なしの読み込み、バージョン巻き戻し。",
  "打开插件市场": "プラグインマーケットを開く",
  "当前运行环境暂不支持打开插件市场。":
    "現在の実行環境ではプラグインマーケットを開けません。",
} as const;

registerMessages({ en: MESSAGES_EN, ja: MESSAGES_JA });
