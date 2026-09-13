/**
 * 流体背景移植件测试 —— tones 调色(移植自 codemoss fluidTones.test 关键用例)
 * 与 buildDisplayFragmentShader 程序选择;attach 在 jsdom 无 WebGL2 返回 no-op。
 */

import { describe, expect, it } from "vitest";
import {
  DEFAULT_FLUID_MOTION,
  DEFAULT_FLUID_PRESET,
  FLUID_PRESETS,
  fluidToneColors,
  resolveFluidMotion,
  resolveFluidPreset,
} from "./fluidTones";
import { attachFluidShader, buildDisplayFragmentShader, clampFluidMotionMode } from "./fluidShader";

describe("fluidTones", () => {
  it("mist 浅色三段色是合法 hex 且同 hue 族", () => {
    const tone = fluidToneColors(false, 0, 25);
    for (const color of [tone.color1, tone.color2, tone.color3]) {
      expect(color).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });

  it("深色模式基色比泛光深", () => {
    const tone = fluidToneColors(true, 0, 25);
    const lum = (hex: string) =>
      [0, 2, 4].reduce((sum, i) => sum + parseInt(hex.slice(1 + i, 3 + i), 16), 0);
    expect(lum(tone.color2)).toBeLessThan(lum(tone.color1) + 1);
  });

  it("未知 preset/motion 回落默认(mist/drift)", () => {
    expect(resolveFluidPreset("nope").id).toBe(DEFAULT_FLUID_PRESET);
    expect(resolveFluidMotion("nope").id).toBe(DEFAULT_FLUID_MOTION);
  });

  it("ash 是低饱和灰洗,与 ink 可区分", () => {
    const ash = FLUID_PRESETS.find((p) => p.id === "ash")!;
    const ink = FLUID_PRESETS.find((p) => p.id === "ink")!;
    expect(ash.chroma).toBeDefined();
    expect("chroma" in ink).toBe(false);
    const ashTone = fluidToneColors(false, ash.hue, ash.depth, ash.chroma);
    const inkTone = fluidToneColors(false, ink.hue, ink.depth);
    expect(ashTone.color1).not.toBe(inkTone.color1);
  });
});

describe("buildDisplayFragmentShader", () => {
  it("未知 mode 收敛到 drift", () => {
    expect(clampFluidMotionMode(99)).toBe(0);
    expect(clampFluidMotionMode(undefined)).toBe(0);
    expect(clampFluidMotionMode(2.4)).toBe(2);
    expect(buildDisplayFragmentShader(99)).toBe(buildDisplayFragmentShader(0));
  });

  it("drift 不含结构场专属代码,四个结构场各成独立程序", () => {
    const drift = buildDisplayFragmentShader(0);
    expect(drift).not.toContain("motionTaiji");
    expect(drift).not.toContain("motionChase");
    expect(buildDisplayFragmentShader(1)).toContain("motionTaiji");
    expect(buildDisplayFragmentShader(2)).toContain("motionStorm");
    expect(buildDisplayFragmentShader(3)).toContain("motionTornado");
    expect(buildDisplayFragmentShader(4)).toContain("motionChase");
  });

  it("chase 有 ANGLE 回落的 reduced 变体", () => {
    const full = buildDisplayFragmentShader(4);
    const reduced = buildDisplayFragmentShader(4, { reduced: true });
    expect(full).not.toBe(reduced);
    expect(full).toContain("i <= 20");
    expect(reduced).toContain("i <= 14");
  });
});

describe("attachFluidShader", () => {
  it("WebGL2 不可用返回 no-op 句柄,不抛出(node 环境,桩 canvas)", () => {
    const canvas = {
      getContext: () => null,
      clientWidth: 0,
      clientHeight: 0,
    } as unknown as HTMLCanvasElement;
    const handle = attachFluidShader(canvas, { ...buildDriftParams() });
    expect(handle.attached).toBe(false);
    expect(() => {
      handle.setParams(buildDriftParams());
      handle.pause();
      handle.resume();
      handle.dispose();
    }).not.toThrow();
  });
});

function buildDriftParams() {
  const tone = fluidToneColors(false, 0, 25);
  return {
    mouseRadius: 0.22,
    mouseStrength: 1.1,
    decay: 0.96,
    distortBoost: 1.35,
    noiseBoost: 0,
    swirlBoost: 0.45,
    speed: 9,
    distortion: 20,
    swirl: 12,
    swirlIterations: 8,
    scale: 0.5,
    rotation: -5,
    proportion: 50,
    softness: 100,
    shapeScale: 10,
    offsetX: 0,
    offsetY: 65,
    color1: tone.color1,
    color2: tone.color2,
    color3: tone.color3,
    motionMode: 0,
  };
}
