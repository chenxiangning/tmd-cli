// 终端渲染基准引擎:canvas 默认渲染器 vs @xterm/addon-webgl,同参双终端回放三场景。
// 独立 bench 页专用,主应用不 import(040 候选 7「先测再依赖」:通过才按需 dynamic import)。
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebglAddon } from "@xterm/addon-webgl";

const CACHE_KEY = "tmd.bench.webgl.v1";
const SCENES = ["cat 10 万行日志", "htop 全屏重绘", "vim 连续滚屏"];
const RUNS = 3;
const HOLD_MS = 10_000; /* htop/vim 每轮采样时长 */
const VIM_LINES = 5_000;
const FLOOD_LINES = 100_000;
/* xterm 无导出版本常量,缓存失效键手工钉:xterm/addon 大版本升级时同步改这里 */
const BENCH_ENV = "xterm6-webgl0.19";

type Row = { a: number; b: number; pct: number; warn: boolean };
type Report = { ua: string; env: string; ts: number; rows: Row[] };

const median = (xs: number[]) => {
  const s = [...xs].sort((x, y) => x - y);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const $ = (id: string) => document.getElementById(id)!;
const fps = (ticks: number, ms: number) => ticks / (ms / 1000);

function makeTerm(parent: HTMLElement): Terminal {
  const term = new Terminal({
    scrollback: 50_000, /* 与主应用 TerminalView 同参 */
    fontSize: 13,
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
  });
  const fit = new FitAddon();
  term.loadAddon(fit);
  term.open(parent);
  fit.fit();
  return term;
}

/* ---- 场景数据生成器:确定性回放,不经 PTY(基准对象是渲染管线,喂等价字节流)。 ---- */

function makeHtopFrame(seed: number): string {
  const rows: string[] = ["\x1b[H"]; /* 光标归位整帧覆写,htop 同构 */
  rows.push(`\x1b[1mtmd-bench${seed % 10}   任务: 310, 已启动: 2\x1b[K\x1b[0m\r\n`);
  rows.push(`\x1b[K\r\n`);
  rows.push(`MiB Mem : ${16000 + (seed % 100)}.0 total, ${(seed * 13) % 4000}.0 free\x1b[K\r\n`);
  for (let r = 0; r < 36; r++) {
    const pid = 1000 + ((seed * 37 + r * 97) % 30000);
    const cpu = (((seed * 11 + r * 53) % 970) / 10).toFixed(1);
    rows.push(`${String(pid).padStart(7)}  x.y  root  20   5  ${(r * 17) % 999999}  ${(r * 29) % 99999}  R  ${cpu}\x1b[K\r\n`);
  }
  return rows.join("");
}

const VIM_LINE = `  // const x = computeShortcutRegistry(ctx);`.padEnd(122, " ") + "\r\n";

/* ---- 采样:write 回调到位才发下一帧,帧率即渲染管线吞吐(队列积压不虚高)。 ---- */

/* 洪峰:分帧喂养(每帧 2000 行直到 10 万行),帧率 = 渲染管线持续吞吐。
   单次巨 write 不行:xterm 解析在 rAF 节拍外就跑完,量到的是解析不是渲染(实证 0 tick)。 */
async function sampleFlood(term: Terminal): Promise<number> {
  let frames = 0;
  let lines = 0;
  const t0 = performance.now();
  let seed = 0;
  while (lines < FLOOD_LINES) {
    const parts: string[] = [];
    for (let n = 0; n < 2000; n++, lines++) {
      parts.push(`[2026-10-19 12:${String(Math.floor(lines / 600) % 60).padStart(2, "0")}:${String(lines % 60).padStart(2, "0")}] ` +
        `INFO app-2026-10-17 request_id=${lines} path=/api/session/${(seed * 7919 + lines) % 99991} status=200 bytes=${(lines * 31) % 4096}\r\n`);
    }
    seed++;
    await nextFrame(term, parts.join(""));
    frames++;
  }
  return fps(frames, performance.now() - t0);
}

async function sampleHtop(term: Terminal): Promise<number> {
  let ticks = 0;
  let seed = 0;
  const t0 = performance.now();
  while (performance.now() - t0 < HOLD_MS) {
    await nextFrame(term, makeHtopFrame(seed++));
    ticks++;
  }
  return fps(ticks, performance.now() - t0);
}

async function sampleVim(term: Terminal): Promise<number> {
  let frames = 0;
  const t0 = performance.now();
  while (frames * 40 < VIM_LINES) {
    await nextFrame(term, VIM_LINE.repeat(40));
    frames++;
  }
  return fps(frames, performance.now() - t0);
}

function nextFrame(term: Terminal, data: string): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  requestAnimationFrame(() => term.write(data, resolve));
  return promise;
}

