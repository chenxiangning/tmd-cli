/**
 * 壁纸插件类型与清洗 —— 数据模型对齐 codemoss workspace-wallpaper 的图片子集
 * (v1 砍视频/市场,见 docs/research/codemoss-workspace-wallpaper.md 决策点 3)。
 *
 * 承担:库条目白名单校验、效果参数合法域、整体 sanitize;持久化装配在 store.ts。
 */

import type React from "react";
import {
  DEFAULT_FLUID_MOTION,
  DEFAULT_FLUID_PRESET,
  isFluidMotionId,
  isFluidPresetId,
  type FluidMotionId,
  type FluidPresetId,
} from "./fluidTones";

/** 背景模式:关 / 流体着色器 / 本地图库图片。 */
export type WallpaperMode = "off" | "fluid" | "image";

export const WALLPAPER_MODES: readonly WallpaperMode[] = ["off", "fluid", "image"];

export function isWallpaperMode(value: unknown): value is WallpaperMode {
  return (
    typeof value === "string" &&
    (WALLPAPER_MODES as readonly string[]).includes(value)
  );
}

/** 铺放方式;center 映射 CSS object-fit:none(原尺寸居中)。 */
export type WallpaperFit = "cover" | "contain" | "center" | "fill";

export const WALLPAPER_FITS: readonly WallpaperFit[] = ["cover", "contain", "center", "fill"];
export const DEFAULT_WALLPAPER_FIT: WallpaperFit = "cover";

export const WALLPAPER_BLUR_MIN = 0;
export const WALLPAPER_BLUR_MAX = 40;
export const WALLPAPER_DARKEN_MIN = 0;
export const WALLPAPER_DARKEN_MAX = 80;
export const WALLPAPER_ROTATION_MINUTES = [5, 15, 30, 60] as const;
export type WallpaperRotationMinutes = (typeof WALLPAPER_ROTATION_MINUTES)[number];
export const DEFAULT_WALLPAPER_ROTATION_MINUTES: WallpaperRotationMinutes = 30;

/** 支持的图片扩展名(与 ipc.pickImageFiles 过滤器、Rust 预览白名单同源)。 */
export const WALLPAPER_IMAGE_EXTENSIONS = ["png", "jpg", "jpeg", "webp", "gif", "bmp"] as const;

/** 库条目:path = 受管副本绝对路径;sourcePath 仅展示与去重。 */
export type WallpaperLibraryItem = {
  id: string;
  path: string;
  sourcePath?: string;
  hidden?: boolean;
};

export type WallpaperState = {
  mode: WallpaperMode;
  /** 流体模式参数(preset/motion 与 codemoss 同值互通)。 */
  fluidPreset: FluidPresetId;
  fluidMotion: FluidMotionId;
  library: WallpaperLibraryItem[];
  selectedId: string | null;
  /** 媒体模糊(px,0-40):加在壁纸 img 的 filter 上,不动 chrome backdrop。 */
  blur: number;
  /** 暗化(%,0-80):壁纸层顶部黑罩,压对比保 chrome 文字可读。 */
  darken: number;
  fit: WallpaperFit;
  flip: boolean;
  rotationEnabled: boolean;
  rotationMinutes: WallpaperRotationMinutes;
};

export const DEFAULT_WALLPAPER_STATE: WallpaperState = {
  mode: "off",
  fluidPreset: DEFAULT_FLUID_PRESET,
  fluidMotion: DEFAULT_FLUID_MOTION,
  library: [],
  selectedId: null,
  blur: 0,
  darken: 0,
  fit: DEFAULT_WALLPAPER_FIT,
  flip: false,
  rotationEnabled: false,
  rotationMinutes: DEFAULT_WALLPAPER_ROTATION_MINUTES,
};

/** 取路径扩展名(小写;统一斜杠形态,Windows 反斜杠亦可)。 */
export function fileExtensionOf(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  const base = normalized.slice(normalized.lastIndexOf("/") + 1);
  const dot = base.lastIndexOf(".");
  if (dot <= 0 || dot === base.length - 1) return "";
  return base.slice(dot + 1).toLowerCase();
}

/** 本地路径安全闸:非空、无 NUL、非 URL(codemoss 同款防线)。 */
function isSafeLocalPath(value: string): boolean {
  return value.length > 0 && !value.includes("\0") && !value.includes("://");
}

function sanitizeImagePath(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!isSafeLocalPath(trimmed)) return null;
  return (WALLPAPER_IMAGE_EXTENSIONS as readonly string[]).includes(fileExtensionOf(trimmed))
    ? trimmed
    : null;
}

export /** 库条目 id 黑名单:轮播可见项计数用 "|" 连接,id 含分隔符或控制字符即整项
 *  拒收(2026-09-13 全局审查注入面)。黑名单而非白名单——路径形 id 等现实
 *  形态照收,只挡真正破坏 join/split 语义的字符。 */
const WALLPAPER_ID_FORBIDDEN_RE = /[|\u0000-\u001f]/;

function sanitizeWallpaperLibraryItem(value: unknown): WallpaperLibraryItem | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Partial<WallpaperLibraryItem>;
  const id = typeof raw.id === "string" ? raw.id.trim() : "";
  const path = sanitizeImagePath(raw.path);
  if (!id || WALLPAPER_ID_FORBIDDEN_RE.test(id) || !path) return null;
  const sourcePath =
    typeof raw.sourcePath === "string" && isSafeLocalPath(raw.sourcePath.trim())
      ? raw.sourcePath.trim()
      : undefined;
  return { id, path, sourcePath, hidden: raw.hidden === true };
}

