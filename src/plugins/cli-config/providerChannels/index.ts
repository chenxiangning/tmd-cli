/**
 * 供应商渠道 UI(卡片/行/对话框)—— 见 docs/superpowers/specs/2026-09-11-cli-provider-channels-design.md。
 *
 * 归属 cli-config(「CLI 独立配置」页 UI 所有者);cli-claude / cli-codex 经
 * registerCliConfig 的 providerPanel 槽挂载本卡片。格式/存储知识在
 * @plugins/cli-shared/providerChannels(叶子格式库)。
 */

export { ProviderChannelsCard } from "./ProviderChannelsCard";
export type { ProviderChannelsCardProps } from "./ProviderChannelsCard";
