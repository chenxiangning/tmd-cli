/**
 * 二进制预览字节通道 —— pdf/xls/xlsx/docx 的共享数据层。
 *
 * ipc.readBinaryFileBase64(Rust 白名单+分档大小闸)→ base64 → Uint8Array。
 * 与 codemoss 差异(性能重写):codemoss 每次 tab 挂载都重新 fetch asset://;
 * 这里加进程内缓存(路径 → 字节,TTL 60s + 总量 64MB LRU 淘汰 + 在途去重),
 * 切 tab 往返不重复走 IPC/base64 解码。只读类型不会本地修改,磁盘外部变更由 TTL 兜底。
 */

import { ipc } from "@kernel/ipc";

const BYTES_CACHE_TTL_MS = 60_000;
const BYTES_CACHE_TOTAL_LIMIT = 64 * 1024 * 1024;

type CacheEntry = {
  bytes: Uint8Array;
  expiresAt: number;
};

const bytesCache = new Map<string, CacheEntry>();
const inFlight = new Map<string, Promise<Uint8Array>>();
let bytesCacheTotal = 0;

function rememberBytes(path: string, bytes: Uint8Array) {
  const expiresAt = Date.now() + BYTES_CACHE_TTL_MS;
  const previous = bytesCache.get(path);
  if (previous) {
    bytesCacheTotal -= previous.bytes.byteLength;
    bytesCache.delete(path);
  }
  bytesCache.set(path, { bytes, expiresAt });
  bytesCacheTotal += bytes.byteLength;
  while (bytesCacheTotal > BYTES_CACHE_TOTAL_LIMIT && bytesCache.size > 1) {
    const oldestKey = bytesCache.keys().next().value;
    if (oldestKey === undefined) {
      break;
    }
    const oldest = bytesCache.get(oldestKey);
    bytesCache.delete(oldestKey);
    bytesCacheTotal -= oldest?.bytes.byteLength ?? 0;
  }
}

/** base64 → Uint8Array(分块 atob,避免超长字符串的栈/参数限制)。 */
export function decodeBase64ToBytes(base64: string): Uint8Array {
  const withoutWhitespace = base64.replace(/\s+/g, "");
  const length = withoutWhitespace.length;
  const padding = withoutWhitespace.endsWith("==") ? 2 : withoutWhitespace.endsWith("=") ? 1 : 0;
  const byteLength = (length / 4) * 3 - padding;
  const bytes = new Uint8Array(byteLength);
  const chunkSize = 8192;
  let offset = 0;
  for (let index = 0; index < length; index += chunkSize) {
    const chunk = withoutWhitespace.slice(index, index + chunkSize);
    const decoded = atob(chunk);
    for (let i = 0; i < decoded.length && offset < byteLength; i += 1) {
      bytes[offset] = decoded.charCodeAt(i);
      offset += 1;
    }
  }
  return bytes;
}

/** 拉取二进制文件字节(缓存 + 在途去重);失败向上抛字符串错误。 */
export async function loadPreviewBytes(path: string): Promise<Uint8Array> {
  const cached = bytesCache.get(path);
  if (cached && cached.expiresAt > Date.now()) {
    /* LRU 触碰:移到末尾 */
    bytesCache.delete(path);
    bytesCache.set(path, cached);
    return cached.bytes;
  }
  if (cached) {
    bytesCacheTotal -= cached.bytes.byteLength;
    bytesCache.delete(path);
  }

  const pending = inFlight.get(path);
  if (pending) {
    return pending;
  }

  const request = (async () => {
    try {
      const base64 = await ipc.readBinaryFileBase64(path);
      const bytes = decodeBase64ToBytes(base64);
      rememberBytes(path, bytes);
      return bytes;
    } finally {
      inFlight.delete(path);
    }
  })();
  inFlight.set(path, request);
  return request;
}

/** data URL(base64)有效字节数 —— 图片信息行用,免 fetch(CSP connect-src 不放行 data:)。 */
export function dataUrlByteLength(dataUrl: string): number | null {
  const commaIndex = dataUrl.indexOf(",");
  if (!dataUrl.startsWith("data:") || commaIndex < 0) {
    return null;
  }
  const meta = dataUrl.slice(5, commaIndex);
  if (!meta.endsWith(";base64")) {
    return null;
  }
  const payload = dataUrl.slice(commaIndex + 1);
  const padding = payload.endsWith("==") ? 2 : payload.endsWith("=") ? 1 : 0;
  return Math.max(0, (payload.length / 4) * 3 - padding);
}

/** 测试通道:清空缓存与在途表。 */
export function clearPreviewBytesCacheForTests() {
  bytesCache.clear();
  inFlight.clear();
  bytesCacheTotal = 0;
}
