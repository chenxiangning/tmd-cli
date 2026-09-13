/**
 * 流体背景 GLSL 源(非 chase 部分)—— 逐字移植自 codemoss
 * src/features/onboarding/utils/fluidShader.ts(adapted from
 * DSH-Transparent-UI-Plugin, MIT License, Copyright (c) 2026 John Wu)。
 *
 * drift = 两遍 domain warp(四分之一分辨流场 + 全分辨率噪声);
 * taiji/storm/tornado 是独立显示程序,WebView2/ANGLE 不必编译巨型
 * 合并着色器或依赖 early-return 分支。
 */

export const VERTEX_SHADER = `#version 300 es
in vec4 a_position;
out vec2 vUv;
void main() {
  vUv = a_position.xy * 0.5 + 0.5;
  gl_Position = a_position;
}
`;

export const FLOW_SHADER = `#version 300 es
precision mediump float;
in vec2 vUv;
uniform sampler2D u_prev;
uniform vec2 u_mouse;
uniform vec2 u_velocity;
uniform float u_brushRadius;
uniform float u_brushStrength;
uniform float u_decay;
out vec4 fragColor;

void main() {
  vec4 prev = texture(u_prev, vUv);

  prev.r *= u_decay;
  prev.gb = mix(vec2(0.5), prev.gb, u_decay);

  float dist = distance(vUv, u_mouse);

  float influence = exp(-dist * dist / (u_brushRadius * u_brushRadius * 0.5));
  influence = max(0.0, influence - 0.01);

  float speed = length(u_velocity);
  float presenceStrength = u_brushStrength * 0.3;
  float velBonus = min(speed * 3.0, 0.7) * u_brushStrength;
  float totalStrength = presenceStrength + velBonus;

  prev.r = max(prev.r, influence * totalStrength);
  float blendAmt = influence * min(totalStrength, 0.4) * 0.3;
  prev.g = mix(prev.g, clamp(u_velocity.x * 2.0 + 0.5, 0.0, 1.0), blendAmt);
  prev.b = mix(prev.b, clamp(u_velocity.y * 2.0 + 0.5, 0.0, 1.0), blendAmt);

  fragColor = prev;
}
`;

export const DISPLAY_COMMON = `#version 300 es
precision mediump float;
in vec2 vUv;
uniform float u_time;
uniform vec2 u_resolution;
uniform vec4 u_color1, u_color2, u_color3;
out vec4 fragColor;

#define TWO_PI 6.28318530718
#define PI 3.14159265358979323846

vec2 rotate(vec2 uv, float th) { return mat2(cos(th), sin(th), -sin(th), cos(th)) * uv; }
`;

export const DISPLAY_NOISE = `
float random(vec2 st) { return fract(sin(dot(st.xy, vec2(12.9898, 78.233))) * 43758.5453123); }
float noise(vec2 st) {
  vec2 i = floor(st); vec2 f = fract(st);
  float a = random(i), b = random(i + vec2(1,0)), c = random(i + vec2(0,1)), d = random(i + vec2(1,1));
  vec2 u = f*f*(3.0-2.0*f);
  return mix(mix(a,b,u.x), mix(c,d,u.x), u.y);
}
`;

export const DRIFT_DISPLAY_SHADER = `${DISPLAY_COMMON}
uniform float u_pixelRatio;
uniform float u_scale;
uniform float u_rotation;
uniform float u_colorCount;
uniform float u_proportion;
uniform float u_softness;
uniform float u_shape;
uniform float u_shapeScale;
uniform float u_distortion;
uniform float u_swirl;
uniform float u_swirlIterations;
uniform vec2 u_offset;
uniform sampler2D u_flowmap;
uniform float u_distortBoost;
uniform float u_noiseBoost;
uniform float u_swirlBoost;
${DISPLAY_NOISE}
vec3 blend_multi(float mixer, float softness) {
  float edge = 1.0 - softness;
  vec3 col = u_color1.rgb;
  if (u_colorCount > 1.5) { col = mix(col, u_color2.rgb, smoothstep(0.0 + 0.35*edge, 0.7 - 0.35*edge, mixer)); }
  if (u_colorCount > 2.5) { col = mix(col, u_color3.rgb, smoothstep(0.3 + 0.35*edge, 1.0 - 0.35*edge, mixer)); }
  return col;
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution.xy;
  float t = .5 * u_time;
  float ns = .0005 + .006 * u_scale;
  uv -= .5; uv *= (ns * u_resolution); uv = rotate(uv, u_rotation * .5 * PI);
  uv /= u_pixelRatio; uv += .5; uv += u_offset;

  vec2 fragUV = gl_FragCoord.xy / u_resolution.xy;
  vec4 flow = texture(u_flowmap, fragUV);
  float influence = flow.r;
  vec2 flowDir = (flow.gb - 0.5) * 2.0;

  float n1 = noise(uv + t), n2 = noise(uv*2. - t);
  float angle = n1 * TWO_PI;

  float totalDistortion = u_distortion + influence * u_distortBoost;
  uv.x += 4. * totalDistortion * n2 * cos(angle);
  uv.y += 4. * totalDistortion * n2 * sin(angle);

  uv += flowDir * influence * 0.15;

  if (influence > 0.001) {
    float localNoise = noise(uv * 2.0 + t * 1.5);
    uv += influence * u_noiseBoost * vec2(cos(localNoise * TWO_PI), sin(localNoise * TWO_PI));
  }

  float iters = ceil(clamp(u_swirlIterations, 1., 30.));
  float swirlAmt = clamp(u_swirl, 0., 2.) + influence * u_swirlBoost;
  for (float i = 1.; i <= 30.0; i++) {
    if (i > iters) break;
    uv.x += swirlAmt / i * cos(t + i*1.5*uv.y);
    uv.y += swirlAmt / i * cos(t + i*1.*uv.x);
  }

  float proportion = clamp(u_proportion, 0., 1.);
  vec2 cuv = uv * (.5 + 3.5 * u_shapeScale);
  float shape = .5 + .5 * sin(cuv.x) * cos(cuv.y);
  float mixer = shape + .48 * sign(proportion - .5) * pow(abs(proportion - .5), .5);
  vec3 col = blend_multi(mixer, clamp(u_softness, 0., 1.));
  fragColor = vec4(col, 1.0);
}
`;

