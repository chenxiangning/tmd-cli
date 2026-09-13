/**
 * 壁纸背景层 —— overlay 挂点的沉底渲染件。
 *
 * fixed inset-0 + z-index:-1:在 .app(非定位兄弟)的背景之下、画布之上;
 * .app 及各面板背景被 punch.ts 换成半透明 token 后,壁纸即透出。
 * pointer-events:none 保证不挡任何交互;PTY 字节流与 xterm 渲染零触碰
 * (幕布铁律:背景是幕布之外的视觉层)。
 *
 * mode:image → 本地图库图片;fluid → WebGL 流体着色器(codemoss 移植);
 * off / 媒体缺失 → 不挂层、不打穿。
 */

import { useEffect, useMemo } from "react";
import {
  cssObjectFit,
  resolveWallpaperMedia,
  visibleWallpaperItems,
} from "./types";
import { getWallpaperState, updateWallpaperState, useWallpaperState } from "./store";
import { applyWallpaperPunch, wireWallpaperThemeFollow } from "./punch";
import { useWallpaperSrc } from "./useWallpaperSrc";
import { FluidBackdrop, WORKSPACE_FLUID_SPEED } from "./FluidBackdrop";

export function WallpaperLayer() {
  const state = useWallpaperState();
  const media = resolveWallpaperMedia(state);
  const mediaPath = media?.path ?? "";
  const preview = useWallpaperSrc(mediaPath);
  const imageActive = state.mode === "image" && !!media && !preview.failed;
  const active = state.mode === "fluid" || imageActive;

  /* 打穿随激活态切换;激活期间跟随主题重应用(theme.ts 抹键后重拍快照)。 */
  useEffect(() => {
    applyWallpaperPunch(active);
    if (!active) return undefined;
    return wireWallpaperThemeFollow();
  }, [active]);

  /* 轮播:到点取下一可见项;依赖含选中项/库/间隔,手动换图即重置计时。 */
  const visibleIds = useMemo(
    () => visibleWallpaperItems(state.library).map((item) => item.id).join("|"),
    [state.library],
  );
  const rotationOn =
    imageActive && state.rotationEnabled && visibleIds.split("|").length >= 2;
  useEffect(() => {
    if (!rotationOn) return undefined;
    const timer = setTimeout(() => {
      const current = getWallpaperState();
      const items = visibleWallpaperItems(current.library);
      const index = items.findIndex((item) => item.id === current.selectedId);
      const next = items[(index + 1) % items.length];
      if (next && next.id !== current.selectedId) {
        updateWallpaperState({ selectedId: next.id });
      }
    }, Math.max(1, state.rotationMinutes) * 60_000);
    return () => clearTimeout(timer);
  }, [rotationOn, visibleIds, state.selectedId, state.rotationMinutes]);

  if (!active) return null;

  return (
    <div className="tmd-wallpaper" aria-hidden data-testid="tmd-wallpaper" data-mode={state.mode}>
      {state.mode === "fluid" ? (
        <FluidBackdrop
          presetId={state.fluidPreset}
          motionId={state.fluidMotion}
          speed={WORKSPACE_FLUID_SPEED}
        />
      ) : (
        <img
          className="tmd-wallpaper-img"
          src={preview.src}
          alt=""
          decoding="async"
          onError={preview.handleError}
          style={{
            objectFit: cssObjectFit(state.fit),
            transform: state.flip ? "scaleX(-1)" : undefined,
            filter: state.blur > 0 ? `blur(${state.blur}px)` : undefined,
          }}
        />
      )}
      <div className="tmd-wallpaper-wash" />
      {state.darken > 0 ? (
        <div
          className="tmd-wallpaper-darken"
          style={{ backgroundColor: `rgb(0 0 0 / ${state.darken}%)` }}
        />
      ) : null}
    </div>
  );
}