export function sanitizeWallpaperLibrary(value: unknown): WallpaperLibraryItem[] {
  if (!Array.isArray(value)) return [];
  const items: WallpaperLibraryItem[] = [];
  const seen = new Set<string>();
  for (const raw of value) {
    const item = sanitizeWallpaperLibraryItem(raw);
    if (!item || seen.has(item.id)) continue;
    seen.add(item.id);
    items.push(item);
  }
  return items;
}

export function visibleWallpaperItems(library: WallpaperLibraryItem[]): WallpaperLibraryItem[] {
  return library.filter((item) => item.hidden !== true);
}

/** 当前应渲染的库条目:选中项兜底第一可见项(见 resolveSelectedId)。 */
export function resolveWallpaperMedia(
  state: WallpaperState,
): WallpaperLibraryItem | null {
  const id = resolveSelectedId(state.library, state.selectedId);
  if (!id) return null;
  return state.library.find((item) => item.id === id) ?? null;
}

/** 选中项兜底链:selectedId 不在可见项内 → 第一可见项;库空 → null。 */
export function resolveSelectedId(
  library: WallpaperLibraryItem[],
  selectedId: string | null,
): string | null {
  const visible = visibleWallpaperItems(library);
  if (visible.length === 0) return null;
  if (selectedId && visible.some((item) => item.id === selectedId)) return selectedId;
  return visible[0].id;
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.round(value)));
}

function sanitizeFit(value: unknown): WallpaperFit {
  return (WALLPAPER_FITS as readonly string[]).includes(value as string)
    ? (value as WallpaperFit)
    : DEFAULT_WALLPAPER_FIT;
}

function sanitizeRotationMinutes(value: unknown): WallpaperRotationMinutes {
  return (WALLPAPER_ROTATION_MINUTES as readonly number[]).includes(value as number)
    ? (value as WallpaperRotationMinutes)
    : DEFAULT_WALLPAPER_ROTATION_MINUTES;
}

/** 整体清洗:任意畸形输入(旧存储/手改 JSON)回落安全默认,绝不抛出。
 *  迁移:旧字段 enabled(首版形态)→ mode=「image」;mode 非法时同此。 */
export function sanitizeWallpaperState(value: unknown): WallpaperState {
  if (!value || typeof value !== "object") return { ...DEFAULT_WALLPAPER_STATE };
  const raw = value as Partial<WallpaperState> & { enabled?: unknown };
  const library = sanitizeWallpaperLibrary(raw.library);
  const mode = isWallpaperMode(raw.mode)
    ? raw.mode
    : raw.enabled === true
      ? "image"
      : "off";
  return {
    mode,
    fluidPreset: isFluidPresetId(raw.fluidPreset)
      ? raw.fluidPreset
      : DEFAULT_FLUID_PRESET,
    fluidMotion: isFluidMotionId(raw.fluidMotion)
      ? raw.fluidMotion
      : DEFAULT_FLUID_MOTION,
    library,
    selectedId: resolveSelectedId(library, raw.selectedId ?? null),
    blur: clampInt(raw.blur, WALLPAPER_BLUR_MIN, WALLPAPER_BLUR_MAX, 0),
    darken: clampInt(raw.darken, WALLPAPER_DARKEN_MIN, WALLPAPER_DARKEN_MAX, 0),
    fit: sanitizeFit(raw.fit),
    flip: raw.flip === true,
    rotationEnabled: raw.rotationEnabled === true,
    rotationMinutes: sanitizeRotationMinutes(raw.rotationMinutes),
  };
}

/** 按 sourcePath(回落 path)规范化去重键:同源重复导入直接复用已有条目。 */
export function wallpaperDedupeKey(item: WallpaperLibraryItem): string {
  return (item.sourcePath ?? item.path).trim().replace(/\\/g, "/").toLowerCase();
}

/** 找同源重复项(导入前查重)。 */
export function findDuplicateItem(
  library: WallpaperLibraryItem[],
  sourcePath: string,
): WallpaperLibraryItem | undefined {
  const key = sourcePath.trim().replace(/\\/g, "/").toLowerCase();
  if (!key) return undefined;
  return library.find((item) => wallpaperDedupeKey(item) === key);
}

/** 展示名:sourcePath 的文件名,回落受管副本文件名,再回落 id。 */
export function wallpaperItemName(item: WallpaperLibraryItem): string {
  for (const candidate of [item.sourcePath, item.path]) {
    if (!candidate) continue;
    const normalized = candidate.replace(/\\/g, "/");
    const base = normalized.slice(normalized.lastIndexOf("/") + 1);
    if (base) return base;
  }
  return item.id;
}

/** CSS object-fit 值:center 语义 = 原尺寸(none)。 */
export function cssObjectFit(fit: WallpaperFit): React.CSSProperties["objectFit"] {
  return fit === "center" ? "none" : fit;
}

/** 新库条目 id:毫秒时间戳 + 随机段(36 进制,落在 WALLPAPER_ID_RE 内)。 */
export function newWallpaperId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
