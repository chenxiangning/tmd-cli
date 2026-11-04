/**
 * RPC 用户块图片 token 纯函数与加载 —— 自 ssUserBlock 拆出(react-doctor
 * only-export-components + 300 行铁则)。识别用户文本中的图片文件 token
 * (@/abs/path/img.png),加载(经 kernel ipc.fsReadBytesBase64 通用原语转
 * data URL,模块级缓存)。CJK 句读紧跟路径是常态:路径段允许点号与斜杠、
 * 排除空白与句读标点,贪婪 \S+ 会把后面的中文一并吞掉。
 */
import type { CliTranscriptBlock } from "@kernel/cli";
import { ipc } from "@kernel/ipc";

const MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  bmp: "image/bmp",
  svg: "image/svg+xml",
};

/* 路径段排除空白与句读标点(点号/斜杠放行——扩展名与目录层级必需)。 */
const IMG_TOKEN = /(^|\s)@((?:[^\s,，.。!?!?:;"'()]+)?\.(?:png|jpe?g|gif|webp|bmp|svg))/gi;

/** 用户文本中的图片文件 token → 路径表(保序去重)。 */
export function imageTokens(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const m of text.matchAll(IMG_TOKEN)) {
    const p = m[2];
    if (!seen.has(p)) {
      seen.add(p);
      out.push(p);
    }
  }
  return out;
}

function escapeReg(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** 摘除已加载图片的 token(连前导空格),压缩剩余空白;未加载的 token 保留。
 *  尾部句读留在原文(与 imageTokens 的边界判据一致)。 */
export function stripLoaded(text: string, loaded: Record<string, string>): string {
  let out = text;
  for (const p of Object.keys(loaded)) {
    out = out.replace(new RegExp(`(^|\\s)@${escapeReg(p)}(?=[\\s,，.。!?!?:;"')]|$)`, "g"), "$1");
  }
  return out.replace(/ {2,}/g, " ").trim();
}

/* 读文件 → data URL;模块级缓存(流式重渲染/多轮引用同一临时文件不重复读)。 */
const loadCache = new Map<string, Promise<string | null>>();

/** 加载失败返回 null(调用方保留原 token,诚实降级不吞路径)。 */
export function loadUserImage(path: string): Promise<string | null> {
  const cached = loadCache.get(path);
  if (cached) return cached;
  const p = ipc.fsReadBytesBase64(path)
    .then((b64: string) => `data:${MIME[path.split(".").pop()?.toLowerCase() ?? ""] ?? "application/octet-stream"};base64,${b64}`)
    .catch(() => null);
  loadCache.set(path, p);
  return p;
}

/** 用户块图片源裁决(纯函数):引擎权威 images 在席 → 引擎 data URL 列表
 * (key = mime:长度指纹 + 重复序号,同图多贴也唯一);否则 → 已加载 token 的
 * data URL(key = 路径)。单源律:双源并渲染 = 同图双行(2026-11-05 图证)。 */
export function imageSrcs(block: CliTranscriptBlock, loaded: Record<string, string>): { key: string; src: string }[] {
  if (block.images?.length) {
    const seen = new Map<string, number>();
    return block.images.map((img) => {
      const base = `${img.mimeType}:${img.data.length}`;
      const n = seen.get(base) ?? 0;
      seen.set(base, n + 1);
      return { key: n ? `${base}#${n}` : base, src: `data:${img.mimeType};base64,${img.data}` };
    });
  }
  return Object.entries(loaded).map(([p, url]) => ({ key: p, src: url }));
}