/* ---- 三场景 × 两渲染器 × RUNS 轮;轮间 300ms 排空上轮写队列。 ---- */

async function runAll(pa: HTMLElement, pb: HTMLElement, onScene: (i: number) => void): Promise<{ rows: Row[]; webglOk: boolean }> {
  const A = makeTerm(pa);
  const B = makeTerm(pb);
  let webglOk = true;
  try {
    B.loadAddon(new WebglAddon());
  } catch {
    webglOk = false; /* WebGL 上下文创建失败:报告为不可对照 */
  }
  const runners = [
    (t: Terminal) => sampleFlood(t),
    (t: Terminal) => sampleHtop(t),
    (t: Terminal) => sampleVim(t),
  ];
  const sa: number[][] = [[], [], []];
  const sb: number[][] = [[], [], []];
  for (let s = 0; s < 3; s++) {
    onScene(s);
    for (let r = 0; r < RUNS; r++) {
      A.reset();
      B.reset();
      sa[s].push(await runners[s](A));
      sb[s].push(webglOk ? await runners[s](B) : 0);
      await new Promise((res) => setTimeout(res, 300));
    }
  }
  A.dispose();
  B.dispose();
  const rows = [0, 1, 2].map((s) => {
    const a = median(sa[s]);
    const b = webglOk ? median(sb[s]) : 0;
    const pct = webglOk && a > 0 ? Math.round(((b - a) / a) * 100) : 0;
    return { a: Math.round(a), b: Math.round(b), pct, warn: webglOk && pct >= 5 };
  });
  return { rows, webglOk };
}

/* ---- 报告渲染 + localStorage 缓存(UA/环境键失效,旧值保留为对比基线)。 ---- */

function renderRows(rows: Row[], prev: Report | null) {
  rows.forEach((r, i) => {
    $(`a${i}`).textContent = String(r.a);
    $(`b${i}`).textContent = String(r.b);
    const old = prev?.rows[i];
    const prevTxt = old ? ` <small style="color:#a8a29e">(前次 ${old.pct >= 0 ? "+" : ""}${old.pct}%)</small>` : "";
    $(`d${i}`).innerHTML = `${r.pct >= 0 ? "+" : ""}${r.pct}%${prevTxt}`;
    $(`v${i}`).innerHTML = `<span class="verdict ${r.warn ? "v-warn" : "v-ok"}">${r.warn ? "可感知" : "无感"}</span>`;
  });
}

async function main() {
  const prev = JSON.parse(localStorage.getItem(CACHE_KEY) ?? "null") as Report | null;
  const banner = $("banner");
  if (prev) {
    renderRows(prev.rows, null);
    $("status-pill").textContent = "已缓存报告";
    $("status-pill").className = "pill ok";
    $("stamp").textContent = new Date(prev.ts).toLocaleString("zh-CN") + " 生成 · " + prev.env;
    if (prev.ua !== navigator.userAgent || prev.env !== BENCH_ENV) {
      banner.style.display = "block";
      banner.textContent = "环境已变化(UA 或 xterm 版本与缓存报告不一致),建议复测。";
    }
  }
  const btn = $("rerun") as HTMLButtonElement;
  btn.addEventListener("click", async () => {
    btn.disabled = true;
    btn.textContent = "运行中…";
    const scene = (i: number) => {
      $("status-pill").textContent = `${SCENES[i]} · 采样中(${RUNS}×2 渲染器)`;
      $("status-pill").className = "pill run";
    };
    const { rows, webglOk } = await runAll($("term-a"), $("term-b"), scene);
    if (!webglOk) {
      renderRows(rows, prev); /* b 列全 0:上下文不可建,数值无意义但状态可见 */
      $("decision").innerHTML = "<b>WebGL 上下文不可用</b> → 无法对照,维持现状。";
    } else {
      const report: Report = { ua: navigator.userAgent, env: BENCH_ENV, ts: Date.now(), rows };
      renderRows(rows, prev);
      localStorage.setItem(CACHE_KEY, JSON.stringify(report));
      const any = rows.some((r) => r.warn);
      $("decision").innerHTML = any
        ? "<b>依赖决策:通过(存在可感知场景)</b> → 按需 dynamic import,持续重绘会话启用 WebGL,不进首包(+~86KB gzip 仅计入命中会话)。"
        : "<b>依赖决策:不通过(全部无感)</b> → 不装,维持 fit/search/web-links 三 addon 现状。";
    }
    $("status-pill").textContent = "已完成 3/3 场景";
    $("status-pill").className = "pill ok";
    $("stamp").textContent = new Date().toLocaleString("zh-CN") + " 复测 · " + BENCH_ENV;
    btn.disabled = false;
    btn.textContent = "复测";
  });
}

main();
