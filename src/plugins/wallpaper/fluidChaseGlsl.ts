/**
 * file-size-exempt:chase(游龙)显示着色器是单一模板生成函数(SDF 龙体
 * 一次成串),拆散 GLSL 会破坏已验证的着色器源;移植代码保持逐字不动。
 *
 * 逐字移植自 codemoss src/features/onboarding/utils/fluidShader.ts
 * (adapted from DSH-Transparent-UI-Plugin, MIT License,
 * Copyright (c) 2026 John Wu)。
 *
 * chase = 中国龙 SDF 沿贝塞尔「巡场」走位:槽 0 常驻、槽 1 时来时走,
 * 同屏至多两条;reduced 变体(14 段脊椎/2 腿)是 ANGLE 编译失败的回落。
 */

import { DISPLAY_COMMON, DISPLAY_NOISE } from "./fluidGlsl";

export function chaseDisplayShader(spine: number, legCount: number): string {
  const alongStep = (0.64 / Math.max(legCount, 1)).toFixed(2);
  return `${DISPLAY_COMMON}
uniform float u_strokeScale;
${DISPLAY_NOISE}
float sdSegment(vec2 p, vec2 a, vec2 b) {
  vec2 pa = p - a;
  vec2 ba = b - a;
  float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-5), 0.0, 1.0);
  return length(pa - ba * h);
}

// Tapered segment: radius lerps r0 -> r1 along a -> b. Claws, horns,
// whiskers and tail barbs all need sharp tips, which a uniform-radius
// capsule cannot express.
float sdSegT(vec2 p, vec2 a, vec2 b, float r0, float r1) {
  vec2 pa = p - a;
  vec2 ba = b - a;
  float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-5), 0.0, 1.0);
  return length(pa - ba * h) - mix(r0, r1, h);
}

float hash11(float n) {
  return random(vec2(n, n * 1.37));
}

// 0 left / 1 right / 2 bottom / 3 top. Points sit past the viewport
// so a dragon can enter and leave like a stage curtain.
vec2 edgePoint(float side, float along, float aspect, float margin) {
  float x = mix(-margin, aspect + margin, along);
  float y = mix(-margin, 1.0 + margin, along);
  if (side < 0.5) return vec2(-margin, y);
  if (side < 1.5) return vec2(aspect + margin, y);
  if (side < 2.5) return vec2(x, -margin);
  return vec2(x, 1.0 + margin);
}

void tourCtrl(float slot, float gen, float aspect, out vec2 a, out vec2 b, out vec2 c, out vec2 d, out float sz) {
  float h = slot * 19.73 + gen * 91.31 + 4.7;
  float entrySide = floor(hash11(h) * 4.0);
  float exitSide = mod(entrySide + 1.0 + floor(hash11(h + 1.3) * 3.0), 4.0);
  float margin = 0.30;
  float alongA = 0.12 + 0.76 * hash11(h + 2.7);
  float alongD = 0.12 + 0.76 * hash11(h + 3.1);
  a = edgePoint(entrySide, alongA, aspect, margin);
  d = edgePoint(exitSide, alongD, aspect, margin);
  // Adjacent edges can collapse into a corner hop. Flip the nearer
  // along so every tour actually crosses the stage.
  vec2 stage = vec2(aspect, 1.0);
  float minSpan = 0.72 * length(stage);
  if (length(d - a) < minSpan) {
    alongA = 1.0 - alongA;
    a = edgePoint(entrySide, alongA, aspect, margin);
    if (length(d - a) < minSpan) {
      alongD = 1.0 - alongD;
      d = edgePoint(exitSide, alongD, aspect, margin);
    }
  }
  vec2 chord = d - a;
  vec2 nrm = normalize(vec2(-chord.y, chord.x) + vec2(1e-4, 0.0));
  float span = max(length(chord), 1e-3);
  // One shared bow + a small S, controls on the chord thirds. Pulling
  // toward screen-center used to loop/cusp and snap the heading.
  float bow = (hash11(h + 4.9) - 0.5) * 0.22 * span;
  float sBend = (hash11(h + 5.5) - 0.5) * 0.08 * span;
  b = mix(a, d, 0.32) + nrm * (bow + sBend);
  c = mix(a, d, 0.68) + nrm * (bow - sBend);
  // Slot 0 stays readable; guests roll a modest random size.
  float roll = hash11(h + 8.8);
  sz = slot < 0.5
    ? mix(0.92, 1.78, roll)
    : mix(0.62, 1.48, roll);
}

vec2 bezierTan(vec2 a, vec2 b, vec2 c, vec2 d, float u) {
  float v = 1.0 - u;
  return 3.0 * v * v * (b - a) + 6.0 * v * u * (c - b) + 3.0 * u * u * (d - c);
}

// Extend the cubic linearly off-stage so the body never curls back
// onto the entry/exit edge.
vec2 bezierExt(vec2 a, vec2 b, vec2 c, vec2 d, float u) {
  if (u <= 0.0) {
    return a + normalize(bezierTan(a, b, c, d, 0.0) + vec2(1e-4, 0.0)) * u * 1.15;
  }
  if (u >= 1.0) {
    return d + normalize(bezierTan(a, b, c, d, 1.0) + vec2(1e-4, 0.0)) * (u - 1.0) * 1.15;
  }
  float v = 1.0 - u;
  return v * v * v * a + 3.0 * v * v * u * b + 3.0 * v * u * u * c + u * u * u * d;
}

// Heading from a look-ahead chord so the skull banks into the turn
// instead of snapping onto the instantaneous derivative.
vec2 tourFwd(vec2 a, vec2 b, vec2 c, vec2 d, float u) {
  float back = 0.05;
  float ahead = 0.12;
  vec2 p0 = bezierExt(a, b, c, d, u - back);
  vec2 p1 = bezierExt(a, b, c, d, u + ahead);
  return normalize(p1 - p0 + vec2(1e-4, 0.0));
}

// Body samples earlier path parameter — a one-way crossing never folds.
// Wave heading uses the cheap cubic tangent; skull still banks with tourFwd.
vec2 dragonSpine(float t, float seed, vec2 a, vec2 b, vec2 c, vec2 d, float headU, float sz, float along) {
  float trail = 0.07 + 0.22 * sz;
  float u = headU - along * trail;
  vec2 pos = bezierExt(a, b, c, d, u);
  vec2 fwd = normalize(bezierTan(a, b, c, d, clamp(u, 0.0, 1.0)) + vec2(1e-4, 0.0));
  vec2 side = vec2(-fwd.y, fwd.x);
  float wave = sin(along * 11.0 - t * 2.4 + seed) * (0.052 * sz * (0.28 + along));
  wave += sin(along * 19.0 - t * 3.1 + seed * 1.4) * (0.013 * sz * along);
  return pos + side * wave;
}

// x = body+head+legs+claws, y = horns/whisker/ridge/brow/tail-fin, z = eye
// Original Chinese-dragon SDF, scaled onto the curtain tour spine.
vec3 dragonStroke(vec2 p, float t, float seed, vec2 a, vec2 b, vec2 c, vec2 d, float headU, float size) {
  float sc = max(u_strokeScale, 1.0);
  float sz = max(size, 0.45);
  float aa = 1.5 * sc / max(u_resolution.y, 1.0);
  float pad = 0.0035 * (sc - 1.0);

  vec2 bmin = min(min(a, b), min(c, d)) - (0.36 * sz + 0.10);
  vec2 bmax = max(max(a, b), max(c, d)) + (0.36 * sz + 0.10);
  if (p.x < bmin.x || p.y < bmin.y || p.x > bmax.x || p.y > bmax.y) {
    return vec3(0.0);
  }

  vec2 prev = dragonSpine(t, seed, a, b, c, d, headU, sz, 0.0);
  float body = 1e5;
  float ridge = 1e5;
  for (int i = 1; i <= ${spine}; i++) {
    float along = float(i) / ${spine.toFixed(1)};
    vec2 next = dragonSpine(t, seed, a, b, c, d, headU, sz, along);
    float thick = mix(0.024, 0.0040, pow(along, 0.8)) * sz;
    thick *= 1.0 + 0.10 * sin(along * 40.0 + seed);
    body = min(body, sdSegment(p, prev, next) - thick);
    float saw = abs(fract(along * 15.0 - t * 0.15) * 2.0 - 1.0);
    ridge = min(ridge, sdSegment(p, prev, next) - thick * (0.10 + 0.30 * saw) * (1.0 - along * 0.55));
    prev = next;
  }

  vec2 head = dragonSpine(t, seed, a, b, c, d, headU, sz, 0.0);
  vec2 fwd = tourFwd(a, b, c, d, headU);
  vec2 side = vec2(-fwd.y, fwd.x);

  float headSd = sdSegT(p, head - fwd * 0.030 * sz, head + fwd * 0.020 * sz, 0.019 * sz, 0.0145 * sz);
  headSd = min(headSd, sdSegT(p, head + fwd * 0.020 * sz, head + fwd * 0.050 * sz, 0.0145 * sz, 0.0090 * sz));
  headSd = min(headSd, length(p - (head + fwd * 0.055 * sz)) - 0.0105 * sz);
  vec2 jawDir = rotate(fwd, 0.40);
  headSd = min(headSd, sdSegT(p, head + fwd * 0.006 * sz, head + fwd * 0.006 * sz + jawDir * 0.036 * sz, 0.0075 * sz, 0.0025 * sz));

  float mane = 1e5;
  for (int k = -2; k <= 2; k++) {
    float kf = float(k);
    vec2 m0 = head - fwd * 0.006 * sz + side * kf * 0.013 * sz;
    vec2 m1 = m0 - fwd * (0.024 + abs(kf) * 0.005) * sz + side * kf * 0.018 * sz;
    vec2 m2 = m1 - fwd * 0.013 * sz + side * kf * 0.012 * sz + fwd * 0.007 * sz * sin(t * 2.2 + kf * 1.3 + seed);
    mane = min(mane, sdSegT(p, m0, m1, 0.0060 * sz, 0.0034 * sz));
    mane = min(mane, sdSegT(p, m1, m2, 0.0034 * sz, 0.0007 * sz));
  }

  float horn = 1e5;
  for (int hi = 0; hi < 2; hi++) {
    float hs = hi == 0 ? 1.0 : -1.0;
    vec2 hb = head - fwd * 0.014 * sz + side * hs * 0.012 * sz;
    vec2 hm = hb - fwd * 0.034 * sz + side * hs * 0.020 * sz;
    vec2 ht = hb - fwd * 0.060 * sz + side * hs * 0.046 * sz;
    horn = min(horn, sdSegT(p, hb, hm, 0.0050 * sz, 0.0034 * sz));
    horn = min(horn, sdSegT(p, hm, ht, 0.0034 * sz, 0.0011 * sz));
    vec2 t1 = hb - fwd * 0.014 * sz + side * hs * 0.036 * sz;
    vec2 t2 = hm - fwd * 0.016 * sz + side * hs * 0.036 * sz;
    horn = min(horn, sdSegT(p, mix(hb, hm, 0.45), t1, 0.0026 * sz, 0.0008 * sz));
    horn = min(horn, sdSegT(p, mix(hm, ht, 0.40), t2, 0.0022 * sz, 0.0007 * sz));
  }

  float whisk = 1e5;
  for (int wi = 0; wi < 2; wi++) {
    float ws = wi == 0 ? 1.0 : -1.0;
    vec2 wPrev = head + fwd * 0.048 * sz + side * ws * 0.009 * sz;
    for (int si = 1; si <= 4; si++) {
      float fs = float(si) / 4.0;
      float sway = sin(fs * 5.5 - t * 1.8 + seed + ws) * 0.009 * fs;
      vec2 wp = head + fwd * (0.048 - fs * 0.115) * sz
        + side * ws * (0.009 + 0.040 * sin(fs * 2.2) + sway) * sz;
      whisk = min(whisk, sdSegT(p, wPrev, wp, mix(0.0018, 0.0005, fs - 0.25) * sz, mix(0.0018, 0.0005, fs) * sz));
      wPrev = wp;
    }
  }

  float legs = 1e5;
  for (int li = 0; li < ${legCount}; li++) {
    float la = 0.15 + float(li) * ${alongStep};
    float sgn = (li == 0 || li == 2) ? 1.0 : -1.0;
    float paddle = sin(t * 1.9 + float(li) * 1.7 + seed) * 0.10;
    vec2 root = dragonSpine(t, seed, a, b, c, d, headU, sz, la);
    vec2 p0 = dragonSpine(t, seed, a, b, c, d, headU, sz, max(la - 0.04, 0.0));
    vec2 p1 = dragonSpine(t, seed, a, b, c, d, headU, sz, min(la + 0.04, 1.0));
    vec2 alongDir = normalize(p1 - p0 + vec2(1e-4, 0.0));
    vec2 outDir = rotate(vec2(-alongDir.y, alongDir.x) * sgn, paddle);
    vec2 knee = root + outDir * 0.026 * sz + alongDir * 0.012 * sz;
    vec2 ankle = knee + outDir * 0.017 * sz - alongDir * 0.022 * sz;
    legs = min(legs, sdSegT(p, root, knee, 0.0100 * sz, 0.0062 * sz));
    legs = min(legs, sdSegT(p, knee, ankle, 0.0062 * sz, 0.0040 * sz));
    for (int ci = 0; ci < 3; ci++) {
      float ca = (float(ci) - 1.0) * 0.55;
      vec2 cdir = rotate(-alongDir, ca);
      vec2 tip = ankle + cdir * (0.015 - abs(ca) * 0.004) * sz;
      legs = min(legs, sdSegT(p, ankle, tip, 0.0034 * sz, 0.0007 * sz));
    }
  }

  vec2 tailTip = dragonSpine(t, seed, a, b, c, d, headU, sz, 1.0);
  vec2 tailPre = dragonSpine(t, seed, a, b, c, d, headU, sz, 0.94);
  vec2 tailDir = rotate(
    normalize(tailTip - tailPre + vec2(1e-5, 0.0)),
    0.15 * sin(t * 2.0 + seed)
  );
  float tailFin = 1e5;
  for (int fi = 0; fi < 3; fi++) {
    float fa = (float(fi) - 1.0) * 0.42;
    vec2 fd = rotate(tailDir, fa);
    vec2 fe = tailTip + fd * (0.050 - abs(fa) * 0.010) * sz;
    vec2 fpa = p - tailTip;
    vec2 fba = fe - tailTip;
    float fh = clamp(dot(fpa, fba) / max(dot(fba, fba), 1e-5), 0.0, 1.0);
    tailFin = min(tailFin, length(fpa - fba * fh) - (0.0015 + 0.0105 * pow(sin(fh * PI), 0.7)) * sz);
  }

  vec2 eyePos = head + fwd * 0.020 * sz + side * 0.010 * sz;
  float eye = length(p - eyePos) - 0.0048 * sz;
  vec2 browDir = rotate(fwd, 0.55);
  float brow = sdSegT(p, eyePos - browDir * 0.010 * sz, eyePos + browDir * 0.011 * sz, 0.0026 * sz, 0.0009 * sz);

  float fill = 1.0 - smoothstep(-aa, aa, body - pad);
  fill = max(fill, 1.0 - smoothstep(-aa, aa, min(headSd, mane) - pad));
  fill = max(fill, 1.0 - smoothstep(-aa, aa, legs - pad));
  float accent = 1.0 - smoothstep(-aa, aa, horn - pad);
  accent = max(accent, 1.0 - smoothstep(-aa, aa, whisk - pad));
  accent = max(accent, 1.0 - smoothstep(-aa, aa, tailFin - pad));
  accent = max(accent, 1.0 - smoothstep(-aa, aa, brow - pad));
  accent = max(accent, (1.0 - smoothstep(-aa, aa, ridge - pad)) * 0.40);
  float eyeMask = 1.0 - smoothstep(-aa * 0.6, aa * 0.6, eye);
  return vec3(fill, accent, eyeMask);
}

// Slot 0 is always touring (min 1). Slot 1 comes and goes so the
// stage holds at most 2 dragons.
vec3 slotParam(float slot) {
  vec3 p = vec3(16.0, 0.0, 1.0);
  p = mix(p, vec3(21.0, 6.4, 0.78), step(0.5, slot));
  return p;
}

float spawnChance(float slot) {
  return mix(1.0, 0.82, step(0.5, slot));
}

void compositeDragon(inout vec3 col, vec3 stroke, vec3 fillCol, vec3 eyeCol) {
  col = mix(col, fillCol, clamp(stroke.x, 0.0, 1.0));
  col = mix(col, fillCol * 0.72, stroke.y);
  col = mix(col, eyeCol, stroke.z);
}

void paintTour(vec2 p, float t, float slot, float gen, float headU, vec3 fillCol, vec3 eyeCol, inout vec3 col) {
  if (hash11(slot * 17.3 + gen * 91.7 + 2.4) > spawnChance(slot)) {
    return;
  }
  vec2 a, b, c, d;
  float sz;
  tourCtrl(slot, gen, u_resolution.x / max(u_resolution.y, 1.0), a, b, c, d, sz);
  float seed = slot * 1.7 + gen * 0.37;
  compositeDragon(col, dragonStroke(p, t, seed, a, b, c, d, headU, sz), fillCol, eyeCol);
}

void addSlot(vec2 p, float t, float slot, vec3 fillCol, vec3 eyeCol, inout vec3 col) {
  vec3 par = slotParam(slot);
  float cycle = par.x;
  float duty = par.z;
  float raw = (t + par.y) / cycle;
  float gen = floor(raw);
  float frac = raw - gen;
  float tail = 0.40;
  if (slot < 0.5) {
    // Head crosses 0→1 in one cycle. The previous tail keeps going
    // 1→1+tail so it leaves instead of rewinding onto the same edge.
    paintTour(p, t, slot, gen, frac, fillCol, eyeCol, col);
    if (frac < tail) {
      paintTour(p, t, slot, gen - 1.0, 1.0 + frac, fillCol, eyeCol, col);
    }
    return;
  }
  float travel = (frac / max(duty, 1e-3)) * (1.0 + tail);
  if (frac < duty && travel <= 1.0 + tail) {
    paintTour(p, t, slot, gen, travel, fillCol, eyeCol, col);
  }
}

vec3 motionChase(vec2 uv, float t) {
  vec2 p = uv;
  float aspect = u_resolution.x / max(u_resolution.y, 1.0);
  p.x *= aspect;

  vec3 wash = mix(u_color3.rgb, u_color2.rgb, 0.12);
  vec3 yangCol = u_color1.rgb;
  vec3 yinRaw = u_color2.rgb;
  float washLum = dot(wash, vec3(0.2126, 0.7152, 0.0722));
  float yinLum = dot(yinRaw, vec3(0.2126, 0.7152, 0.0722));
  vec3 yinCol = abs(yinLum - washLum) > 0.14
    ? yinRaw
    : (washLum > 0.5 ? yangCol * 0.22 : mix(vec3(1.0), yangCol, 0.18));

  vec3 col = wash;
  addSlot(p, t, 0.0, yangCol, yinCol, col);
  addSlot(p, t, 1.0, yinCol, yangCol, col);
  return col;
}

void main() {
  fragColor = vec4(motionChase(vUv, u_time * 7.0), 1.0);
}
`;
}
