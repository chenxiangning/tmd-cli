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
 *   - src/plugins/cli-config(「CLI 独立配置」页经 providerPanel 挂载列表卡)
 *
 * 格式/存储为叶子库(只 import @kernel);列表/行/对话框 UI 也归本目录
 * (2026-09-12 自 cli-config 迁入:三家 cli-* 消费,≥2 cli 准入满足;
 * UI 件另依赖 kernel DialogShell / SecretInput 通用原语)。
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
export { ProviderChannelsCard } from "./ProviderChannelsCard";
export type { ProviderChannelsCardProps } from "./ProviderChannelsCard";
