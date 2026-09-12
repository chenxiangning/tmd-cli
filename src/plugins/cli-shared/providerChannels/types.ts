/**
 * 供应商渠道(Provider Channels)数据类型 —— 见 docs/superpowers/specs/2026-09-11-cli-provider-channels-design.md。
 *
 * 跨插件契约(准入依据:cli-claude + cli-codex + cli-omp 三 cli-* 插件消费同一格式知识),
 * 写入方 = ProviderChannelsCard(增删改)+ 各 cli-* plugin 的 channelApply(切换);
 * 存储 = ~/.tmd-cli/cli-channels.json。内核零字。
 */

/** 单条渠道。baseUrl/apiKey/model 三个键名是各 cli-* 插件共同消费的形态契约。 */
export interface Channel {
  /** 存储 map key(provider ID),创建时生成。 */
  id: string;
  name: string;
  remark?: string;
  baseUrl?: string;
  model?: string;
  apiKey?: string;
  /** 来自 cc-switch 导入;手动创建 = undefined。 */
  source?: "cc-switch";
  /** cc-switch v3 db 主键;source=cc-switch 时必填,作为去重键。 */
  ccsId?: string;
  /** 用户态持久化,不影响切换语义。 */
  createdAt: number;
}

export interface EngineChannels {
  providers: Record<string, Channel>;
  current: string | null;
}

export interface ChannelDoc {
  version: 1;
  engines: Record<string, EngineChannels>;
}

/** 引擎 id 字面量集合,新增 cli-* 时 union 扩展,写盘后白名单以外不读。 */
export type SupportedEngineId = "claude" | "codex";

/** 引擎 id 集合(store 预占位 + 解析白名单)。 */
export const ENGINE_IDS: readonly SupportedEngineId[] = ["claude", "codex"] as const;
