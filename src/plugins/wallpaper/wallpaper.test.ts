/**
 * wallpaper 插件单测 —— 类型/sanitize 白名单与兜底链、打穿色值解析。
 * store 持久化链依赖 Tauri IPC,不在 jsdom 桩化(真机验收覆盖)。
 */

import { describe, expect, it } from "vitest";
import {
  DEFAULT_WALLPAPER_STATE,
  WALLPAPER_IMAGE_EXTENSIONS,
  findDuplicateItem,
  resolveSelectedId,
  sanitizeWallpaperState,
  visibleWallpaperItems,
  wallpaperItemName,
} from "./types";
import { parseCssColor, terminalVeil } from "./punch";

const P = (path: string) => ({ id: path, path, sourcePath: path });

describe("sanitizeWallpaperState", () => {
  it("畸形输入整体回落默认", () => {
    expect(sanitizeWallpaperState(null)).toEqual(DEFAULT_WALLPAPER_STATE);
    expect(sanitizeWallpaperState("junk")).toEqual(DEFAULT_WALLPAPER_STATE);
    expect(sanitizeWallpaperState(42)).toEqual(DEFAULT_WALLPAPER_STATE);
  });

  it("mode 白名单 + 旧 enabled 字段迁移为 image", () => {
    expect(sanitizeWallpaperState({ mode: "fluid" }).mode).toBe("fluid");
    expect(sanitizeWallpaperState({ mode: "nonsense" }).mode).toBe("off");
    expect(sanitizeWallpaperState({ enabled: true }).mode).toBe("image");
    expect(sanitizeWallpaperState({ enabled: false }).mode).toBe("off");
    /* 非法 mode 不误吞旧 enabled,按非法处理。 */
    expect(sanitizeWallpaperState({ mode: 7, enabled: true }).mode).toBe("image");
    /* 流体字段白名单回落。 */
    expect(sanitizeWallpaperState({ mode: "fluid", fluidPreset: "nope", fluidMotion: "nope" }))
      .toMatchObject({ fluidPreset: "mist", fluidMotion: "drift" });
  });

  it("库条目按扩展名白名单过滤并按 id 去重", () => {
    const state = sanitizeWallpaperState({
      library: [
        P("/m/w/a.png"),
        P("/m/w/a.png"),
        { id: "b", path: "/m/w/b.mp4" },
        { id: "", path: "/m/w/c.png" },
        { id: "d", path: "https://evil/x.png" },
        { id: "e", path: "/m/w/e.JPG" },
      ],
    });
    expect(state.library.map((i) => i.id)).toEqual(["/m/w/a.png", "e"]);
  });

  it("selectedId 兜底链:隐藏项不生效 → 第一可见项;库空为 null", () => {
    const state = sanitizeWallpaperState({
      library: [
        { id: "a", path: "/m/a.png", hidden: true },
        { id: "b", path: "/m/b.png" },
        { id: "c", path: "/m/c.png" },
      ],
      selectedId: "a",
    });
    expect(state.selectedId).toBe("b");
    expect(sanitizeWallpaperState({ library: [] }).selectedId).toBeNull();
    expect(
      sanitizeWallpaperState({ library: [P("/m/a.png")], selectedId: "nope" }).selectedId,
    ).toBe("/m/a.png");
  });

  it("效果参数 clamp 与枚举白名单", () => {
    const state = sanitizeWallpaperState({
      blur: 999,
      darken: -12,
      fit: "weird",
      rotationMinutes: 7,
      flip: 1,
    });
    expect(state.blur).toBe(40);
    expect(state.darken).toBe(0);
    expect(state.fit).toBe("cover");
    expect(state.rotationMinutes).toBe(30);
    expect(state.flip).toBe(false);
  });
});

describe("图库工具", () => {
  it("visibleWallpaperItems 过滤隐藏项", () => {
    const items = [
      { id: "a", path: "/m/a.png" },
      { id: "b", path: "/m/b.png", hidden: true },
    ];
    expect(visibleWallpaperItems(items).map((i) => i.id)).toEqual(["a"]);
    expect(resolveSelectedId(items, "b")).toBe("a");
  });

  it("findDuplicateItem 按 sourcePath 规范化匹配(大小写/反斜杠不敏感)", () => {
    const items = [{ id: "1", path: "/m/x.png", sourcePath: "/Users/z/Pic.JPG" }];
    expect(findDuplicateItem(items, "/users/z/pic.jpg")?.id).toBe("1");
    expect(findDuplicateItem(items, "/m/y.png")).toBeUndefined();
  });

  it("wallpaperItemName 取源文件名,逐级兜底", () => {
    expect(wallpaperItemName({ id: "i", path: "/m/managed.png", sourcePath: "/u/我 的壁纸.PNG" })).toBe(
      "我 的壁纸.PNG",
    );
    expect(wallpaperItemName({ id: "i", path: "/m/managed.png" })).toBe("managed.png");
    expect(wallpaperItemName({ id: "only-id", path: "/m/x.png" })).not.toBe("only-id");
  });

  it("扩展名白名单含六种图片格式", () => {
    expect([...WALLPAPER_IMAGE_EXTENSIONS].sort()).toEqual(
      ["bmp", "gif", "jpeg", "jpg", "png", "webp"].sort(),
    );
  });
});

describe("打穿色值解析", () => {
  it("parseCssColor 支持 hex/rgb 形态,拒绝其它", () => {
    expect(parseCssColor("#1f1f1f")).toEqual({ r: 31, g: 31, b: 31 });
    expect(parseCssColor("#fff")).toEqual({ r: 255, g: 255, b: 255 });
    expect(parseCssColor("#ffffffff")).toEqual({ r: 255, g: 255, b: 255 });
    expect(parseCssColor("rgb(10, 20, 30)")).toEqual({ r: 10, g: 20, b: 30 });
    expect(parseCssColor("rgba(10, 20, 30, 0.5)")).toEqual({ r: 10, g: 20, b: 30 });
    expect(parseCssColor("color-mix(in srgb, red 50%, blue)")).toBeNull();
    expect(parseCssColor("")).toBeNull();
  });

  it("terminalVeil 输出 xterm 可解析的 rgba 字面量", () => {
    expect(terminalVeil("#1f1f1f", 84)).toBe("rgba(31, 31, 31, 0.84)");
    expect(terminalVeil("nonsense", 84)).toBeNull();
  });
});
