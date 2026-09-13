/**
 * 图片模式设置行 —— 当前壁纸卡 + 铺放/翻转/模糊/暗化/轮播(仅 mode=image 时挂载)。
 * 状态直接订阅 wallpaper store;滑杆即时 commit,store 内防抖落盘。
 */

import { useState } from "react";
import { Image as ImageIcon } from "@phosphor-icons/react";
import { t } from "@kernel/i18n";
import {
  WALLPAPER_BLUR_MAX,
  WALLPAPER_BLUR_MIN,
  WALLPAPER_DARKEN_MAX,
  WALLPAPER_DARKEN_MIN,
  WALLPAPER_ROTATION_MINUTES,
  resolveWallpaperMedia,
  visibleWallpaperItems,
  wallpaperItemName,
  type WallpaperFit,
  type WallpaperRotationMinutes,
} from "./types";
import { updateWallpaperState, useWallpaperState } from "./store";
import { useWallpaperSrc } from "./useWallpaperSrc";
import { WallpaperPicker } from "./WallpaperPicker";
import { SegmentedPrefRow, SliderPrefRow, type Option } from "./prefRows";

const FIT_OPTIONS: ReadonlyArray<Option<WallpaperFit>> = [
  { value: "cover", label: t("铺满") },
  { value: "contain", label: t("适应") },
  { value: "center", label: t("居中") },
  { value: "fill", label: t("填充") },
];

function onOffOptions(): Option<boolean>[] {
  return [
    { value: false, label: t("关闭") },
    { value: true, label: t("开启") },
  ];
}

export function WallpaperImageRows() {
  const state = useWallpaperState();
  const [pickerOpen, setPickerOpen] = useState(false);
  const currentItem = resolveWallpaperMedia(state);
  const preview = useWallpaperSrc(currentItem?.path ?? "");
  const visibleCount = visibleWallpaperItems(state.library).length;

  return (
    <>
      <div className="pref-row">
        <div>
          <div className="pref-title">{t("当前壁纸")}</div>
          <div className="pref-desc">
            {currentItem
              ? wallpaperItemName(currentItem)
              : t("尚未选择；导入并点选一张图片后生效。")}
          </div>
        </div>
        <button
          type="button"
          className="wp-settings-choose"
          onClick={() => setPickerOpen(true)}
        >
          {currentItem && preview.src ? (
            <img src={preview.src} alt="" onError={preview.handleError} />
          ) : (
            <ImageIcon size={14} aria-hidden />
          )}
          <span>{t("选择壁纸")}</span>
        </button>
      </div>

      <SegmentedPrefRow
        title={t("铺放方式")}
        desc={t("填充=拉伸铺满；居中=原尺寸不缩放。")}
        value={state.fit}
        options={FIT_OPTIONS}
        onSelect={(fit) => updateWallpaperState({ fit })}
      />

      <SegmentedPrefRow
        title={t("水平翻转")}
        value={state.flip}
        options={onOffOptions()}
        onSelect={(flip) => updateWallpaperState({ flip })}
      />

      <SliderPrefRow
        title={t("壁纸模糊")}
        desc={t("加在壁纸本身（非界面毛玻璃），0 = 清晰。")}
        ariaLabel={t("壁纸模糊")}
        min={WALLPAPER_BLUR_MIN}
        max={WALLPAPER_BLUR_MAX}
        value={state.blur}
        unit="px"
        onChange={(blur) => updateWallpaperState({ blur })}
      />

      <SliderPrefRow
        title={t("壁纸暗化")}
        desc={t("压暗壁纸提升界面文字对比。")}
        ariaLabel={t("壁纸暗化")}
        min={WALLPAPER_DARKEN_MIN}
        max={WALLPAPER_DARKEN_MAX}
        value={state.darken}
        unit="%"
        onChange={(darken) => updateWallpaperState({ darken })}
      />

      <SegmentedPrefRow
        title={t("自动轮播")}
        desc={
          visibleCount >= 2
            ? t("按间隔在图库可见项间轮流切换。")
            : t("图库可见项达到 2 张后可开启。")
        }
        value={state.rotationEnabled}
        options={onOffOptions().map((option) =>
          option.value ? { ...option, disabled: visibleCount < 2 } : option,
        )}
        onSelect={(rotationEnabled) => updateWallpaperState({ rotationEnabled })}
      />

      {state.rotationEnabled && visibleCount >= 2 ? (
        <SegmentedPrefRow
          title={t("轮播间隔")}
          value={state.rotationMinutes}
          options={WALLPAPER_ROTATION_MINUTES.map((minutes) => ({
            value: minutes,
            label: t("{minutes} 分钟", { minutes }),
          }))}
          onSelect={(rotationMinutes) =>
            updateWallpaperState({
              rotationMinutes: rotationMinutes as WallpaperRotationMinutes,
            })
          }
        />
      ) : null}

      {pickerOpen ? <WallpaperPicker onClose={() => setPickerOpen(false)} /> : null}
    </>
  );
}
