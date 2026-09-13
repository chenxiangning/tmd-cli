/**
 * 壁纸设置分区 —— 壁纸 tab:模式三段(关闭/流体/图片)+ 流体预设与运动 +
 * 图片模式行(WallpaperImageRows)。状态订阅 wallpaper store,滑杆即时生效。
 */

import { t } from "@kernel/i18n";
import { updateWallpaperState, useWallpaperState } from "./store";
import { SegmentedPrefRow, SliderPrefRow } from "./prefRows";
import { WallpaperImageRows } from "./WallpaperImageRows";
import {
  FLUID_MOTIONS,
  FLUID_PRESETS,
  fluidPresetSwatch,
  type FluidMotionId,
  type FluidPresetId,
} from "./fluidTones";
import { WALLPAPER_DARKEN_MAX, WALLPAPER_DARKEN_MIN } from "./types";

const FLUID_PRESET_LABELS: Record<FluidPresetId, string> = {
  mist: "薄雾",
  aurora: "极光",
  dusk: "暮色",
  orchid: "兰紫",
  ember: "烬红",
  ink: "墨蓝",
  ash: "灰烬",
};

const FLUID_MOTION_LABELS: Record<FluidMotionId, string> = {
  drift: "漂移",
  taiji: "太极",
  storm: "风暴",
  tornado: "龙卷",
  chase: "游龙",
};

export function WallpaperSettingsTab() {
  const state = useWallpaperState();
  /* 色点按当前生效明暗取色(渲染时读一次,主题切换后下次渲染刷新)。 */
  const dark =
    typeof document !== "undefined" &&
    document.documentElement.dataset.theme === "dark";

  return (
    <div className="pref-card" data-testid="settings-wallpaper-card">
      <SegmentedPrefRow
        title={t("工作区背景")}
        desc={t("流体着色器动态背景，或本地图库壁纸；界面各栏随之变为半透明磨砂。")}
        value={state.mode}
        options={[
          { value: "off" as const, label: t("关闭") },
          { value: "fluid" as const, label: t("流体") },
          { value: "image" as const, label: t("图片") },
        ]}
        onSelect={(mode) => updateWallpaperState({ mode })}
      />

      {state.mode === "fluid" ? (
        <>
          <SegmentedPrefRow
            title={t("流体预设")}
            desc={t("七组色相/深度组合，随明暗主题各出一套配色。")}
            value={state.fluidPreset}
            options={FLUID_PRESETS.map((preset) => ({
              value: preset.id,
              label: t(FLUID_PRESET_LABELS[preset.id]),
              swatch: fluidPresetSwatch(preset, dark),
            }))}
            onSelect={(fluidPreset) =>
              updateWallpaperState({ fluidPreset: fluidPreset as FluidPresetId })
            }
          />
          <SegmentedPrefRow
            title={t("流体运动")}
            desc={t("漂移=域扭曲流场；太极/风暴/龙卷/游龙为独立着色程序。")}
            value={state.fluidMotion}
            options={FLUID_MOTIONS.map((motion) => ({
              value: motion.id,
              label: t(FLUID_MOTION_LABELS[motion.id]),
            }))}
            onSelect={(fluidMotion) =>
              updateWallpaperState({ fluidMotion: fluidMotion as FluidMotionId })
            }
          />
          <SliderPrefRow
            title={t("背景暗化")}
            desc={t("压暗流体背景，提升界面文字对比。")}
            ariaLabel={t("背景暗化")}
            min={WALLPAPER_DARKEN_MIN}
            max={WALLPAPER_DARKEN_MAX}
            value={state.darken}
            unit="%"
            onChange={(darken) => updateWallpaperState({ darken })}
          />
        </>
      ) : null}

      {state.mode === "image" ? <WallpaperImageRows /> : null}
    </div>
  );
}
