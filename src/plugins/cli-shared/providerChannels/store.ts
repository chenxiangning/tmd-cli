/**
 * 渠道存储 —— 见 docs/superpowers/specs/2026-09-11-cli-provider-channels-design.md。
 *
 * 路径:`${configHomeDir()}/.tmd-cli/cli-channels.json`。读缺失 = 空 doc(不抛);
 * 读坏 JSON = 抛错(UI 阻断编辑,沿 cli-config/CliConfigTab.tsx 的「error 阻断」纪律);
 * 写 = 全量覆盖(体积小,行级 patch 不必要)。
 *
 * 备份壳:走 backup.ts(每路径每会话首次写前备份 .bak-tmd,不滚存)。
 */

import { ipc } from "@kernel/ipc";
import type { Channel, ChannelDoc, EngineChannels, SupportedEngineId } from "./types";
import { ENGINE_IDS } from "./types";
import { backupOnce } from "./backup";

const CHANNELS_FILENAME = "cli-channels.json";
const CHANNELS_DIR = ".tmd-cli";

export function channelsFilePath(home: string): string {
  return `${home}/${CHANNELS_DIR}/${CHANNELS_FILENAME}`;
}

/** 空 doc(没有任何引擎条目),按 ENGINE_IDS 预占位。 */
export function emptyChannelDoc(): ChannelDoc {
  const engines: Record<string, EngineChannels> = {};
  for (const id of ENGINE_IDS) engines[id] = { providers: {}, current: null };
  return { version: 1, engines };
}

/** 读到的文本 → doc。空文本 = 空 doc;坏 JSON / version 不符 = 抛错。 */
export function parseChannelDoc(text: string): ChannelDoc {
  const trimmed = text.trim();
  if (!trimmed) return emptyChannelDoc();
  const v: unknown = JSON.parse(trimmed);
  if (!v || typeof v !== "object" || Array.isArray(v))
    throw new Error("cli-channels.json 顶层必须是对象");
  const obj = v as Record<string, unknown>;
  if (obj.version !== 1) throw new Error(`cli-channels.json version 不支持: ${String(obj.version)}`);
  const enginesRaw = obj.engines;
  if (!enginesRaw || typeof enginesRaw !== "object" || Array.isArray(enginesRaw))
    throw new Error("cli-channels.json engines 必须是对象");
  const engines: Record<string, EngineChannels> = {};
  for (const id of ENGINE_IDS) {
    const e = (enginesRaw as Record<string, unknown>)[id];
    if (!e || typeof e !== "object" || Array.isArray(e)) {
      engines[id] = { providers: {}, current: null };
      continue;
    }
    const er = e as Record<string, unknown>;
    const providersRaw = er.providers;
    const providers: Record<string, Channel> = {};
    if (providersRaw && typeof providersRaw === "object" && !Array.isArray(providersRaw)) {
      for (const [pid, pv] of Object.entries(providersRaw as Record<string, unknown>)) {
        if (!pv || typeof pv !== "object" || Array.isArray(pv)) continue;
        providers[pid] = pv as Channel;
      }
    }
    engines[id] = {
      providers,
      current: typeof er.current === "string" ? er.current : null,
    };
  }
  return { version: 1, engines };
}

export function serializeChannelDoc(doc: ChannelDoc): string {
  return JSON.stringify(doc, null, 2) + "\n";
}

/** 缺补白名单引擎 key(向前兼容:新增 cli-* 时老 doc 自动获得空 engines[id])。 */
export function normalizeDoc(doc: ChannelDoc): ChannelDoc {
  const engines = { ...doc.engines };
  for (const id of ENGINE_IDS) {
    if (!engines[id]) engines[id] = { providers: {}, current: null };
  }
  return { version: 1, engines };
}

/** 读 doc:ENOENT → 空;error → 抛错到 UI。 */
export async function loadChannelDoc(): Promise<ChannelDoc> {
  const home = await ipc.configHomeDir().catch(() => null);
  if (!home) throw new Error("无法解析 tmd-cli 配置根目录");
  const path = channelsFilePath(home);
  let text = "";
  try {
    text = await ipc.fsReadFile(path);
  } catch {
    return emptyChannelDoc();
  }
  return normalizeDoc(parseChannelDoc(text));
}

/** 写 doc:全量覆盖,沿 .bak-tmd 备份壳(backup.ts)。 */
export async function saveChannelDoc(doc: ChannelDoc): Promise<void> {
  const home = await ipc.configHomeDir();
  const path = channelsFilePath(home);
  await backupOnce(path);
  await ipc.fsWriteFile(path, serializeChannelDoc(doc));
}

/** 单渠道操作辅助:返回新 doc(不可变)。 */
export function upsertChannel(doc: ChannelDoc, engineId: SupportedEngineId, ch: Channel): ChannelDoc {
  const engines = { ...doc.engines };
  const eng = engines[engineId] ?? { providers: {}, current: null };
  engines[engineId] = {
    providers: { ...eng.providers, [ch.id]: ch },
    current: eng.current,
  };
  return { version: 1, engines };
}

export function removeChannel(
  doc: ChannelDoc,
  engineId: SupportedEngineId,
  channelId: string,
): ChannelDoc {
  const engines = { ...doc.engines };
  const eng = engines[engineId];
  if (!eng) return doc;
  const providers = { ...eng.providers };
  delete providers[channelId];
  engines[engineId] = {
    providers,
    current: eng.current === channelId ? null : eng.current,
  };
  return { version: 1, engines };
}

export function setCurrent(
  doc: ChannelDoc,
  engineId: SupportedEngineId,
  channelId: string | null,
): ChannelDoc {
  const engines = { ...doc.engines };
  const eng = engines[engineId] ?? { providers: {}, current: null };
  if (channelId !== null && !eng.providers[channelId]) return doc;
  engines[engineId] = { providers: eng.providers, current: channelId };
  return { version: 1, engines };
}

/** 6 位短随机 id(36^6 ≈ 22 亿,单机碰撞可忽略;真撞由 store map 覆盖语义兜底)。 */
export function genChannelId(): string {
  return `ch_${Math.random().toString(36).slice(2, 8)}`;
}
