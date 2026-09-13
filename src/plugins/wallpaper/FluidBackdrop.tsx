/**
 * 流体背景组件 —— 移植自 codemoss FirstRunFluidBackdrop.tsx
 * (adapted from DSH-Transparent-UI-Plugin, MIT License,
 * Copyright (c) 2026 John Wu)。
 *
 * 本地化差异:明暗跟随由 MutationObserver 换成 kernel 的
 * subscribeThemeApplied(theme.ts 是 :root[data-theme] 唯一写点,
 * 事件比 DOM 监听更准);参数变化经 setParams 原地推送,只有
 * profile 切换才重挂 WebGL 上下文。
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { subscribeThemeApplied } from "@kernel/theme";
import {
  attachFluidShader,
  SITE_FLUID_PARAMS,
  type FluidParams,
  type FluidShaderHandle,
  type FluidShaderProfile,
} from "./fluidShader";
import {
  DEFAULT_FLUID_MOTION,
  DEFAULT_FLUID_PRESET,
  fluidPresetToneColors,
  resolveFluidMotion,
  resolveFluidPreset,
  type FluidMotionId,
  type FluidPresetId,
} from "./fluidTones";

/** 工作区流体比首跑向导慢(codemoss 同款:首跑 speed=14,工作区 9)。 */
export const WORKSPACE_FLUID_SPEED = 9;

function readDark(): boolean {
  if (typeof document === "undefined") return false;
  return document.documentElement.dataset.theme === "dark";
}

function buildFluidParams(
  dark: boolean,
  presetId: FluidPresetId,
  motionId: FluidMotionId,
  speed: number,
): FluidParams {
  const preset = resolveFluidPreset(presetId);
  const motion = resolveFluidMotion(motionId);
  return {
    ...SITE_FLUID_PARAMS,
    ...fluidPresetToneColors(dark, preset),
    motionMode: motion.mode,
    speed,
  };
}

export function FluidBackdrop({
  paused = false,
  presetId = DEFAULT_FLUID_PRESET,
  motionId = DEFAULT_FLUID_MOTION,
  speed = WORKSPACE_FLUID_SPEED,
  profile = "full",
  forceAnimate = false,
  deferChase = false,
  onAttachChange,
}: {
  paused?: boolean;
  presetId?: FluidPresetId;
  motionId?: FluidMotionId;
  speed?: number;
  profile?: FluidShaderProfile;
  forceAnimate?: boolean;
  deferChase?: boolean;
  onAttachChange?: (attached: boolean) => void;
} = {}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const handleRef = useRef<FluidShaderHandle | null>(null);
  const onAttachChangeRef = useRef(onAttachChange);
  const [attached, setAttached] = useState(false);
  const [dark, setDark] = useState(readDark);
  const params = useMemo(
    () => buildFluidParams(dark, presetId, motionId, speed),
    [dark, presetId, motionId, speed],
  );

  /* 明暗跟随:主题引擎重应用后重算三段色(setParams 原地推送)。 */
  useEffect(() => subscribeThemeApplied(() => setDark(readDark())), []);

  // Params changes (preset / light-dark flip) are pushed through setParams so
  // the WebGL context survives; only a profile switch re-attaches.
  // ref 同步走 effect(声明在 attach 之前,挂载顺序保证 attach 读到最新值)。
  const paramsRef = useRef(params);
  useEffect(() => {
    paramsRef.current = params;
  }, [params]);
  useEffect(() => {
    onAttachChangeRef.current = onAttachChange;
  }, [onAttachChange]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return undefined;
    }
    const handle = attachFluidShader(canvas, paramsRef.current, profile, {
      forceAnimate,
      deferChase,
    });
    handleRef.current = handle;
    setAttached(handle.attached);
    onAttachChangeRef.current?.(handle.attached);
    if (paused) {
      handle.pause();
    }
    return () => {
      handleRef.current = null;
      setAttached(false);
      onAttachChangeRef.current?.(false);
      handle.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile, forceAnimate, deferChase]);

  useEffect(() => {
    handleRef.current?.setParams(params);
  }, [params]);

  useEffect(() => {
    const handle = handleRef.current;
    if (!handle) {
      return;
    }
    if (paused) {
      handle.pause();
      return;
    }
    handle.resume();
  }, [paused]);

  return (
    <div
      className="tmd-fluid"
      aria-hidden
      data-testid="tmd-fluid"
      data-scheme={dark ? "dark" : "light"}
      data-motion={motionId}
      data-profile={profile}
      data-attached={attached ? "true" : "false"}
    >
      <canvas ref={canvasRef} className="tmd-fluid-canvas" />
    </div>
  );
}