export const TAIJI_DISPLAY_SHADER = `${DISPLAY_COMMON}
vec3 motionTaiji(vec2 uv, float t) {
  vec2 p = uv - 0.5;
  p.x *= u_resolution.x / u_resolution.y;
  p = rotate(p, t * 0.45);
  p *= 1.72;
  float disk = smoothstep(1.06, 0.9, length(p));
  float topC = length(p - vec2(0.0, 0.5));
  float botC = length(p - vec2(0.0, -0.5));
  float right = smoothstep(-0.03, 0.03, p.x);
  float yang = mix(smoothstep(0.52, 0.46, botC), 1.0 - smoothstep(0.52, 0.46, topC), right);
  yang = mix(yang, 1.0, 1.0 - smoothstep(0.09, 0.13, length(p - vec2(0.0, 0.5))));
  yang = mix(yang, 0.0, 1.0 - smoothstep(0.09, 0.13, length(p - vec2(0.0, -0.5))));
  vec3 fish = mix(u_color1.rgb, u_color2.rgb, yang);
  vec3 wash = mix(u_color3.rgb, u_color2.rgb, 0.35);
  return mix(wash, fish, disk);
}

void main() {
  fragColor = vec4(motionTaiji(vUv, u_time * 7.0), 1.0);
}
`;

export const STORM_DISPLAY_SHADER = `${DISPLAY_COMMON}
${DISPLAY_NOISE}
vec3 motionStorm(vec2 uv, float t) {
  vec2 p = uv;
  p.x += t * 0.06;
  float clouds = noise(p * vec2(2.2, 1.4) + t * 0.12);
  clouds = mix(clouds, noise(p * 5.0 - t * 0.2), 0.35);
  float rain = 0.0;
  // Float induction matches the working prototype. ANGLE/D3D can reject
  // or miscompile small integer loops in otherwise valid ES 3.00 sources.
  for (float i = 1.0; i <= 4.0; i++) {
    vec2 q = p * vec2(14.0 * i, 64.0 * i);
    q.x += q.y * 0.42;
    q.y += t * (3.2 + i * 0.8);
    float cell = random(floor(q));
    float streak = smoothstep(0.78, 0.96, cell) * (1.0 - fract(q.y));
    rain += streak / i;
  }
  float flash = pow(max(0.0, sin(t * 0.55) * sin(t * 1.21 + 1.7)), 22.0);
  vec3 col = mix(u_color1.rgb, u_color3.rgb, clouds);
  col = mix(col, u_color2.rgb, clamp(rain, 0.0, 1.0));
  col += flash * 0.38 * u_color2.rgb;
  return col;
}

void main() {
  fragColor = vec4(motionStorm(vUv, u_time * 7.0), 1.0);
}
`;

export const TORNADO_DISPLAY_SHADER = `${DISPLAY_COMMON}
${DISPLAY_NOISE}
vec3 motionTornado(vec2 uv, float t) {
  vec2 p = uv - vec2(0.5, 0.46);
  p.x *= u_resolution.x / u_resolution.y;
  float funnel = 0.16 + 0.78 * smoothstep(-0.75, 0.95, p.y);
  p.x /= max(funnel, 0.08);
  float r = length(p);
  float ang = atan(p.y, p.x);
  ang += 1.65 / (r + 0.12) + t * 1.35;
  vec2 sp = vec2(cos(ang), sin(ang)) * r;
  float arms = 0.5 + 0.5 * sin(ang * 3.0 + r * 9.0 - t * 2.8);
  float dust = noise(sp * 5.5 + t * 0.6);
  float core = smoothstep(0.5, 0.0, r);
  vec3 col = mix(u_color3.rgb, u_color1.rgb, arms);
  col = mix(col, u_color2.rgb, dust * 0.38);
  col = mix(col, u_color1.rgb * 0.22, core * 0.75);
  float mask = smoothstep(1.25, 0.28, r);
  return mix(u_color3.rgb, col, mask);
}

void main() {
  fragColor = vec4(motionTornado(vUv, u_time * 7.0), 1.0);
}
`;
