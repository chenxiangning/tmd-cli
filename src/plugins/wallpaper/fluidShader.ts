/**
 * file-size-exempt:attachFluidShader 是单闭包状态机(编译缓存/FBO 乒乓/
 * RAF 节流共享一坨闭包变量),拆文件需要重写为类,违背「移植代码逐字不动」
 * 的初衷;ipc.ts 是本仓库同类豁免先例。
 *
 * 流体着色器运行时 —— 移植自 codemoss
 * src/features/onboarding/utils/fluidShader.ts(adapted from
 * DSH-Transparent-UI-Plugin, MIT License, Copyright (c) 2026 John Wu)。
 *
 * WebGL2 缺失 / 编译失败 → 静默 no-op 句柄(绝不能阻塞首屏)。
 * prefers-reduced-motion 画一帧静帧;profile=lite 供低性能路径
 * (12fps / 半分辨率 / chase 降段)。
 */

import {
  DRIFT_DISPLAY_SHADER,
  FLOW_SHADER,
  STORM_DISPLAY_SHADER,
  TAIJI_DISPLAY_SHADER,
  TORNADO_DISPLAY_SHADER,
  VERTEX_SHADER,
} from "./fluidGlsl";
import { chaseDisplayShader } from "./fluidChaseGlsl";

export type FluidMotionMode = 0 | 1 | 2 | 3 | 4;

export function clampFluidMotionMode(mode: number | undefined): FluidMotionMode {
  const rounded = Math.round(mode ?? 0);
  if (rounded === 1 || rounded === 2 || rounded === 3 || rounded === 4) {
    return rounded;
  }
  return 0;
}

export interface FluidParams {
  mouseRadius: number;
  mouseStrength: number;
  decay: number;
  distortBoost: number;
  noiseBoost: number;
  swirlBoost: number;
  speed: number;
  distortion: number;
  swirl: number;
  swirlIterations: number;
  scale: number;
  rotation: number;
  proportion: number;
  softness: number;
  shapeScale: number;
  offsetX: number;
  offsetY: number;
  color1: string;
  color2: string;
  color3: string;
  /** 0 drift / 1 taiji / 2 storm / 3 tornado / 4 chase. Defaults to drift. */
  motionMode?: number;
}

export const SITE_FLUID_PARAMS: FluidParams = {
  mouseRadius: 0.22,
  mouseStrength: 1.1,
  decay: 0.96,
  distortBoost: 1.35,
  noiseBoost: 0,
  swirlBoost: 0.45,
  speed: 14,
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
  color1: "#8AA3D6",
  color2: "#FFFFFF",
  color3: "#FFFFFF",
  motionMode: 0,
};

export function buildDisplayFragmentShader(
  mode: number,
  options: { reduced?: boolean } = {},
): string {
  switch (clampFluidMotionMode(mode)) {
    case 1:
      return TAIJI_DISPLAY_SHADER;
    case 2:
      return STORM_DISPLAY_SHADER;
    case 3:
      return TORNADO_DISPLAY_SHADER;
    case 4:
      return options.reduced
        ? chaseDisplayShader(14, 2)
        : chaseDisplayShader(20, 4);
    default:
      return DRIFT_DISPLAY_SHADER;
  }
}

function hexToRgb(value: string): [number, number, number] {
  const hex = value.replace("#", "");
  return [
    parseInt(hex.slice(0, 2), 16) / 255,
    parseInt(hex.slice(2, 4), 16) / 255,
    parseInt(hex.slice(4, 6), 16) / 255,
  ];
}

export type FluidShaderProfile = "full" | "lite";

export type FluidShaderAttachOptions = {
  /**
   * Windows / WebView2 only. Mac keeps OS reduced-motion (static frame).
   * WebView2 can report reduce even when the user opted into fluid.
   */
  forceAnimate?: boolean;
  /**
   * Windows / WebView2 only. Skip compiling chase until it is selected.
   * Mac precompiles all five fields the way the working Metal path did.
   */
  deferChase?: boolean;
};

export interface FluidShaderHandle {
  readonly attached: boolean;
  setParams: (params: FluidParams) => void;
  stir: (x: number, y: number, vx: number, vy: number) => void;
  pause: () => void;
  resume: () => void;
  dispose: () => void;
}

