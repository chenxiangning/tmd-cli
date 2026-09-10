/**
 * 本地插件信任闸与扫描记录 —— 自 localPlugins.ts 拆出(文件规模铁则)。
 * 信任绑定「entry 内容 hash + manifest hash」双令牌(settings.localPluginTrust);
 * 扫描条目 → 记录的构造与可激活判定也在此(manifest 校验完成于记录期,坏条目不 import)。
 */
import {
  manifestPermissions,
  synthesizeMeta,
  validateManifest,
} from "./localPluginLoad";
import type { LocalPluginScanEntry } from "./ipc";
import { getSettingsState } from "./settings";
import { records, type LocalPluginRecord } from "./localPluginStore";

/** 信任闸判据(双绑定):entry 内容 hash + manifest hash 都对得上才算确认过。 */
export function trustToken(contentHash: string, manifestHash: string | null): string {
  return `${contentHash}:${manifestHash ?? ""}`;
}

/** 该 id 的该内容+manifest 是否已被用户确认过(信任按内容,不按插件名)。 */
export function isContentTrusted(
  id: string,
  contentHash: string | null,
  manifestHash: string | null,
): boolean {
  return (
    contentHash !== null &&
    getSettingsState().settings.localPluginTrust[id]?.includes(trustToken(contentHash, manifestHash)) === true
  );
}

export function isDisabled(id: string): boolean {
  return getSettingsState().settings.disabledPlugins.includes(id);
}

export function entryNameOf(manifest: Record<string, unknown>): string {
  const e = manifest.entry;
  return typeof e === "string" && e ? e : "index.js";
}

/** 扫描条目 → 记录(manifest 校验在此完成;坏条目不 import)。 */
export function scanToRecord(
  entry: LocalPluginScanEntry,
  builtinIds: ReadonlySet<string>,
): LocalPluginRecord {
  const prev = records.get(entry.id);
  const manifest = entry.manifest;
  const contentHash = manifest
    ? (entry.files.find((f) => f.name === entryNameOf(manifest))?.sha256 ?? null)
    : null;
  const manifestHash = entry.files.find((f) => f.name === "manifest.json")?.sha256 ?? null;
  const rec: LocalPluginRecord = {
    id: entry.id,
    origin: "local",
    manifest: entry.manifest ?? null,
    meta: entry.manifest ? synthesizeMeta(entry.manifest) : null,
    manifestHash,
    permissions: entry.manifest ? manifestPermissions(entry.manifest) : null,
    versions: entry.versions,
    error: entry.error ?? null,
    /* 激活失败是「内容」的属性:内容变了旧错误即过时,不继承。 */
    activateError:
      prev?.activateError != null && prev.contentHash !== null && prev.contentHash === contentHash
        ? prev.activateError
        : null,
    activatedHash: prev?.activatedHash ?? null,
    removed: false,
    contentHash,
  };
  if (rec.error || !manifest) return rec;
  const verr = validateManifest(manifest, builtinIds);
  if (verr) {
    rec.error = verr;
    return rec;
  }
  if (!rec.contentHash) rec.error = `入口缺失或超过 16MB 上限: ${entryNameOf(manifest)}`;
  return rec;
}

/** 记录可激活(过信任闸 + 未被拔出 + 无加载错误 + 有内容戳)。 */
export function activatable(rec: LocalPluginRecord): boolean {
  return (
    !rec.error &&
    rec.contentHash !== null &&
    isContentTrusted(rec.id, rec.contentHash, rec.manifestHash) &&
    !isDisabled(rec.id)
  );
}

/** 激活成功落戳(唯一落点):activatedHash 定格 + 清激活错误。 */
export function markActivated(id: string): void {
  const rec = records.get(id);
  if (rec) {
    rec.activatedHash = rec.contentHash;
    rec.activateError = null;
  }
}
