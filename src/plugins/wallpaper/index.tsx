/**
 * wallpaper 插件 —— 工作区背景壁纸(本地图库子集,对齐 codemoss workspace-wallpaper)。
 *
 * 贡献面:
 * 1. contribute("overlay") → WallpaperLayer 沉底背景层(z-index:-1 + token 打穿)。
 * 2. registerSettingsSection → 「壁纸」分区(图库 tab)。
 *
 * 持久化与受管目录自管(~/.tmd-cli/wallpaper.json + wallpapers/),kernel 零语义。
 */

import { ImagesSquare } from "@phosphor-icons/react";
import type { Plugin } from "@kernel/plugin";
import "./wallpaper.css";
import { WallpaperLayer } from "./WallpaperLayer";
import { WallpaperSettingsTab } from "./WallpaperSettingsTab";
import { ensureWallpaperStoreLoaded } from "./store";

export const wallpaperPlugin: Plugin = {
  id: "wallpaper",
  meta: {
    name: "壁纸",
    abbr: "WP",
    desc: "工作区背景壁纸：本地图库、模糊暗化与自动轮播",
    icon: ImagesSquare,
    iconColor: "#7AA2F7",
    category: "feature",
  },
  activate(ctx) {
    void ensureWallpaperStoreLoaded();
    ctx.contribute("overlay", { order: -100, component: WallpaperLayer });
    ctx.registerSettingsSection({
      id: "wallpaper",
      title: "壁纸",
      description: "工作区背景壁纸：本地图库与效果。",
      icon: <ImagesSquare size="0.875rem" aria-hidden />,
      order: 4,
      tabs: [
        {
          id: "library",
          title: "图库",
          icon: <ImagesSquare size="0.875rem" aria-hidden />,
          order: 0,
          component: WallpaperSettingsTab,
        },
      ],
    });
  },
};