function noopHandle(): FluidShaderHandle {
  return {
    attached: false,
    setParams: () => undefined,
    stir: () => undefined,
    pause: () => undefined,
    resume: () => undefined,
    dispose: () => undefined,
  };
}

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

const WEBGL2_CONTEXT_ATTEMPTS: WebGLContextAttributes[] = [
  // Same flags as the working design prototype. `desynchronized` is unused
  // here (mouse stir is a no-op) and WebView2 / ANGLE may reject it.
  {
    alpha: false,
    antialias: false,
    depth: false,
    stencil: false,
    powerPreference: "low-power",
  },
  {
    alpha: true,
    antialias: false,
    depth: false,
    stencil: false,
    premultipliedAlpha: true,
    powerPreference: "low-power",
  },
  {
    alpha: true,
    antialias: false,
    depth: false,
    stencil: false,
    premultipliedAlpha: false,
    powerPreference: "default",
  },
];

function getWebGL2Context(canvas: HTMLCanvasElement): WebGL2RenderingContext | null {
  for (const attrs of WEBGL2_CONTEXT_ATTEMPTS) {
    try {
      const gl = canvas.getContext("webgl2", attrs);
      if (gl) {
        return gl;
      }
    } catch {
      // WebView2 / ANGLE can throw on unsupported context flags.
    }
  }
  try {
    return canvas.getContext("webgl2");
  } catch {
    return null;
  }
}

function warnFluidShader(stage: string, detail: string | null): void {
  if (typeof console === "undefined" || typeof console.warn !== "function") {
    return;
  }
  console.warn(`[fluidShader] ${stage} failed`, detail ?? "");
}

/**
 * Mount the fluid simulation on a canvas and run it until disposed.
 * Missing WebGL2 / compile failure returns a no-op handle.
 */
