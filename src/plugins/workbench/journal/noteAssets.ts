/**
 * 便签截图附件 io —— ⌘V 粘贴图 → assets/ 落文件;展示按文件名读 base64 缓存。
 * 文件名 = 日 key + 毫秒戳 + 原扩展(便签 JSON 只存引用,内容不进档)。
 */
import { ipc } from "@kernel/ipc";
import { dailyPaths, dayKey } from "./journalFiles";
import { ensureDir } from "@kernel/fsDirs";
import type { DayNoteImage } from "./journalFiles";

/** 内存缓存:文件名 → data URL(展示 URL;同图多格重复读免)。 */
const dataUrlCache = new Map<string, string>();

/** 展示 URL(找不到/读失败回落空串,组件隐藏)。 */
export function noteImageUrl(fileName: string): string {
  return dataUrlCache.get(fileName) ?? "";
}

/** 拉取并缓存一张附件图;失败返回空串(不缓存失败,下次再试)。缓存上限 200 FIFO。 */
export async function loadNoteImage(fileName: string): Promise<string> {
  const hit = dataUrlCache.get(fileName);
  if (hit) return hit;
  const paths = await dailyPaths();
  const b64 = await ipc.fsReadBytesBase64(`${paths.assets}/${fileName}`).catch(() => "");
  if (!b64) return "";
  const ext = fileName.includes(".") ? fileName.slice(fileName.lastIndexOf(".") + 1) : "png";
  const url = `data:image/${ext};base64,${b64}`;
  if (dataUrlCache.size >= 200) dataUrlCache.delete(dataUrlCache.keys().next().value as string);
  dataUrlCache.set(fileName, url);
  return url;
}

/** Blob → base64(纯前端转换)。 */
async function blobToBase64(blob: Blob): Promise<string> {
  const buf = await blob.arrayBuffer();
  let binary = "";
  const bytes = new Uint8Array(buf);
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

const EXT_OF: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif" };
/* 白名单外(image/svg、bmp…)拒贴:扩展名与内容不符比拒绝更糟。 */

/** 粘贴图落盘:写 assets/,返回便签图引用;失败返回 null(组件 toast 提示)。 */
export async function savePastedImage(y: number, m: number, d: number, blob: Blob, name?: string): Promise<DayNoteImage | null> {
  const ext = EXT_OF[blob.type];
  if (!ext) return null;
  /* 36 进制毫秒 + 随机尾巴:同毫秒双贴不互覆。 */
  const file = `${dayKey(y, m, d)}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}.${ext}`;
  const [paths, b64] = await Promise.all([dailyPaths(), blobToBase64(blob).catch(() => null)]);
  if (b64 === null) return null;
  try {
    await ensureDir(paths.assets);
    await ipc.fsWriteBytesBase64(`${paths.assets}/${file}`, b64);
  } catch {
    return null;
  }
  dataUrlCache.set(file, `data:image/${ext};base64,${b64}`);
  return { file, name: name || `clipboard.${ext}` };
}
