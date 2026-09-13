/**
 * 壁纸插件 store —— 快照态 + 自管持久化(<config_dir>/wallpaper.json)。
 *
 * 不进 kernel settingsTypes:壁纸域是单插件语义,kernel 零改动
 * (docs/research/codemoss-workspace-wallpaper.md 决策点 4);
 * 持久化走既有 fs 文本原语(fsReadFile/fsWriteFile),受管图库目录
 * <config_dir>/wallpapers/ 由本插件自持;配置目录本身经 ipc.configDir()
 * 原语获取(Rust session.rs 是布局 owner,插件不自拼路径)。
 */

import { ipc } from "@kernel/ipc";
import { createSubscribable } from "@kernel/subscribable";
import {
  DEFAULT_WALLPAPER_STATE,
  sanitizeWallpaperState,
  type WallpaperState,
} from "./types";

const store = createSubscribable<WallpaperState>({ ...DEFAULT_WALLPAPER_STATE });

let configPath: string | null = null;
let wallpapersDir: string | null = null;
let loaded = false;
let loadPromise: Promise<void> | null = null;
let mutatedBeforeLoad = false;
let persistTimer: ReturnType<typeof setTimeout> | null = null;
const PERSIST_DEBOUNCE_MS = 400;

function joinPath(...parts: string[]): string {
  return parts.join("/").replace(/\/{2,}/g, "/");
}

/** 受管路径拼接(picker 落副本名也用);统一斜杠,Windows 亦兼容。 */
export { joinPath };

/** 解析受管路径(config_dir 原语取配置目录,布局知识留在 Rust session.rs)。 */
async function resolvePaths(): Promise<void> {
  if (wallpapersDir) return;
  const dir = await ipc.configDir();
  if (!dir) throw new Error("无法定位应用配置目录");
  wallpapersDir = joinPath(dir, "wallpapers");
  configPath = joinPath(dir, "wallpaper.json");
}

/** 受管图库目录(导入时由 picker 调用;幂等创建)。 */
export async function wallpaperLibraryDir(): Promise<string> {
  await resolvePaths();
  try {
    await ipc.fsCreateDir(wallpapersDir!);
  } catch {
    /* 已存在 = 达成目标;其余错误留给后续 fsCopyFile 暴露。 */
  }
  return wallpapersDir!;
}

/** 启动加载:读 wallpaper.json → sanitize → commit;缺失/畸形回落默认,幂等。 */
export function ensureWallpaperStoreLoaded(): Promise<void> {
  if (loaded) return Promise.resolve();
  loadPromise ??= (async () => {
    try {
      await resolvePaths();
      const text = await ipc.fsReadFile(configPath!);
      const next = sanitizeWallpaperState(JSON.parse(text));
      /* 竞态护栏:磁盘读回期间用户已改过(如秒开设置页拨开关)则不覆盖。 */
      if (!mutatedBeforeLoad) store.commit(next);
    } catch {
      /* 首次使用无文件 / JSON 畸形:保持默认,不写坏态。 */
    } finally {
      loaded = true;
    }
  })();
  return loadPromise;
}

function writeNow(): void {
  if (!configPath) return;
  void ipc
    .fsWriteFile(configPath, JSON.stringify(store.snapshot, null, 2))
    .catch(() => undefined);
}

function schedulePersist(): void {
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    persistTimer = null;
    writeNow();
  }, PERSIST_DEBOUNCE_MS);
}

/** 退出冲刷:防抖窗口内关窗/退出不再丢最后一次改动(改壁纸后立刻 Cmd+Q 的
 *  丢失面,2026-09-13 全局审查 P2)。pagehide 在 webview 拆卸期触发,invoke
 *  能否送达属尽力而为;visibilitychange hidden 兜常规隐藏路径。 */
function flushPersistNow(): void {
  if (!persistTimer) return;
  clearTimeout(persistTimer);
  persistTimer = null;
  writeNow();
}

if (typeof window !== "undefined") {
  window.addEventListener("pagehide", flushPersistNow);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) flushPersistNow();
  });
}

/** 局部更新:清洗后整体换快照(UI 即时生效),防抖落盘。 */
export function updateWallpaperState(patch: Partial<WallpaperState>): void {
  mutatedBeforeLoad = true;
  store.commit(sanitizeWallpaperState({ ...store.snapshot, ...patch }));
  schedulePersist();
}

/** React 订阅入口(设置 tab / 背景层共用)。 */
export function useWallpaperState(): WallpaperState {
  return store.useStore();
}

/** 当前快照(命令式消费者:轮播计时器)。 */
export function getWallpaperState(): WallpaperState {
  return store.snapshot;
}

/** 测试复位。 */
export function resetWallpaperStoreForTests(): void {
  store.commit({ ...DEFAULT_WALLPAPER_STATE });
  configPath = null;
  wallpapersDir = null;
  loaded = false;
  loadPromise = null;
  mutatedBeforeLoad = false;
  if (persistTimer) {
    clearTimeout(persistTimer);
    persistTimer = null;
  }
}