export function attachFluidShader(
  canvas: HTMLCanvasElement,
  params: FluidParams,
  profile: FluidShaderProfile = "full",
  options: FluidShaderAttachOptions = {},
): FluidShaderHandle {
  const lite = profile === "lite";
  const forceAnimate = options.forceAnimate === true;
  const deferChase = options.deferChase === true;
  const gl = getWebGL2Context(canvas);
  if (gl === null) {
    warnFluidShader("webgl2 context", "getContext returned null");
    return noopHandle();
  }

  const compile = (type: number, source: string): WebGLShader | null => {
    try {
      const shader = gl.createShader(type);
      if (shader === null) return null;
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        warnFluidShader(
          type === gl.VERTEX_SHADER ? "vertex compile" : "fragment compile",
          gl.getShaderInfoLog(shader),
        );
        gl.deleteShader(shader);
        return null;
      }
      return shader;
    } catch (error) {
      warnFluidShader(
        type === gl.VERTEX_SHADER ? "vertex compile" : "fragment compile",
        error instanceof Error ? error.message : String(error),
      );
      return null;
    }
  };

  const link = (fragment: string): WebGLProgram | null => {
    try {
      const vertex = compile(gl.VERTEX_SHADER, VERTEX_SHADER);
      const frag = compile(gl.FRAGMENT_SHADER, fragment);
      if (vertex === null || frag === null) return null;
      const program = gl.createProgram();
      if (program === null) return null;
      gl.attachShader(program, vertex);
      gl.attachShader(program, frag);
      gl.linkProgram(program);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        warnFluidShader("program link", gl.getProgramInfoLog(program));
        gl.deleteProgram(program);
        return null;
      }
      return program;
    } catch (error) {
      warnFluidShader(
        "program link",
        error instanceof Error ? error.message : String(error),
      );
      return null;
    }
  };

  const flowProgram = link(FLOW_SHADER);
  if (flowProgram === null) {
    warnFluidShader("flow program", "compile or link failed");
  }

  interface DisplayLocs {
    time: WebGLUniformLocation | null;
    pixelRatio: WebGLUniformLocation | null;
    resolution: WebGLUniformLocation | null;
    scale: WebGLUniformLocation | null;
    rotation: WebGLUniformLocation | null;
    offset: WebGLUniformLocation | null;
    color1: WebGLUniformLocation | null;
    color2: WebGLUniformLocation | null;
    color3: WebGLUniformLocation | null;
    colorCount: WebGLUniformLocation | null;
    proportion: WebGLUniformLocation | null;
    softness: WebGLUniformLocation | null;
    shape: WebGLUniformLocation | null;
    shapeScale: WebGLUniformLocation | null;
    distortion: WebGLUniformLocation | null;
    swirl: WebGLUniformLocation | null;
    swirlIterations: WebGLUniformLocation | null;
    flowmap: WebGLUniformLocation | null;
    distortBoost: WebGLUniformLocation | null;
    noiseBoost: WebGLUniformLocation | null;
    swirlBoost: WebGLUniformLocation | null;
    strokeScale: WebGLUniformLocation | null;
  }
  interface DisplayBinding {
    program: WebGLProgram;
    locs: DisplayLocs;
  }

  const locateDisplay = (program: WebGLProgram): DisplayLocs => ({
    time: gl.getUniformLocation(program, "u_time"),
    pixelRatio: gl.getUniformLocation(program, "u_pixelRatio"),
    resolution: gl.getUniformLocation(program, "u_resolution"),
    scale: gl.getUniformLocation(program, "u_scale"),
    rotation: gl.getUniformLocation(program, "u_rotation"),
    offset: gl.getUniformLocation(program, "u_offset"),
    color1: gl.getUniformLocation(program, "u_color1"),
    color2: gl.getUniformLocation(program, "u_color2"),
    color3: gl.getUniformLocation(program, "u_color3"),
    colorCount: gl.getUniformLocation(program, "u_colorCount"),
    proportion: gl.getUniformLocation(program, "u_proportion"),
    softness: gl.getUniformLocation(program, "u_softness"),
    shape: gl.getUniformLocation(program, "u_shape"),
    shapeScale: gl.getUniformLocation(program, "u_shapeScale"),
    distortion: gl.getUniformLocation(program, "u_distortion"),
    swirl: gl.getUniformLocation(program, "u_swirl"),
    swirlIterations: gl.getUniformLocation(program, "u_swirlIterations"),
    flowmap: gl.getUniformLocation(program, "u_flowmap"),
    distortBoost: gl.getUniformLocation(program, "u_distortBoost"),
    noiseBoost: gl.getUniformLocation(program, "u_noiseBoost"),
    swirlBoost: gl.getUniformLocation(program, "u_swirlBoost"),
    strokeScale: gl.getUniformLocation(program, "u_strokeScale"),
  });

  const displayCache = new Map<string, DisplayBinding | null>();
  const compileDisplay = (
    mode: FluidMotionMode,
    reduced = false,
  ): DisplayBinding | null => {
    const key = reduced ? `${mode}-reduced` : String(mode);
    const cached = displayCache.get(key);
    if (cached !== undefined) {
      return cached;
    }
    const program = link(buildDisplayFragmentShader(mode, { reduced }));
    if (program === null) {
      warnFluidShader(
        `display mode ${mode}${reduced ? " reduced" : ""}`,
        "compile or link failed",
      );
      displayCache.set(key, null);
      return null;
    }
    const binding = { program, locs: locateDisplay(program) };
    displayCache.set(key, binding);
    return binding;
  };
  const ensureDisplay = (mode: FluidMotionMode): DisplayBinding | null => {
    const primary = compileDisplay(mode);
    if (primary) {
      return primary;
    }
    return mode === 4 ? compileDisplay(4, true) : null;
  };

  // Mac compiles every field up front (chase included). WebView2 / ANGLE
  // can lose the context if chase is baked before the first present.
  const eagerModes: FluidMotionMode[] = deferChase
    ? [0, 1, 2, 3]
    : [0, 1, 2, 3, 4];
  for (const mode of eagerModes) {
    ensureDisplay(mode);
  }
  const initialDisplay = ensureDisplay(clampFluidMotionMode(params.motionMode));
  if (initialDisplay === null) {
    return noopHandle();
  }

  const flow =
    flowProgram === null
      ? null
      : {
          prev: gl.getUniformLocation(flowProgram, "u_prev"),
          mouse: gl.getUniformLocation(flowProgram, "u_mouse"),
          velocity: gl.getUniformLocation(flowProgram, "u_velocity"),
          brushRadius: gl.getUniformLocation(flowProgram, "u_brushRadius"),
          brushStrength: gl.getUniformLocation(flowProgram, "u_brushStrength"),
          decay: gl.getUniformLocation(flowProgram, "u_decay"),
        };

  const quadBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffer);
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]),
    gl.STATIC_DRAW,
  );

  const bindQuad = (program: WebGLProgram): void => {
    const position = gl.getAttribLocation(program, "a_position");
    gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffer);
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
  };

  interface FlowTarget {
    fbo: WebGLFramebuffer;
    tex: WebGLTexture;
  }
  const makeTarget = (
    width: number,
    height: number,
    initial?: Uint8Array,
  ): FlowTarget | null => {
    const tex = gl.createTexture();
    if (tex === null) return null;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    if (initial !== undefined) {
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RGBA,
        width,
        height,
        0,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        initial,
      );
    } else {
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RGBA,
        width,
        height,
        0,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        null,
      );
    }
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const fbo = gl.createFramebuffer();
    if (fbo === null) return null;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(
      gl.FRAMEBUFFER,
      gl.COLOR_ATTACHMENT0,
      gl.TEXTURE_2D,
      tex,
      0,
    );
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return { fbo, tex };
  };

  let width = 0;
  let height = 0;
  let flowWidth = 0;
  let flowHeight = 0;
  let flip = false;
  let current: FluidParams = { ...params };
  const dprCap = lite ? 1 : Math.min(window.devicePixelRatio || 1, 1.5);
  const resolutionScale = lite ? 0.5 : 1;
  // Drift keeps the flow ping-pong at 30. Structured fields (chase
  // especially) have no flow pass — present at display refresh so the
  // curtain walk does not quantize into 30 fps steps.
  const fpsFor = (mode: number): number => {
    if (lite) return 12;
    return mode === 0 ? 30 : 60;
  };
  const measureCanvasSize = (): { nextWidth: number; nextHeight: number } => ({
    nextWidth: Math.max(
      1,
      Math.round(canvas.clientWidth * dprCap * resolutionScale),
    ),
    nextHeight: Math.max(
      1,
      Math.round(canvas.clientHeight * dprCap * resolutionScale),
    ),
  });
  ({ nextWidth: width, nextHeight: height } = measureCanvasSize());
  canvas.width = width;
  canvas.height = height;
  flowWidth = Math.max(1, Math.round(width / (lite ? 6 : 4)));
  flowHeight = Math.max(1, Math.round(height / (lite ? 6 : 4)));

  const initial = new Uint8Array(flowWidth * flowHeight * 4);
  for (let i = 0; i < flowWidth * flowHeight; i += 1) {
    initial[4 * i] = 0;
    initial[4 * i + 1] = 128;
    initial[4 * i + 2] = 128;
    initial[4 * i + 3] = 255;
  }
  const targetA = makeTarget(flowWidth, flowHeight, initial);
  const targetB = makeTarget(flowWidth, flowHeight, initial);
  const flowReady =
    flowProgram !== null &&
    flow !== null &&
    targetA !== null &&
    targetB !== null;

  const start = performance.now();
  let raf = 0;
  let previous = 0;
  let paused = false;
  let disposed = false;

  const syncCanvasSize = (): void => {
    const { nextWidth, nextHeight } = measureCanvasSize();
    if (nextWidth === width && nextHeight === height) {
      return;
    }
    width = nextWidth;
    height = nextHeight;
    canvas.width = width;
    canvas.height = height;
  };

  const shouldAnimate = (): boolean => forceAnimate || !prefersReducedMotion();

  const draw = (): void => {
    const p = current;
    const mode = clampFluidMotionMode(p.motionMode);
    const display = ensureDisplay(mode);
    if (display === null) {
      const fallback = hexToRgb(p.color3 || "#FFFFFF");
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, width, height);
      gl.clearColor(fallback[0], fallback[1], fallback[2], 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
      return;
    }

    if (mode === 0 && flowReady && targetA && targetB && flow && flowProgram) {
      const read = flip ? targetA : targetB;
      const write = flip ? targetB : targetA;
      flip = !flip;

      gl.bindFramebuffer(gl.FRAMEBUFFER, write.fbo);
      gl.viewport(0, 0, flowWidth, flowHeight);
      gl.useProgram(flowProgram);
      bindQuad(flowProgram);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, read.tex);
      gl.uniform1i(flow.prev, 0);
      gl.uniform2f(flow.mouse, 0.5, 0.5);
      gl.uniform2f(flow.velocity, 0, 0);
      gl.uniform1f(flow.brushRadius, p.mouseRadius);
      gl.uniform1f(flow.brushStrength, p.mouseStrength);
      gl.uniform1f(flow.decay, p.decay);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);

      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, write.tex);
    } else {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }

    const locs = display.locs;
    gl.viewport(0, 0, width, height);
    gl.useProgram(display.program);
    bindQuad(display.program);
    const time = (performance.now() - start) * 0.001 * (p.speed / 100);
    gl.uniform1f(locs.time, time);
    gl.uniform1f(locs.pixelRatio, window.devicePixelRatio || 1);
    gl.uniform2f(locs.resolution, width, height);
    gl.uniform1f(locs.scale, p.scale);
    gl.uniform1f(locs.rotation, p.rotation / 90);
    gl.uniform2f(locs.offset, p.offsetX / 100, p.offsetY / 100);
    const c1 = hexToRgb(p.color1 || "#2E58A4");
    const c2 = hexToRgb(p.color2 || "#D2E2EE");
    const c3 = hexToRgb(p.color3 || "#FFFFFF");
    gl.uniform4f(locs.color1, c1[0], c1[1], c1[2], 1);
    gl.uniform4f(locs.color2, c2[0], c2[1], c2[2], 1);
    gl.uniform4f(locs.color3, c3[0], c3[1], c3[2], 1);
    gl.uniform1f(locs.colorCount, 3);
    gl.uniform1f(locs.proportion, p.proportion / 100);
    gl.uniform1f(locs.softness, p.softness / 100);
    gl.uniform1f(locs.shape, 0);
    gl.uniform1f(locs.shapeScale, p.shapeScale / 100);
    gl.uniform1f(locs.distortion, p.distortion / 100);
    gl.uniform1f(locs.swirl, p.swirl / 50);
    gl.uniform1f(
      locs.swirlIterations,
      lite ? Math.min(p.swirlIterations, 4) : p.swirlIterations,
    );
    gl.uniform1i(locs.flowmap, 0);
    gl.uniform1f(locs.distortBoost, p.distortBoost);
    gl.uniform1f(locs.noiseBoost, p.noiseBoost);
    gl.uniform1f(locs.swirlBoost, p.swirlBoost);
    gl.uniform1f(locs.strokeScale, lite ? 2.4 : 1.0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  };

  const frame = (now: number): void => {
    if (disposed || paused) {
      raf = 0;
      return;
    }
    raf = requestAnimationFrame(frame);
    const step = 1000 / fpsFor(clampFluidMotionMode(current.motionMode));
    if (now - previous < step) return;
    previous = now - ((now - previous) % step);
    draw();
  };

  const stopLoop = (): void => {
    if (raf !== 0) {
      cancelAnimationFrame(raf);
      raf = 0;
    }
  };

  const startLoop = (): void => {
    if (disposed || paused || !shouldAnimate() || raf !== 0) {
      return;
    }
    previous = 0;
    raf = requestAnimationFrame(frame);
  };

  const handleHidden = (): void => {
    if (document.hidden) {
      stopLoop();
      return;
    }
    startLoop();
  };

  const handle: FluidShaderHandle = {
    attached: true,
    setParams: (next: FluidParams) => {
      current = { ...next };
      ensureDisplay(clampFluidMotionMode(next.motionMode));
      previous = 0;
      draw();
      startLoop();
    },
    stir: () => undefined,
    pause: () => {
      paused = true;
      stopLoop();
    },
    resume: () => {
      if (disposed) {
        return;
      }
      paused = false;
      startLoop();
    },
    dispose: () => {
      disposed = true;
      paused = true;
      stopLoop();
      window.removeEventListener("resize", syncCanvasSize);
      document.removeEventListener("visibilitychange", handleHidden);
      resizeObserver?.disconnect();
    },
  };

  window.addEventListener("resize", syncCanvasSize);
  document.addEventListener("visibilitychange", handleHidden);
  const resizeObserver =
    typeof ResizeObserver === "undefined"
      ? null
      : new ResizeObserver(() => {
          syncCanvasSize();
        });
  resizeObserver?.observe(canvas);

  draw();
  startLoop();
  return handle;
}
