/**
 * 流体背景调色板与运动白名单 —— 移植自 codemoss
 * src/features/onboarding/utils/fluidTones.ts(adapted from
 * DSH-Transparent-UI-Plugin, MIT License, Copyright (c) 2026 John Wu)。
 *
 * hue(0-360)+ depth(0-100)经 HSL 派生三段色;明暗主题各一套。
 * preset id / motion id 与 codemoss 同值,壁纸 JSON 可直接互通。
 */

export interface FluidToneColors {
  color1: string;
  color2: string;
  color3: string;
}

/** 滑杆 0/360 落在蓝基座,顺时针扫。 */
export const FLUID_HUE_BASE = 217;

export const FLUID_PRESETS = [
  { id: "mist", hue: 320, depth: 25 },
  { id: "aurora", hue: 150, depth: 28 },
  { id: "dusk", hue: 40, depth: 22 },
  { id: "orchid", hue: 250, depth: 26 },
  { id: "ember", hue: 5, depth: 20 },
  { id: "ink", hue: 200, depth: 8 },
  { id: "ash", hue: 3, depth: 46, chroma: 0.06 },
] as const;

export type FluidPresetId = (typeof FLUID_PRESETS)[number]["id"];
export type FluidPreset = (typeof FLUID_PRESETS)[number];

export const DEFAULT_FLUID_PRESET: FluidPresetId = "mist";

export const FLUID_MOTIONS = [
  { id: "drift", mode: 0 },
  { id: "taiji", mode: 1 },
  { id: "storm", mode: 2 },
  { id: "tornado", mode: 3 },
  { id: "chase", mode: 4 },
] as const;

export type FluidMotionId = (typeof FLUID_MOTIONS)[number]["id"];

export const DEFAULT_FLUID_MOTION: FluidMotionId = "drift";

export function isFluidPresetId(value: unknown): value is FluidPresetId {
  return typeof value === "string" && FLUID_PRESETS.some((p) => p.id === value);
}

export function resolveFluidPreset(value: unknown): FluidPreset {
  return FLUID_PRESETS.find((p) => p.id === value) ?? FLUID_PRESETS[0];
}

export function isFluidMotionId(value: unknown): value is FluidMotionId {
  return typeof value === "string" && FLUID_MOTIONS.some((m) => m.id === value);
}

export function resolveFluidMotion(value: unknown): (typeof FLUID_MOTIONS)[number] {
  return FLUID_MOTIONS.find((m) => m.id === value) ?? FLUID_MOTIONS[0];
}

export function fluidPresetChroma(preset: FluidPreset): number | undefined {
  return "chroma" in preset ? preset.chroma : undefined;
}

function hsl(h: number, s: number, l: number): string {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r = 0;
  let g = 0;
  let b = 0;
  if (h < 60) {
    r = c;
    g = x;
  } else if (h < 120) {
    r = x;
    g = c;
  } else if (h < 180) {
    g = c;
    b = x;
  } else if (h < 240) {
    g = x;
    b = c;
  } else if (h < 300) {
    r = x;
    b = c;
  } else {
    r = c;
    b = x;
  }
  const toHex = (v: number): string =>
    Math.round((v + m) * 255)
      .toString(16)
      .padStart(2, "0");
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

/** 指定 hue/depth 的三段色:depth 0 饱和端,100 淡洗端。 */
export function fluidToneColors(
  dark: boolean,
  hue: number,
  depth: number,
  chroma?: number,
): FluidToneColors {
  const h = (((hue + FLUID_HUE_BASE) % 360) + 360) % 360;
  const d = Math.min(1, Math.max(0, depth / 100));
  const ramp = (deep: number, mid: number, pale: number): number =>
    d < 0.5
      ? deep + ((mid - deep) * d) / 0.5
      : mid + ((pale - mid) * (d - 0.5)) / 0.5;
  const sat = (full: number): number =>
    chroma === undefined ? full : Math.min(full, Math.max(0, chroma));
  if (dark) {
    return {
      color1: hsl(h, sat(0.85), ramp(0, 0.46, 0.62)),
      color2: hsl(h, sat(0.9), ramp(0, 0.305, 0.45)),
      color3: hsl(h, sat(0.5), ramp(0, 0.075, 0.1)),
    };
  }
  return {
    color1: hsl(h, sat(1), ramp(0.27, 0.45, 0.9)),
    color2: hsl(h, sat(0.55), 0.86),
    color3: hsl(h, sat(0.25), 0.955),
  };
}

export function fluidPresetToneColors(
  dark: boolean,
  preset: FluidPreset,
): FluidToneColors {
  return fluidToneColors(dark, preset.hue, preset.depth, fluidPresetChroma(preset));
}

/** preset 色点(设置页 swatch):中段色即可辨。 */
export function fluidPresetSwatch(preset: FluidPreset, dark: boolean): string {
  return fluidPresetToneColors(dark, preset).color1;
}
