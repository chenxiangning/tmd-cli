/**
 * 供应商渠道(providerChannels)格式库 —— 见 docs/superpowers/specs/2026-09-11-cli-provider-channels-design.md。
 *
 * ## 跨插件契约说明(准入依据)
 *
 * 准入门槛:≥2 个 cli-* 插件消费同一磁盘格式知识(沿 AGENTS.md §1 cli-shared 准入纪律)。
 *
 * 本目录消费方:
 *   - src/plugins/cli-claude(channelApply 备份壳/类型 + registerCliConfig providerPanel)
 *   - src/plugins/cli-codex(同上)
 *   - src/plugins/cli-config/providerChannels(UI 卡片,格式知识经此消费)
 *
 * 本目录是叶子格式库:只 import @kernel,不 import 任何插件;
 * 列表/对话框 UI 在 cli-config/providerChannels(页面所有者)。
 *
 * ## 零内核字
 *
 * 渠道 schema 走 @kernel/ipc 通用原语(fsReadFile/fsWriteFile + sqliteQuery),无 CLI 私有知识。
 */

export type { Channel, EngineChannels, ChannelDoc, SupportedEngineId } from "./types";
export { ENGINE_IDS } from "./types";
export {
  channelsFilePath,
  parseChannelDoc,
  serializeChannelDoc,
  loadChannelDoc,
  saveChannelDoc,
  upsertChannel,
  removeChannel,
  setCurrent,
  genChannelId,
  emptyChannelDoc,
  normalizeDoc,
} from "./store";
export { backupOnce, restoreFromBackup, resetBackupsForTest } from "./backup";
export {
  parseCcSwitchJson,
  parseCcSwitchDbRows,
  normalizeProvider,
  dedupeCcSwitchImport,
  probeCcSwitch,
  readCcSwitchV2,
  readCcSwitchV3,
  type CcSwitchDbRow,
  type CcSwitchRawEntry,
} from "./ccswitch";
