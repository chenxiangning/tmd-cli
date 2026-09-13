/**
 * 壁纸设置分区 —— 壁纸 tab:启用开关 + 当前壁纸卡 + 铺放/翻转/模糊/暗化/轮播。
 *
 * 样式全复用 pref-card/pref-row/segmented 现有类(零新增设置 CSS);
 * 滑杆 onChange 即时 commit(背景层实时预览),store 内防抖落盘。
 * 分段行收敛为通用 SegmentedPrefRow,控件结构逐行同构。
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

type SegValue = string | number | boolean;
type Option<T extends SegValue> = { value: T; label: string; disabled?: boolean };

function SegmentedPrefRow<T extends SegValue>({
  title,
  desc,
  value,
  options,
  onSelect,
}: {
  title: string;
  desc?: string;
  value: T;
  options: ReadonlyArray<Option<T>>;
  onSelect: (value: T) => void;
}) {
  return (
    <div className="pref-row">
      <div>
        <div className="pref-title">{title}</div>
        {desc ? <div className="pref-desc">{desc}</div> : null}
      </div>
      <div className="segmented" role="radiogroup" aria-label={title}>
        {options.map((option) => (
          <button
            key={String(option.value)}
            type="button"
            role="radio"
            aria-checked={value === option.value}
            className={`segment${value === option.value ? " is-active" : ""}`}
            disabled={option.disabled}
            onClick={() => onSelect(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function SliderPrefRow({
  title,
  desc,
  ariaLabel,
  min,
  max,
  value,
  unit,
  onChange,
}: {
  title: string;
  desc?: string;
  ariaLabel: string;
  min: number;
  max: number;
  value: number;
  unit: string;
  onChange: (value: number) => void;
}) {
  return (
    <div className="pref-row">
      <div>
        <div className="pref-title">{title}</div>
        {desc ? <div className="pref-desc">{desc}</div> : null}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <input
          type="range"
          min={min}
          max={max}
          step={1}
          value={value}
          aria-label={ariaLabel}
          onChange={(e) => onChange(Number(e.target.value))}
          className="w-28 accent-(--tmd-accent)"
        />
        <span className="w-9 text-right text-sm tabular-nums text-(--tmd-fg-muted)">
          {value}
          {unit}
        </span>
      </div>
    </div>
  );
}

const onOffOptions = (): Option<boolean>[] => [
  { value: false, label: t("关闭") },
  { value: true, label: t("开启") },
];

const FIT_OPTIONS: ReadonlyArray<Option<WallpaperFit>> = [
  { value: "cover", label: t("铺满") },
  { value: "contain", label: t("适应") },
  { value: "center", label: t("居中") },
  { value: "fill", label: t("填充") },
];

export function WallpaperSettingsTab() {
  const state = useWallpaperState();
  const [pickerOpen, setPickerOpen] = useState(false);
  const currentItem = resolveWallpaperMedia(state);
  const preview = useWallpaperSrc(currentItem?.path ?? "");
  const visibleCount = visibleWallpaperItems(state.library).length;

  return (
    <div className="pref-card" data-testid="settings-wallpaper-card">
      <SegmentedPrefRow
        title={t("工作区壁纸")}
        desc={t("在应用底层铺放本地图片，界面各栏变为半透明磨砂。")}
        value={state.enabled}
        options={onOffOptions()}
        onSelect={(enabled) => updateWallpaperState({ enabled })}
      />

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
    </div>
  );
}
