/**
 * 壁纸插件 store —— 快照态 + 自管持久化(~/.tmd-cli/wallpaper.json)。
 *
 * 不进 kernel settingsTypes:壁纸域是单插件语义,kernel 零改动
 * (docs/research/codemoss-workspace-wallpaper.md 决策点 4);
 * 持久化走既有 fs 文本原语(fsReadFile/fsWriteFile),受管图库目录
 * ~/.tmd-cli/wallpapers/ 由本插件自持(目录布局知识留插件侧)。
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

/** 解析受管路径(用户主目录 → ~/.tmd-cli 布局);失败返回 null,调用方降级。 */
async function resolvePaths(): Promise<void> {
  if (wallpapersDir) return;
  const home = await ipc.configHomeDir();
  if (!home) throw new Error("无法定位用户主目录");
  wallpapersDir = joinPath(home, ".tmd-cli", "wallpapers");
  configPath = joinPath(home, ".tmd-cli", "wallpaper.json");
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

function schedulePersist(): void {
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    persistTimer = null;
    if (!configPath) return;
    void ipc
      .fsWriteFile(configPath, JSON.stringify(store.snapshot, null, 2))
      .catch(() => undefined);
  }, PERSIST_DEBOUNCE_MS);
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
